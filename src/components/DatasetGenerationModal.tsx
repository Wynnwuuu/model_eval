import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw, Save, Settings, Wand2, X } from 'lucide-react';
import {
  DatasetColumnMappings,
  DatasetGenerationJob,
  DatasetGenerationJobItem,
  DatasetPreviewType,
  DatasetSchemaField,
  EvalDataset,
  GenerationInputMapping,
  GenerationModelConfig,
  GenerationSeedMode
} from '../types';
import { db, auth } from '../firebase';
import { collection, doc, setDoc } from '../datastore';
import {
  appendDatasetVersion,
  buildDatasetCard,
  getDatasetColumnMappings,
  inferSchemaType,
  validateDatasetItems
} from '../datasetManifest';
import MediaRenderer from './MediaRenderer';
import {
  GenerationBatchPayload,
  GenerationCasePayload,
  hashStringToSeed,
  listGenerationModels,
  runGenerationBatch
} from '../generationService';
import { normalizeUrl } from '../utils';

interface DatasetGenerationModalProps {
  dataset: EvalDataset;
  onClose: () => void;
}

type GenerationStep = 1 | 2 | 3;

const emptyMapping: GenerationInputMapping = {
  promptColumn: '',
  referenceImageColumns: [],
  referenceAudioColumns: [],
  startImageColumn: '',
  endImageColumn: '',
  lyricsOrDialogueColumn: '',
  extraInputColumns: []
};

const firstUrl = (value: any) => String(value || '').match(/https?:\/\/[^\s"'\t|,;>]+/)?.[0] || '';

const splitUrls = (value: any) => {
  const matches = String(value || '').match(/https?:\/\/[^\s"'\t|,;>]+/g);
  return matches || [];
};

const clean = (value: any) => String(value ?? '').trim();

const formatDateKey = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
};

const safeDocId = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || `case_${Date.now()}`;

const fieldMatches = (field: DatasetSchemaField, candidates: string[]) => {
  const haystack = [field.key, field.label, field.sourceKey, field.canonicalKey].filter(Boolean).join(' ').toLowerCase();
  return candidates.some(candidate => haystack.includes(candidate.toLowerCase()));
};

const getCaseId = (row: Record<string, any>, index: number, mappings: DatasetColumnMappings) => {
  const candidates = [
    mappings.standard.case_id,
    mappings.caseId,
    '用例ID',
    'Case_ID',
    'case_id',
    'itemId',
    'id'
  ].filter(Boolean) as string[];
  const key = candidates.find(candidate => clean(row[candidate]));
  return key ? clean(row[key]) : `case-${String(index + 1).padStart(4, '0')}`;
};

const MediaPreview = ({ value, previewType }: { value?: string; previewType?: DatasetPreviewType }) => {
  const url = firstUrl(value);
  if (!url) return <span className="text-xs text-slate-500">空</span>;
  if (previewType === 'image' || previewType === 'video') {
    return (
      <div className="w-40 h-24 rounded-lg overflow-hidden border border-white/10 bg-black/40">
        <MediaRenderer
          url={url}
          isActive={false}
          forceType={previewType}
          videoPreload="metadata"
          className="rounded-lg border-0 shadow-none"
        />
      </div>
    );
  }
  if (previewType === 'audio') {
    return <audio controls preload="metadata" src={normalizeUrl(url)} className="w-40 h-9" />;
  }
  return (
    <a href={normalizeUrl(url)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-300 hover:underline break-all line-clamp-2 max-w-[180px]">
      {url}
    </a>
  );
};

const buildDefaultInputMapping = (dataset: EvalDataset, headers: string[], mappings: DatasetColumnMappings): GenerationInputMapping => {
  const fields = dataset.inputSchema || [];
  const findFieldKey = (predicate: (field: DatasetSchemaField) => boolean) => fields.find(predicate)?.key;
  const promptColumn =
    mappings.standard.full_prompt ||
    findFieldKey(field => field.canonicalKey === 'full_prompt') ||
    findFieldKey(field => field.canonicalKey === 'zh_prompt') ||
    mappings.inputColumns.find(column => headers.includes(column)) ||
    headers.find(header => /prompt|提示词|输入/i.test(header)) ||
    '';

  const referenceImageColumns = fields
    .filter(field => field.previewType === 'image' && (field.role === 'reference' || fieldMatches(field, ['reference', '参考', 'ref'])))
    .map(field => field.key);
  const referenceAudioColumns = fields
    .filter(field => field.previewType === 'audio' || fieldMatches(field, ['audio', '音频', '音乐']))
    .map(field => field.key);

  return {
    promptColumn,
    referenceImageColumns: Array.from(new Set(referenceImageColumns)),
    referenceAudioColumns: Array.from(new Set(referenceAudioColumns)),
    startImageColumn: findFieldKey(field => field.canonicalKey === 'start_image_url' || fieldMatches(field, ['first frame', 'start image', '首帧'])),
    endImageColumn: findFieldKey(field => field.canonicalKey === 'end_image_url' || fieldMatches(field, ['last frame', 'end image', '尾帧'])),
    lyricsOrDialogueColumn: findFieldKey(field => field.canonicalKey === 'lyrics_or_dialogue' || fieldMatches(field, ['lyrics', 'dialogue', '歌词', '对白'])),
    extraInputColumns: []
  };
};

const makeTargetColumn = (model?: GenerationModelConfig) =>
  `${model?.displayName || '生成结果'}_生成_${formatDateKey()}`.replace(/[\\/:*?"<>|]/g, '_');

const ensureGenerationSchema = (
  dataset: EvalDataset,
  targetColumn: string,
  previewType: DatasetPreviewType
) => {
  const metadataFields = [
    { key: `${targetColumn}_状态`, label: `${targetColumn}_状态`, role: 'metadata' as const, previewType: 'text' as const },
    { key: `${targetColumn}_seed`, label: `${targetColumn}_seed`, role: 'metadata' as const, previewType: 'text' as const },
    { key: `${targetColumn}_请求ID`, label: `${targetColumn}_请求ID`, role: 'metadata' as const, previewType: 'text' as const },
    { key: `${targetColumn}_错误`, label: `${targetColumn}_错误`, role: 'metadata' as const, previewType: 'text' as const },
    { key: `${targetColumn}_参数JSON`, label: `${targetColumn}_参数JSON`, role: 'system' as const, previewType: 'text' as const }
  ];

  const existing = new Map((dataset.inputSchema || []).map(field => [field.key, field]));
  const outputField: DatasetSchemaField = {
    key: targetColumn,
    label: targetColumn,
    type: inferSchemaType(previewType),
    role: 'output',
    sourceKey: targetColumn,
    previewType
  };

  const schema = [
    ...(dataset.inputSchema || []).filter(field => field.key !== targetColumn),
    outputField,
    ...metadataFields
      .filter(field => !existing.has(field.key))
      .map(field => ({
        key: field.key,
        label: field.label,
        type: 'text' as const,
        role: field.role,
        sourceKey: field.key,
        previewType: field.previewType
      }))
  ];

  const mappings = getDatasetColumnMappings({ ...dataset, inputSchema: schema });
  return {
    inputSchema: schema,
    columnMappings: {
      ...mappings,
      outputColumns: Array.from(new Set([...(mappings.outputColumns || []), targetColumn]))
    }
  };
};

const DatasetGenerationModal: React.FC<DatasetGenerationModalProps> = ({ dataset, onClose }) => {
  const [step, setStep] = useState<GenerationStep>(1);
  const [models, setModels] = useState<GenerationModelConfig[]>([]);
  const [modelId, setModelId] = useState('');
  const [targetColumn, setTargetColumn] = useState('');
  const [inputMapping, setInputMapping] = useState<GenerationInputMapping>(emptyMapping);
  const [defaultControls, setDefaultControls] = useState<Record<string, string | number>>({});
  const [perCaseControlColumns, setPerCaseControlColumns] = useState<Record<string, string>>({});
  const [seedMode, setSeedMode] = useState<GenerationSeedMode>('derive_from_case');
  const [fixedSeed, setFixedSeed] = useState(42);
  const [seedColumn, setSeedColumn] = useState('');
  const [running, setRunning] = useState(false);
  const [jobItems, setJobItems] = useState<Record<string, DatasetGenerationJobItem>>({});
  const [error, setError] = useState('');

  const cancelRef = useRef(false);
  const workingItemsRef = useRef<Record<string, any>[]>(dataset.items || []);
  const currentJobRef = useRef<DatasetGenerationJob | null>(null);
  const jobItemsRef = useRef<Record<string, DatasetGenerationJobItem>>({});
  const datasetSnapshotRef = useRef<EvalDataset>(dataset);
  const currentRunCaseIdsRef = useRef<Set<string>>(new Set());

  const mappings = useMemo(() => getDatasetColumnMappings(dataset), [dataset]);
  const headers = useMemo(() => {
    const fromItems = dataset.items?.[0] ? Object.keys(dataset.items[0]).filter(key => key !== '_originalData') : [];
    const fromSchema = (dataset.inputSchema || []).map(field => field.key);
    return Array.from(new Set([...fromSchema, ...fromItems]));
  }, [dataset]);
  const selectedModel = models.find(model => model.id === modelId) || models[0];

  useEffect(() => {
    let mounted = true;
    listGenerationModels().then(loaded => {
      if (!mounted) return;
      setModels(loaded);
      setModelId(loaded[0]?.id || '');
      setTargetColumn(makeTargetColumn(loaded[0]));
      const controls = Object.fromEntries((loaded[0]?.controls || []).map(control => [control.key, control.defaultValue ?? '']));
      setDefaultControls(controls);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setInputMapping(buildDefaultInputMapping(dataset, headers, mappings));
    workingItemsRef.current = dataset.items || [];
    datasetSnapshotRef.current = dataset;
  }, [dataset, headers, mappings]);

  const updateModel = (nextModelId: string) => {
    const nextModel = models.find(model => model.id === nextModelId);
    setModelId(nextModelId);
    setTargetColumn(makeTargetColumn(nextModel));
    setDefaultControls(Object.fromEntries((nextModel?.controls || []).map(control => [control.key, control.defaultValue ?? ''])));
    setPerCaseControlColumns({});
  };

  const updateMultiColumn = (key: keyof GenerationInputMapping, column: string, checked: boolean) => {
    setInputMapping(prev => {
      const current = Array.isArray(prev[key]) ? prev[key] as string[] : [];
      return {
        ...prev,
        [key]: checked ? Array.from(new Set([...current, column])) : current.filter(item => item !== column)
      };
    });
  };

  const buildCases = (): GenerationCasePayload[] => {
    return (dataset.items || []).map((row, rowIndex) => {
      const caseId = getCaseId(row, rowIndex, mappings);
      const controls = { ...defaultControls };
      Object.entries(perCaseControlColumns as Record<string, string>).forEach(([controlKey, column]) => {
        const value = clean(row[column]);
        if (value) controls[controlKey] = value;
      });

      const seed = seedMode === 'fixed'
        ? fixedSeed
        : seedMode === 'column'
          ? Number(row[seedColumn]) || hashStringToSeed(`${dataset.id}:${caseId}:${targetColumn}`)
          : hashStringToSeed(`${dataset.id}:${caseId}:${targetColumn}:${clean(row[inputMapping.promptColumn || ''])}`);

      const extraInputs = Object.fromEntries(inputMapping.extraInputColumns.map(column => [column, row[column]]));

      return {
        caseId,
        rowIndex,
        prompt: inputMapping.promptColumn ? clean(row[inputMapping.promptColumn]) : '',
        referenceImageUrls: inputMapping.referenceImageColumns.flatMap(column => splitUrls(row[column])),
        referenceAudioUrls: inputMapping.referenceAudioColumns.flatMap(column => splitUrls(row[column])),
        startImageUrl: inputMapping.startImageColumn ? firstUrl(row[inputMapping.startImageColumn]) : '',
        endImageUrl: inputMapping.endImageColumn ? firstUrl(row[inputMapping.endImageColumn]) : '',
        lyricsOrDialogue: inputMapping.lyricsOrDialogueColumn ? clean(row[inputMapping.lyricsOrDialogueColumn]) : '',
        extraInputs,
        controls,
        seed,
        idempotencyKey: `${dataset.id}:${dataset.version || 1}:${targetColumn}:${caseId}:${seed}`
      };
    });
  };

  const saveDatasetSnapshot = async (
    job: DatasetGenerationJob,
    items: Record<string, any>[],
    previewType: DatasetPreviewType
  ) => {
    const baseDataset = datasetSnapshotRef.current || dataset;
    const schemaMeta = ensureGenerationSchema(baseDataset, targetColumn, previewType);
    const validationSummary = validateDatasetItems(items, schemaMeta.columnMappings);
    const updatedDataset: EvalDataset = {
      ...baseDataset,
      inputSchema: schemaMeta.inputSchema,
      columnMappings: schemaMeta.columnMappings,
      items,
      modality: selectedModel?.outputModality || baseDataset.modality,
      datasetCard: buildDatasetCard(
        {
          ...baseDataset,
          items,
          modality: selectedModel?.outputModality || baseDataset.modality
        },
        schemaMeta.columnMappings,
        {
          ...(baseDataset.datasetCard || {}),
          latestChange: `批量生产写入 ${job.targetColumn}`,
          modality: selectedModel?.outputModality || baseDataset.modality
        }
      ),
      validationSummary,
      updatedAt: Date.now()
    };
    datasetSnapshotRef.current = updatedDataset;
    await setDoc(doc(db, 'evalDatasets', dataset.id), updatedDataset);
  };

  const persistJob = async (job: DatasetGenerationJob) => {
    await setDoc(doc(db, 'evalGenerationJobs', job.id), job);
  };

  const persistJobItem = async (item: DatasetGenerationJobItem) => {
    await setDoc(doc(collection(db, 'evalGenerationJobs', item.jobId, 'items'), safeDocId(item.caseId)), item);
  };

  const applyItemUpdate = async (item: DatasetGenerationJobItem) => {
    jobItemsRef.current = { ...jobItemsRef.current, [item.caseId]: item };
    setJobItems(jobItemsRef.current);
    await persistJobItem(item);

    const job = currentJobRef.current;
    if (!job || !selectedModel) return;

    const nextItems = [...workingItemsRef.current];
    const row = { ...(nextItems[item.rowIndex] || {}) };
    const resultValue = item.resultUrl || item.resultText || '';
    if (item.status === 'completed') {
      row[targetColumn] = resultValue;
      row[`${targetColumn}_状态`] = 'completed';
      row[`${targetColumn}_错误`] = '';
    } else if (item.status === 'failed') {
      row[targetColumn] = row[targetColumn] || '';
      row[`${targetColumn}_状态`] = 'failed';
      row[`${targetColumn}_错误`] = item.error?.message || '生成失败';
    } else if (item.status === 'running') {
      row[`${targetColumn}_状态`] = 'running';
    }
    row[`${targetColumn}_seed`] = item.seed ?? '';
    row[`${targetColumn}_请求ID`] = item.requestId || item.providerJobId || '';
    row[`${targetColumn}_参数JSON`] = JSON.stringify(item.resolvedControls || {});
    nextItems[item.rowIndex] = row;
    workingItemsRef.current = nextItems;

    const allItems = (Object.values(jobItemsRef.current) as DatasetGenerationJobItem[]).filter(entry => currentRunCaseIdsRef.current.has(entry.caseId));
    const succeeded = allItems.filter(entry => entry.status === 'completed').length;
    const failed = allItems.filter(entry => entry.status === 'failed').length;
    const done = succeeded + failed >= job.total;
    const nextJob: DatasetGenerationJob = {
      ...job,
      succeeded,
      failed,
      status: cancelRef.current ? 'cancelled' : done ? (failed > 0 && succeeded > 0 ? 'partial' : failed === job.total ? 'failed' : 'completed') : 'running',
      updatedAt: Date.now()
    };
    currentJobRef.current = nextJob;
    await persistJob(nextJob);

    if (item.status === 'completed' || item.status === 'failed') {
      await saveDatasetSnapshot(nextJob, nextItems, selectedModel.previewType);
    }
  };

  const startGeneration = async (caseSubset?: GenerationCasePayload[]) => {
    if (!selectedModel) {
      setError('请先选择生成模型。');
      return;
    }
    if (!targetColumn.trim()) {
      setError('请填写目标输出列名。');
      return;
    }
    if (!dataset.items?.length) {
      setError('当前评测集没有 case，无法生产。');
      return;
    }

    setError('');
    setRunning(true);
    setStep(3);
    cancelRef.current = false;
    const cases = caseSubset?.length ? caseSubset : buildCases();
    currentRunCaseIdsRef.current = new Set(cases.map(item => item.caseId));
    if (!caseSubset?.length) {
      setJobItems({});
      jobItemsRef.current = {};
    }
    const retryCaseIds = new Set(cases.map(item => item.caseId));
    workingItemsRef.current = (dataset.items || []).map((row, index) => {
      const caseId = getCaseId(row, index, mappings);
      if (caseSubset?.length && !retryCaseIds.has(caseId)) return { ...row };
      return {
        ...row,
        [targetColumn]: row[targetColumn] || '',
        [`${targetColumn}_状态`]: 'pending',
        [`${targetColumn}_错误`]: ''
      };
    });
    const now = Date.now();
    const versionMeta = appendDatasetVersion(
      dataset,
      auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
      `批量生产产物：${targetColumn}`,
      dataset.items.length,
      dataset.items.length
    );
    const job: DatasetGenerationJob = {
      id: `gen-${now}-${Math.random().toString(36).slice(2, 8)}`,
      datasetId: dataset.id,
      datasetName: dataset.name,
      datasetVersion: versionMeta.version,
      modelConfig: selectedModel,
      targetColumn,
      inputMapping,
      defaultControls,
      perCaseControlColumns,
      seedMode,
      fixedSeed: seedMode === 'fixed' ? fixedSeed : undefined,
      seedColumn: seedMode === 'column' ? seedColumn : undefined,
      status: 'running',
      total: cases.length,
      succeeded: 0,
      failed: 0,
      createdByUid: auth.currentUser?.uid,
      createdBy: auth.currentUser?.displayName || auth.currentUser?.email || 'Unknown',
      createdAt: now,
      updatedAt: now
    };
    currentJobRef.current = job;

    const schemaMeta = ensureGenerationSchema(
      {
        ...dataset,
        version: versionMeta.version,
        versionHistory: versionMeta.versionHistory
      },
      targetColumn,
      selectedModel.previewType
    );
    const initializedDataset: EvalDataset = {
      ...dataset,
      ...versionMeta,
      inputSchema: schemaMeta.inputSchema,
      columnMappings: schemaMeta.columnMappings,
      items: workingItemsRef.current,
      modality: selectedModel.outputModality || dataset.modality,
      datasetCard: buildDatasetCard(
        {
          ...dataset,
          ...versionMeta,
          items: workingItemsRef.current,
          modality: selectedModel.outputModality || dataset.modality
        },
        schemaMeta.columnMappings,
        {
          ...(dataset.datasetCard || {}),
          latestChange: `开始批量生产 ${targetColumn}`,
          modality: selectedModel.outputModality || dataset.modality
        }
      ),
      validationSummary: validateDatasetItems(workingItemsRef.current, schemaMeta.columnMappings),
      updatedAt: now
    };

    datasetSnapshotRef.current = initializedDataset;
    await setDoc(doc(db, 'evalDatasets', dataset.id), initializedDataset);
    await persistJob(job);

    const payload: GenerationBatchPayload = {
      jobId: job.id,
      datasetId: dataset.id,
      model: selectedModel,
      targetColumn,
      inputMapping,
      defaultControls,
      cases
    };

    try {
      await runGenerationBatch(payload, applyItemUpdate, () => cancelRef.current);
      const finalJob = currentJobRef.current;
      if (finalJob && finalJob.status === 'running') {
        const allItems = (Object.values(jobItemsRef.current) as DatasetGenerationJobItem[]).filter(item => currentRunCaseIdsRef.current.has(item.caseId));
        const succeeded = allItems.filter(item => item.status === 'completed').length;
        const failed = allItems.filter(item => item.status === 'failed').length;
        const doneJob: DatasetGenerationJob = {
          ...finalJob,
          succeeded,
          failed,
          status: cancelRef.current ? 'cancelled' : failed > 0 && succeeded > 0 ? 'partial' : failed > 0 ? 'failed' : 'completed',
          updatedAt: Date.now()
        };
        currentJobRef.current = doneJob;
        await persistJob(doneJob);
      }
    } catch (runError: any) {
      const failedJob: DatasetGenerationJob = {
        ...job,
        status: 'failed',
        failed: job.total,
        updatedAt: Date.now()
      };
      currentJobRef.current = failedJob;
      await persistJob(failedJob);
      setError(runError?.message || String(runError));
    } finally {
      setRunning(false);
    }
  };

  const cancelGeneration = async () => {
    cancelRef.current = true;
    const job = currentJobRef.current;
    if (job) {
      const cancelledJob: DatasetGenerationJob = {
        ...job,
        status: 'cancelled',
        updatedAt: Date.now()
      };
      currentJobRef.current = cancelledJob;
      await persistJob(cancelledJob);
    }
    setRunning(false);
  };

  const retryFailedCases = async () => {
    const failedCaseIds = new Set((Object.values(jobItemsRef.current) as DatasetGenerationJobItem[]).filter(item => item.status === 'failed').map(item => item.caseId));
    const failedCases = buildCases().filter(item => failedCaseIds.has(item.caseId));
    if (!failedCases.length) {
      setError('当前没有可重试的失败 case。');
      return;
    }
    await startGeneration(failedCases);
  };

  const cases = useMemo(() => buildCases(), [dataset, mappings, defaultControls, fixedSeed, inputMapping, perCaseControlColumns, seedColumn, seedMode, targetColumn]);
  const completedCount = (Object.values(jobItems) as DatasetGenerationJobItem[]).filter(item => item.status === 'completed').length;
  const failedCount = (Object.values(jobItems) as DatasetGenerationJobItem[]).filter(item => item.status === 'failed').length;
  const progress = dataset.items?.length ? Math.round(((completedCount + failedCount) / dataset.items.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel border border-white/10 rounded-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Wand2 size={20} className="text-amber-400" /> 批量生产产物
            </h2>
            <p className="text-xs text-slate-400 mt-1">{dataset.name} · {dataset.items?.length || 0} 个 case</p>
          </div>
          <button onClick={running ? cancelGeneration : onClose} className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-white/10 flex gap-2 shrink-0">
          {[1, 2, 3].map(item => (
            <button
              key={item}
              onClick={() => !running && setStep(item as GenerationStep)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${step === item ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-white/5 text-slate-300 border-white/10'}`}
            >
              {item === 1 ? '1 模型与输出列' : item === 2 ? '2 输入与控制变量' : '3 运行与结果'}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-6 flex-1">
          {error && (
            <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 text-red-200 px-4 py-3 text-sm flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <label className="block text-sm font-medium text-slate-200 mb-2">生成模型/服务</label>
                <select value={modelId} onChange={e => updateModel(e.target.value)} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200">
                  {models.map(model => (
                    <option key={model.id} value={model.id}>{model.displayName} · {model.provider}</option>
                  ))}
                </select>
                {selectedModel && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                    <div className="rounded-lg bg-black/20 p-3">
                      <div className="text-slate-500 mb-1">产物类型</div>
                      <div className="font-semibold text-slate-100">{selectedModel.outputModality} / {selectedModel.previewType}</div>
                    </div>
                    <div className="rounded-lg bg-black/20 p-3">
                      <div className="text-slate-500 mb-1">能力</div>
                      <div className="text-slate-200">{selectedModel.capabilities.join(', ') || '-'}</div>
                    </div>
                    <div className="rounded-lg bg-black/20 p-3">
                      <div className="text-slate-500 mb-1">分辨率</div>
                      <div className="text-slate-200">{selectedModel.supportedResolutions?.join(', ') || '-'}</div>
                    </div>
                    <div className="rounded-lg bg-black/20 p-3">
                      <div className="text-slate-500 mb-1">宽高比/时长</div>
                      <div className="text-slate-200">{selectedModel.supportedAspectRatios?.join(', ') || '-'} · {selectedModel.supportedDurations?.join(', ') || '-'}</div>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <label className="block text-sm font-medium text-slate-200 mb-2">目标输出列</label>
                <input value={targetColumn} onChange={e => setTargetColumn(e.target.value)} className="w-full px-4 py-2.5 glass-input rounded-xl text-sm text-slate-200" />
                <p className="text-xs text-slate-500 mt-2">默认新建列，不覆盖已有模型输出；生成后该列会自动成为任务构建器的模型结果列。</p>
                {headers.includes(targetColumn) && (
                  <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-200">
                    当前列名已存在。建议改成新列名，避免混淆历史产物。
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && selectedModel && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
              <div className="space-y-5">
                <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <h3 className="font-semibold text-slate-100 mb-4 flex items-center gap-2"><Settings size={18} className="text-amber-400" /> 输入映射</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Prompt 列</label>
                      <select value={inputMapping.promptColumn || ''} onChange={e => setInputMapping(prev => ({ ...prev, promptColumn: e.target.value }))} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200">
                        <option value="">不使用</option>
                        {headers.map(header => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">歌词或对白列</label>
                      <select value={inputMapping.lyricsOrDialogueColumn || ''} onChange={e => setInputMapping(prev => ({ ...prev, lyricsOrDialogueColumn: e.target.value }))} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200">
                        <option value="">不使用</option>
                        {headers.map(header => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">首帧图列</label>
                      <select value={inputMapping.startImageColumn || ''} onChange={e => setInputMapping(prev => ({ ...prev, startImageColumn: e.target.value }))} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200">
                        <option value="">不使用</option>
                        {headers.map(header => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">尾帧图列</label>
                      <select value={inputMapping.endImageColumn || ''} onChange={e => setInputMapping(prev => ({ ...prev, endImageColumn: e.target.value }))} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200">
                        <option value="">不使用</option>
                        {headers.map(header => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-slate-400 mb-2">参考图像 URL 列</div>
                      <div className="max-h-40 overflow-auto rounded-xl bg-black/20 border border-white/10 p-2 space-y-1">
                        {headers.map(header => (
                          <label key={header} className="flex items-center gap-2 text-xs text-slate-300 px-2 py-1 rounded hover:bg-white/5">
                            <input type="checkbox" checked={inputMapping.referenceImageColumns.includes(header)} onChange={e => updateMultiColumn('referenceImageColumns', header, e.target.checked)} />
                            <span className="truncate">{header}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 mb-2">参考音频 URL 列 / 额外输入列</div>
                      <div className="max-h-40 overflow-auto rounded-xl bg-black/20 border border-white/10 p-2 space-y-1">
                        {headers.map(header => (
                          <label key={header} className="flex items-center gap-2 text-xs text-slate-300 px-2 py-1 rounded hover:bg-white/5">
                            <input type="checkbox" checked={inputMapping.referenceAudioColumns.includes(header)} onChange={e => updateMultiColumn('referenceAudioColumns', header, e.target.checked)} />
                            <span className="truncate">{header}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <h3 className="font-semibold text-slate-100 mb-4">控制变量</h3>
                  <div className="space-y-2">
                    {selectedModel.controls.map(control => (
                      <div key={control.key} className="grid grid-cols-1 md:grid-cols-[160px_minmax(0,1fr)_minmax(180px,1fr)] gap-2 items-center rounded-lg bg-black/10 px-3 py-2">
                        <label className="text-sm text-slate-200">{control.label}</label>
                        {control.type === 'select' ? (
                          <select value={defaultControls[control.key] ?? ''} onChange={e => setDefaultControls(prev => ({ ...prev, [control.key]: e.target.value }))} className="px-3 py-2 glass-input rounded-lg text-sm text-slate-200">
                            {(control.options || []).map(option => <option key={option} value={option}>{option}{control.unit || ''}</option>)}
                          </select>
                        ) : (
                          <input type={control.type === 'number' ? 'number' : 'text'} value={defaultControls[control.key] ?? ''} onChange={e => setDefaultControls(prev => ({ ...prev, [control.key]: control.type === 'number' ? Number(e.target.value) : e.target.value }))} className="px-3 py-2 glass-input rounded-lg text-sm text-slate-200" />
                        )}
                        <select value={perCaseControlColumns[control.key] || ''} onChange={e => setPerCaseControlColumns(prev => ({ ...prev, [control.key]: e.target.value }))} className="px-3 py-2 glass-input rounded-lg text-sm text-slate-200">
                          <option value="">不使用逐 case 列覆盖</option>
                          {headers.map(header => <option key={header} value={header}>{header}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <aside className="space-y-5">
                <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <h3 className="font-semibold text-slate-100 mb-3">Seed 复现</h3>
                  <div className="space-y-2 text-sm text-slate-300">
                    <label className="flex items-center gap-2"><input type="radio" checked={seedMode === 'derive_from_case'} onChange={() => setSeedMode('derive_from_case')} /> 按 case 自动派生</label>
                    <label className="flex items-center gap-2"><input type="radio" checked={seedMode === 'fixed'} onChange={() => setSeedMode('fixed')} /> 固定 seed</label>
                    {seedMode === 'fixed' && <input type="number" value={fixedSeed} onChange={e => setFixedSeed(Number(e.target.value))} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200" />}
                    <label className="flex items-center gap-2"><input type="radio" checked={seedMode === 'column'} onChange={() => setSeedMode('column')} /> 从列读取</label>
                    {seedMode === 'column' && (
                      <select value={seedColumn} onChange={e => setSeedColumn(e.target.value)} className="w-full px-3 py-2 glass-input rounded-xl text-sm text-slate-200">
                        <option value="">选择 seed 列</option>
                        {headers.map(header => <option key={header} value={header}>{header}</option>)}
                      </select>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <h3 className="font-semibold text-slate-100 mb-3">Payload 预览</h3>
                  <pre className="max-h-80 overflow-auto text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap bg-black/20 rounded-xl p-3 border border-white/10">
                    {JSON.stringify(cases[0] || {}, null, 2)}
                  </pre>
                </div>
              </aside>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-slate-100">运行状态</h3>
                    <p className="text-sm text-slate-400 mt-1">{targetColumn} · {selectedModel?.displayName || '-'}</p>
                  </div>
                  <div className="flex gap-2">
                    {!running && Object.keys(jobItems).length === 0 && (
                      <button onClick={() => startGeneration()} className="px-4 py-2 rounded-xl bg-amber-500 text-black font-medium text-sm flex items-center gap-2">
                        <Play size={16} /> 启动生产
                      </button>
                    )}
                    {!running && failedCount > 0 && (
                      <button onClick={retryFailedCases} className="px-4 py-2 rounded-xl bg-blue-500/15 text-blue-200 border border-blue-500/30 text-sm flex items-center gap-2">
                        <RefreshCw size={16} /> 重试失败 case
                      </button>
                    )}
                    {running && (
                      <button onClick={cancelGeneration} className="px-4 py-2 rounded-xl bg-red-500/15 text-red-200 border border-red-500/30 text-sm">
                        取消
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                    <span>{progress}%</span>
                    <span>成功 {completedCount}</span>
                    <span>失败 {failedCount}</span>
                    <span>总计 {dataset.items?.length || 0}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 text-sm font-semibold text-slate-100">Case 结果</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-black/20 text-xs text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Case</th>
                        <th className="px-4 py-3">状态</th>
                        <th className="px-4 py-3">Seed</th>
                        <th className="px-4 py-3 min-w-[180px]">结果预览</th>
                        <th className="px-4 py-3 min-w-[220px]">错误/请求</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {cases.map(item => {
                        const current = jobItems[item.caseId];
                        const status = current?.status || 'pending';
                        return (
                          <tr key={item.caseId}>
                            <td className="px-4 py-3 font-mono text-xs text-slate-200">{item.caseId}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : status === 'failed' ? 'bg-red-500/15 text-red-300' : status === 'running' ? 'bg-blue-500/15 text-blue-300' : 'bg-white/10 text-slate-300'}`}>
                                {status === 'running' && <Loader2 size={12} className="animate-spin" />}
                                {status === 'completed' && <CheckCircle2 size={12} />}
                                {status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-300">{current?.seed ?? item.seed}</td>
                            <td className="px-4 py-3">
                              <MediaPreview value={current?.resultUrl || current?.resultText} previewType={selectedModel?.previewType} />
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {current?.error?.message || current?.requestId || current?.providerJobId || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center shrink-0">
          <button onClick={running ? cancelGeneration : onClose} className="px-4 py-2 rounded-xl bg-white/5 glass-panel-hover text-slate-300 text-sm">
            {running ? '取消生产' : '关闭'}
          </button>
          <div className="flex gap-3">
            {step > 1 && !running && <button onClick={() => setStep((step - 1) as GenerationStep)} className="px-4 py-2 rounded-xl bg-white/5 glass-panel-hover text-slate-300 text-sm">上一步</button>}
            {step < 3 && !running ? (
              <button onClick={() => setStep((step + 1) as GenerationStep)} className="px-5 py-2 rounded-xl bg-amber-500 text-black font-medium text-sm">下一步</button>
            ) : (
              <button onClick={() => startGeneration()} disabled={running || Object.keys(jobItems).length > 0} className="px-5 py-2 rounded-xl bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-black font-medium text-sm flex items-center gap-2">
                {running ? <Loader2 size={16} className="animate-spin" /> : Object.keys(jobItems).length > 0 ? <Save size={16} /> : <RefreshCw size={16} />}
                {running ? '生产中' : Object.keys(jobItems).length > 0 ? '已写回' : '启动生产'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatasetGenerationModal;
