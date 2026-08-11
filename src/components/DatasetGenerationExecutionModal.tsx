import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileUp,
  FolderUp,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
  Wand2,
  X,
} from 'lucide-react';

import {
  DatasetPreviewType,
  EvalDataset,
  GenerationAssetDurability,
  GenerationAssetBinding,
  GenerationCaseReview,
  GenerationContractFinding,
  GenerationJobEvent,
  GenerationDurationSourceMode,
  GenerationInputMapping,
  GenerationReferenceAudioDuration,
  GenerationModelConfig,
  GenerationParameterBinding,
  GenerationParameterValueType,
  GenerationPreflightCase,
  GenerationPreflightResult,
  GenerationQueueState,
  GenerationSeedMode,
  GenerationTargetMode,
} from '../types';
import { getDatasetColumnMappings } from '../datasetManifest';
import { DATASET_ITEM_ID_KEY } from '../datasetSync';
import {
  getGenerationOutputColumns,
  inspectGenerationTargetColumn,
} from '../features/generation/caseSelection';
import GenerationCaseSelector from './GenerationCaseSelector';
import DatasetGenerationContentMappingEditor from './DatasetGenerationContentMappingEditor';
import MediaRenderer from './MediaRenderer';
import GenerationCaseReviewDialog from './GenerationCaseReviewDialog';
import {
  GenerationBatch,
  GenerationRuntimeHealth,
  GenerationPreflightRequest,
  cancelExecutionBatch,
  confirmExecutionPreflight,
  listExecutionBatchEvents,
  createExecutionPreflight,
  createRetryPreflight,
  skipExecutionItems,
  getExecutionBatch,
  getGenerationQueue,
  getGenerationRuntimeHealth,
  isTerminalGenerationBatch,
  listExecutionModels,
  uploadGenerationAsset,
  waitForExecutionBatch,
} from '../features/generation/executionApi';

import { defaultGenerationInputMapping } from '../features/generation/inputMapping';
import {
  defaultVidMuseEvaluationParameterColumns,
  generationRowMatchesModality,
  hasVidMuseEvaluationPreset,
  resolveVidMuseEvaluationPresetColumns,
} from '../features/generation/inputMapping';
import {
  probeAudioDurations,
  resolveReferenceAudioDuration,
} from '../features/generation/audioDuration';
import {
  parseStructuredGenerationValue,
  uniqueGenerationReferences,
} from '../features/generation/mediaReferences';
import {
  applyBulkGenerationForceReview,
  applyBulkPromptColumnReview,
  GENERATION_FORCEABLE_PREFLIGHT_CODES,
  generationPromptReplacementColumns,
  generationForceRequiresFinalJson,
} from '../features/generation/preflightReview';
import {
  buildGenerationRepairGroups,
  buildGenerationIssueOptions,
  filterGenerationPreflightCases,
  getGenerationCaseId,
  getPrimaryGenerationIssue,
  resolveDefaultGenerationCaseStatus,
  type GenerationCaseStatusFilter,
} from '../features/generation/preflightPresentation';
import {
  generationCaseScopeIsCurrent,
  resolveGenerationCaseScopeRows,
  summarizeGenerationCaseScope,
  type GenerationCaseScopeMode,
  type GenerationCaseScopeSnapshot,
} from '../features/generation/caseScope';

interface DatasetGenerationExecutionModalProps {
  dataset: EvalDataset;
  initialBatchId?: string;
  initialCaseScope?: GenerationCaseScopeSnapshot;
  onClose: () => void;
  onBatchChange?: (batchId: string) => void;
  onCreateEvaluation?: (datasetId: string, resultColumn: string) => void;
}

type GenerationStep = 1 | 2 | 3;

const copy = {
  title: '\u6279\u91cf\u751f\u4ea7\u6a21\u578b\u7ed3\u679c',
  modelStep: '\u6a21\u578b\u4e0e\u8f93\u51fa',
  mappingStep: '\u8f93\u5165\u4e0e\u53c2\u6570',
  reviewStep: '\u9884\u68c0\u4e0e\u6267\u884c',
  close: '\u5173\u95ed',
  previous: '\u4e0a\u4e00\u6b65',
  next: '\u4e0b\u4e00\u6b65',
  loadingModels: '\u6b63\u5728\u8bfb\u53d6 VidMuse \u5b9e\u65f6\u6a21\u578b\u914d\u7f6e...',
  outputColumn: '\u76ee\u6807\u7ed3\u679c\u5217',
  promptColumn: 'Prompt \u5217',
  imageInputs: '\u56fe\u50cf\u8f93\u5165\u5217\uff08\u53ef\u9009\uff09',
  imageRole: '\u56fe\u50cf',
  unsupportedRole: '\u5f53\u524d\u6a21\u578b\u4e0d\u652f\u6301',
  refAudios: '\u53c2\u8003\u97f3\u9891\u5217',
  refVideosAndElements: '\u53c2\u8003\u89c6\u9891 / \u5143\u7d20',
  videoColumns: '\u4ece\u89c6\u9891\u5217\u6784\u5efa',
  rawElements: '\u4ece elements JSON \u5217\u8bfb\u53d6',
  durationSource: '\u65f6\u957f\u6765\u6e90',
  uniformDuration: '\u7edf\u4e00\u503c',
  durationColumn: '\u65f6\u957f\u5217',
  followAudioDuration: '\u8ddf\u968f\u53c2\u8003\u97f3\u9891',
  probingAudio: '\u6b63\u5728\u8bfb\u53d6\u97f3\u9891\u65f6\u957f...',
  none: '\u4e0d\u4f7f\u7528',
  controls: '\u751f\u6210\u53c2\u6570',
  caseColumn: '\u9010 case \u8986\u76d6\u5217',
  seed: 'Seed \u7b56\u7565',
  unusedSeed: '\u4e0d\u4f7f\u7528\uff08\u9ed8\u8ba4\uff09',
  fixed: '\u56fa\u5b9a Seed',
  derived: '\u6309 case \u7a33\u5b9a\u6d3e\u751f',
  fromColumn: '\u4ece\u5217\u8bfb\u53d6',
  localAssets: '\u672c\u5730\u7d20\u6750',
  selectFiles: '\u9009\u62e9\u6587\u4ef6',
  selectFolder: '\u9009\u62e9\u6587\u4ef6\u5939',
  preflight: '\u6267\u884c\u9884\u68c0',
  rerunPreflight: '\u91cd\u65b0\u9884\u68c0',
  confirm: '\u786e\u8ba4\u5e76\u63d0\u4ea4\u751f\u6210',
  cancel: '\u53d6\u6d88\u672a\u63d0\u4ea4 case',
  retry: '\u91cd\u8bd5\u5931\u8d25 case',
  createEvaluation: '\u521b\u5efa\u4eba\u5de5\u8bc4\u6d4b\u4efb\u52a1',
  explicitConfirm: '\u6211\u5df2\u6838\u5bf9\u6709\u6548/\u65e0\u6548 case\u3001\u6a21\u578b\u914d\u7f6e\u5feb\u7167\u548c\u8d39\u7528\u4fe1\u606f\u3002',
};

const generationReviewDialogKey = (item: GenerationPreflightCase) => {
  const datasetItemId = String(item.resolvedCase.datasetItemId || '').trim();
  if (datasetItemId) return `item:${datasetItemId}`;
  return `case:${getGenerationCaseId(item)}:${item.resolvedCase.rowIndex ?? 'unknown'}`;
};

const emptyMapping: GenerationInputMapping = {
  contentMappingVersion: 2,
  contentMapping: {
    version: 2,
    prompt: { column: '', format: 'text' },
    keyframes: { source: 'unused' },
    elements: { source: 'unused' },
    audios: { source: 'unused' },
  },
  mappingMode: 'mcp',
  compatibilityMode: 'strict',
  canonicalFieldMappings: {},
  promptColumn: '',
  referenceImageColumns: [],
  referenceAudioColumns: [],
  referenceVideoColumns: [],
  startImageColumn: '',
  endImageColumn: '',
  lyricsOrDialogueColumn: '',
  extraInputColumns: [],
  extraInputMappings: {},
};

const formatDateKey = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
};

const targetColumnFor = (model?: GenerationModelConfig) =>
  `${model?.displayName || 'generation'}_${formatDateKey()}`.replace(/[\\/:*?"<>|]/g, '_');

const statusLabel = (status?: string) => ({
  pending: '\u7b49\u5f85',
  submitting: '\u63d0\u4ea4\u4e2d',
  submitted: '\u5df2\u63d0\u4ea4',
  processing: '\u751f\u6210\u4e2d',
  reconciling: '\u72b6\u6001\u5f85\u6838\u5bf9',
  archiving: '\u5f52\u6863\u4e2d',
  succeeded: '\u6210\u529f',
  failed: '\u5931\u8d25',
  submission_unknown: '\u63d0\u4ea4\u7ed3\u679c\u672a\u77e5',
  cancelled: '\u5df2\u53d6\u6d88',
  completed: '\u5df2\u5b8c\u6210',
  partial: '\u90e8\u5206\u6210\u529f',
  running: '\u8fd0\u884c\u4e2d',
  queued: '\u6392\u961f\u4e2d',
  conflict: '\u56de\u586b\u51b2\u7a81',
}[status || ''] || status || '-');

const durabilityLabel = (durability?: GenerationAssetDurability) => ({
  vidmuse_asset: 'VidMuse \u7a33\u5b9a\u8d44\u4ea7',
  temporary: '\u4e34\u65f6\u94fe\u63a5',
  manueval_oss: 'ManuEval OSS',
}[durability || ''] || '');

const durabilityClass = (durability?: GenerationAssetDurability) => durability === 'temporary'
  ? 'text-amber-300'
  : durability === 'vidmuse_asset'
    ? 'text-emerald-300'
    : 'text-sky-300';

const formatElapsed = (milliseconds: number) => {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const hasConfiguredInputValue = (value: unknown) => {
  const parsed = parseStructuredGenerationValue(value);
  if (Array.isArray(parsed)) return parsed.length > 0;
  return parsed !== undefined && parsed !== null && String(parsed).trim() !== '';
};

const DatasetGenerationExecutionModal: React.FC<DatasetGenerationExecutionModalProps> = ({
  dataset,
  initialBatchId,
  initialCaseScope,
  onClose,
  onBatchChange,
  onCreateEvaluation,
}) => {
  const [step, setStep] = useState<GenerationStep>(initialBatchId ? 3 : 1);
  const [models, setModels] = useState<GenerationModelConfig[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [runtimeHealth, setRuntimeHealth] = useState<GenerationRuntimeHealth | null>(null);
  const [modelId, setModelId] = useState('');
  const [targetMode, setTargetMode] = useState<GenerationTargetMode>('new');
  const [targetColumn, setTargetColumn] = useState('');
  const [caseScopeMode, setCaseScopeMode] = useState<GenerationCaseScopeMode>(initialCaseScope ? 'filtered' : 'all');
  const [selectedDatasetItemIds, setSelectedDatasetItemIds] = useState<string[]>([]);
  const [inputMapping, setInputMapping] = useState<GenerationInputMapping>(emptyMapping);
  const [defaultControls, setDefaultControls] = useState<Record<string, unknown>>({});
  const [parameterBindings, setParameterBindings] = useState<Record<string, GenerationParameterBinding>>({});
  const [durationMode, setDurationMode] = useState<GenerationDurationSourceMode>('uniform');
  const [durationColumn, setDurationColumn] = useState('');
  const [seedMode, setSeedMode] = useState<GenerationSeedMode>('unused');
  const [fixedSeed, setFixedSeed] = useState(42);
  const [seedColumn, setSeedColumn] = useState('');
  const [assetBindings, setAssetBindings] = useState<GenerationAssetBinding[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [preflight, setPreflight] = useState<GenerationPreflightResult | null>(null);
  const [caseReviews, setCaseReviews] = useState<Record<string, GenerationCaseReview>>({});
  const [pendingReviewIds, setPendingReviewIds] = useState<string[]>([]);
  const [caseStatusFilter, setCaseStatusFilter] = useState<GenerationCaseStatusFilter>('needs_attention');
  const [caseIssueKey, setCaseIssueKey] = useState('');
  const [caseSearch, setCaseSearch] = useState('');
  const [reviewDialogItemId, setReviewDialogItemId] = useState('');
  const [bulkForceReason, setBulkForceReason] = useState('');
  const [bulkForceConfirmed, setBulkForceConfirmed] = useState(false);
  const [bulkPromptColumn, setBulkPromptColumn] = useState('');
  const [reviewsDirty, setReviewsDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [batch, setBatch] = useState<GenerationBatch | null>(null);
  const [queue, setQueue] = useState<GenerationQueueState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pollController = useRef<AbortController | null>(null);
  const [selectedBatchItemIds, setSelectedBatchItemIds] = useState<string[]>([]);
  const [batchEvents, setBatchEvents] = useState<GenerationJobEvent[]>([]);
  const [clock, setClock] = useState(Date.now());
  const audioProbeController = useRef<AbortController | null>(null);
  const audioDurationCache = useRef(new Map<string, number>());
  const [audioProbe, setAudioProbe] = useState<{
    status: 'idle' | 'probing' | 'ready';
    values: Record<string, GenerationReferenceAudioDuration>;
    issues: Record<string, string>;
  }>({ status: 'idle', values: {}, issues: {} });

  const mappings = useMemo(() => getDatasetColumnMappings(dataset), [dataset]);
  const headers = useMemo(() => Array.from(new Set([
    ...(dataset.inputSchema || []).map(field => field.key),
    ...Object.keys(dataset.items?.[0] || {}).filter(key => key !== '_originalData' && key !== DATASET_ITEM_ID_KEY),
  ])), [dataset]);
  const selectedModel = models.find(model => model.id === modelId);
  const outputColumns = useMemo(() => getGenerationOutputColumns(dataset), [dataset]);
  const targetOptions = useMemo(() => outputColumns.map(column => ({
    column,
    inspection: selectedModel ? inspectGenerationTargetColumn(dataset, {
      mode: 'fill_existing',
      targetColumn: column,
      modelName: selectedModel.modelName || selectedModel.id,
      outputModality: selectedModel.outputModality,
      configFingerprint: selectedModel.configFingerprint,
    }) : null,
  })), [dataset, outputColumns, selectedModel]);
  const targetInspection = useMemo(() => selectedModel ? inspectGenerationTargetColumn(dataset, {
    mode: targetMode,
    targetColumn,
    modelName: selectedModel.modelName || selectedModel.id,
    outputModality: selectedModel.outputModality,
    configFingerprint: selectedModel.configFingerprint,
  }) : null, [dataset, selectedModel, targetColumn, targetMode]);
  const presetColumns = useMemo(
    () => resolveVidMuseEvaluationPresetColumns(headers, dataset.inputSchema || []),
    [dataset.inputSchema, headers],
  );
  const usesVidMuseEvaluationPreset = hasVidMuseEvaluationPreset(headers, dataset.inputSchema || []);
  const scopeSnapshotCurrent = !initialCaseScope || generationCaseScopeIsCurrent(dataset, initialCaseScope);
  const scopedRows = useMemo(
    () => resolveGenerationCaseScopeRows(dataset, caseScopeMode, initialCaseScope),
    [caseScopeMode, dataset, initialCaseScope],
  );
  const scopeSourceRowIndexes = useMemo(
    () => caseScopeMode === 'filtered' ? scopedRows.map(item => item.sourceIndex) : undefined,
    [caseScopeMode, scopedRows],
  );
  const scopeEligibility = useMemo(() => summarizeGenerationCaseScope(
    scopedRows,
    targetColumn,
    row => !usesVidMuseEvaluationPreset
      || !selectedModel
      || generationRowMatchesModality(row, selectedModel.outputModality),
  ), [scopedRows, selectedModel, targetColumn, usesVidMuseEvaluationPreset]);
  const eligibleDatasetItemIds = scopeEligibility.eligibleDatasetItemIds;
  const scopeCounts = scopeEligibility.counts;
  const eligibleSelectionSignature = eligibleDatasetItemIds.join('|');
  const maxBatchSize = runtimeHealth?.maxBatchSize || 500;
  const selectionTooLarge = selectedDatasetItemIds.length > maxBatchSize;
  const mappingMode = inputMapping.mappingMode || 'assisted';
  const durationControl = selectedModel?.controls.find(control => control.key === 'duration');
  const unsupportedPresetParameters = useMemo(() => {
    if (!usesVidMuseEvaluationPreset || !selectedModel) return [];
    const supported = new Set(selectedModel.controls.map(control => control.key));
    const selected = new Set(selectedDatasetItemIds);
    return (['duration', 'aspect_ratio', 'resolution', 'generate_audio'] as const).flatMap(key => {
      const column = presetColumns[key];
      if (!column || supported.has(key)) return [];
      const affected = dataset.items.filter(row => {
        if (selected.size && !selected.has(String(row[DATASET_ITEM_ID_KEY] || ''))) return false;
        if (!generationRowMatchesModality(row, selectedModel.outputModality)) return false;
        const original = row._originalData && typeof row._originalData === 'object' && !Array.isArray(row._originalData)
          ? row._originalData as Record<string, unknown>
          : undefined;
        return hasConfiguredInputValue(row[column] ?? original?.[key]);
      }).length;
      return affected ? [{ key, column, affected }] : [];
    });
  }, [
    dataset.items,
    presetColumns,
    selectedDatasetItemIds,
    selectedModel,
    usesVidMuseEvaluationPreset,
  ]);
  const caseIssueOptions = useMemo(() => buildGenerationIssueOptions(preflight?.cases || []), [preflight]);
  const selectedCaseIssue = caseIssueOptions.find(option => option.key === caseIssueKey);
  const primaryPromptColumn = inputMapping.contentMappingVersion === 2
    ? inputMapping.contentMapping?.prompt.column
    : inputMapping.promptColumn || inputMapping.canonicalFieldMappings?.prompt;
  const promptReplacementColumns = useMemo(() => generationPromptReplacementColumns({
    headers,
    inputSchema: dataset.inputSchema || [],
    primaryPromptColumn,
    outputColumns,
    referenceColumns: dataset.columnMappings?.referenceColumns || [],
  }), [dataset.columnMappings?.referenceColumns, dataset.inputSchema, headers, outputColumns, primaryPromptColumn]);
  const filteredPreflightCases = useMemo(() => filterGenerationPreflightCases(preflight?.cases || [], {
    status: caseStatusFilter,
    issueKey: caseIssueKey,
    search: caseSearch,
  }), [caseIssueKey, caseSearch, caseStatusFilter, preflight]);
  const activeBulkForceCode = selectedCaseIssue?.severity === 'error'
    && GENERATION_FORCEABLE_PREFLIGHT_CODES.has(selectedCaseIssue.code)
    ? selectedCaseIssue.code
    : '';
  const reviewDialogItem = (preflight?.cases || []).find(item =>
    generationReviewDialogKey(item) === reviewDialogItemId);
  const reviewDialogIndex = filteredPreflightCases.findIndex(item =>
    generationReviewDialogKey(item) === reviewDialogItemId);
  const reviewDialogAllIndex = (preflight?.cases || []).findIndex(item =>
    generationReviewDialogKey(item) === reviewDialogItemId);
  const bulkPromptPlan = useMemo(() => applyBulkPromptColumnReview({
    cases: preflight?.cases || [],
    reviews: caseReviews,
    column: bulkPromptColumn,
  }), [bulkPromptColumn, caseReviews, preflight]);
  const datasetRowsById = useMemo(() => new Map(dataset.items.map(row => [
    String(row[DATASET_ITEM_ID_KEY] || ''),
    row,
  ])), [dataset.items]);
  const bulkPromptEmptyCount = bulkPromptColumn
    ? bulkPromptPlan.targetIds.filter(datasetItemId => (
        !hasConfiguredInputValue(datasetRowsById.get(datasetItemId)?.[bulkPromptColumn])
      )).length
    : 0;
  const reviewDialogDatasetItemId = String(reviewDialogItem?.resolvedCase.datasetItemId || '');
  const reviewDialogRow = datasetRowsById.get(reviewDialogDatasetItemId);
  const reviewDialogPromptColumnOptions = promptReplacementColumns.map(column => ({
    column,
    value: reviewDialogRow?.[column],
  }));
  const selectedBatchItems = batch?.items.filter(item => selectedBatchItemIds.includes(item.id)) || [];
  const selectableBatchItems = batch?.items.filter(item =>
    ['pending', 'failed', 'submission_unknown', 'cancelled'].includes(item.status)
    && item.resolutionStatus !== 'retrying') || [];
  const canSkipSelected = selectedBatchItems.length > 0 && selectedBatchItems.every(item =>
    ['pending', 'failed', 'submission_unknown'].includes(item.status));
  const canRetrySelected = selectedBatchItems.length > 0 && selectedBatchItems.every(item =>
    ['failed', 'submission_unknown', 'cancelled'].includes(item.status)
    && item.resolutionStatus !== 'retrying');
  const selectedHasDuplicateBillingRisk = selectedBatchItems.some(item =>
    item.status === 'submission_unknown' || item.error?.code === 'GENERATION_TIMEOUT');
  const selectableBatchSignature = selectableBatchItems.map(item => item.id).join('|');
  const pendingQueueLabel = useMemo(() => {
    if (!batch) return '\u7b49\u5f85\u516c\u5e73\u8c03\u5ea6';
    const modality = batch.modelConfig.outputModality;
    const lane = modality === 'video' ? queue?.video : queue?.image;
    if (modality === 'video') {
      const modelName = String(batch.modelConfig.modelName || batch.modelConfig.id || '').toLowerCase();
      const modelQueue = queue?.video.models?.find(item => item.modelName.toLowerCase() === modelName);
      if (modelQueue && modelQueue.active >= modelQueue.effectiveLimit) {
        return `\u7b49\u5f85\u6a21\u578b\u5bb9\u91cf ${modelQueue.active}/${modelQueue.effectiveLimit}`;
      }
    }
    if (lane && lane.active >= lane.limit) {
      return `\u7b49\u5f85\u5168\u5c40${modality === 'video' ? '\u89c6\u9891' : '\u56fe\u7247'}\u5bb9\u91cf ${lane.active}/${lane.limit}`;
    }
    return '\u7b49\u5f85\u516c\u5e73\u8c03\u5ea6';
  }, [batch, queue]);


  const applyModel = (model?: GenerationModelConfig) => {
    const exactColumn = (key: string) =>
      presetColumns[key as keyof typeof presetColumns]
      || headers.find(header => header.trim().toLowerCase() === key.toLowerCase())
      || '';
    const duration = model?.controls.find(control => control.key === 'duration');
    const nextParameterBindings = {
      ...Object.fromEntries([
      ...(model?.controls || [])
        .filter(control => control.key !== 'duration' && control.key !== 'seed')
        .map(control => [control.key, { source: 'unused' }]),
      ...(model?.advancedParameters || []).map(parameter => [parameter.key, { source: 'unused' }]),
      ]),
      ...defaultVidMuseEvaluationParameterColumns(
        headers,
        (model?.controls || []).map(control => control.key),
        dataset.inputSchema || [],
      ),
    } as Record<string, GenerationParameterBinding>;
    const presetMapping = model
      ? defaultGenerationInputMapping(
          dataset,
          headers,
          mappings,
          model.outputModality === 'image' ? 'image' : 'video',
        )
      : defaultGenerationInputMapping(dataset, headers, mappings);
    const presetDurationColumn = model?.controls.some(control => control.key === 'duration')
      && usesVidMuseEvaluationPreset
      ? exactColumn('duration')
      : '';

    setModelId(model?.id || '');
    setTargetMode('new');
    setTargetColumn(targetColumnFor(model));
    setDefaultControls(duration && !presetDurationColumn
      ? { duration: duration.defaultValue ?? duration.options?.[0] ?? '' }
      : {});
    setParameterBindings(nextParameterBindings);
    setDurationMode(presetDurationColumn ? 'column' : 'uniform');
    setDurationColumn(presetDurationColumn);
    setSeedMode('unused');
    setFixedSeed(42);
    setSeedColumn('');
    audioProbeController.current?.abort();
    setAudioProbe({ status: 'idle', values: {}, issues: {} });
    setInputMapping(presetMapping);
    setPreflight(null);
    setCaseReviews({});
    setPendingReviewIds([]);
    setBulkPromptColumn('');
    setReviewsDirty(false);
    setConfirmed(false);
  };

  useEffect(() => {
    setInputMapping(defaultGenerationInputMapping(
      dataset,
      headers,
      mappings,
      selectedModel?.outputModality,
    ));
  }, [dataset.id, dataset.version]);

  useEffect(() => {
    if (initialBatchId) return;
    setSelectedDatasetItemIds(eligibleDatasetItemIds);
    setPreflight(null);
    setConfirmed(false);
  }, [
    dataset.id, dataset.version, eligibleSelectionSignature, initialBatchId, targetColumn, targetMode,
  ]);

  useEffect(() => {
    if (initialBatchId) {
      setModelsLoading(false);
      return undefined;
    }
    let active = true;
    setModelsLoading(true);
    Promise.all([listExecutionModels(), getGenerationRuntimeHealth()])
      .then(([loaded, health]) => {
        if (!active) return;
        setModels(loaded);
        setRuntimeHealth(health);
        if (!initialBatchId) applyModel(loaded[0]);
      })
      .catch(reason => active && setError(errorMessage(reason)))
      .finally(() => active && setModelsLoading(false));
    return () => { active = false; };
  }, [initialBatchId]);

  const selectedAudioCases = useMemo(() => {
    const selectedIds = new Set(selectedDatasetItemIds);
    return (dataset.items || []).flatMap(row => {
      const datasetItemId = String(row[DATASET_ITEM_ID_KEY] || '').trim();
      if (!datasetItemId || !selectedIds.has(datasetItemId)) return [];
      const content = inputMapping.contentMappingVersion === 2
        && inputMapping.contentMapping?.version === 2
        ? inputMapping.contentMapping
        : undefined;
      if (content) {
        const audioUrls = content.audios.source === 'array_column'
          ? uniqueGenerationReferences([row[content.audios.column]])
          : content.audios.source === 'builder'
            ? uniqueGenerationReferences(content.audios.items.map(item => row[item.urlColumn]))
            : [];
        const imageCount = content.keyframes.source === 'array_column'
          ? uniqueGenerationReferences([row[content.keyframes.column]]).length
          : content.keyframes.source === 'columns'
            ? Number(hasConfiguredInputValue(row[content.keyframes.firstColumn]))
              + Number(Boolean(content.keyframes.lastColumn)
                && hasConfiguredInputValue(row[content.keyframes.lastColumn || '']))
            : 0;
        const hasElements = content.elements.source === 'array_column'
          ? hasConfiguredInputValue(row[content.elements.column])
          : content.elements.source === 'builder'
            ? content.elements.items.some(item => {
                if (item.mode === 'video') {
                  return Boolean(item.videoColumn && hasConfiguredInputValue(row[item.videoColumn]));
                }
                if (item.mode === 'element_id') {
                  return Boolean(item.elementIdColumn && hasConfiguredInputValue(row[item.elementIdColumn]));
                }
                return Boolean(
                  (item.frontalImageColumn && hasConfiguredInputValue(row[item.frontalImageColumn]))
                  || (item.referenceImageArrayColumn
                    && hasConfiguredInputValue(row[item.referenceImageArrayColumn]))
                  || (item.referenceImageColumns || []).some(column =>
                    hasConfiguredInputValue(row[column])),
                );
              })
            : false;
        const generationType = hasElements || audioUrls.length
          ? 'reference_to_video'
          : imageCount > 1
            ? 'images_to_video'
            : imageCount === 1
              ? 'image_to_video'
              : 'text_to_video';
        return [{ datasetItemId, audioUrls, generationType }];
      }

      if (mappingMode === 'mcp') {
        const canonicalMappings = inputMapping.canonicalFieldMappings || {};
        const audioColumn = canonicalMappings.audios;
        const imageColumn = canonicalMappings.image_urls || canonicalMappings.images;
        const elementsColumn = canonicalMappings.elements;
        const audioUrls = uniqueGenerationReferences(audioColumn ? [row[audioColumn]] : []);
        const imageCount = uniqueGenerationReferences(imageColumn ? [row[imageColumn]] : []).length;
        const hasElements = Boolean(elementsColumn && hasConfiguredInputValue(row[elementsColumn]));
        const generationType = hasElements || audioUrls.length
          ? 'reference_to_video'
          : imageCount > 1
            ? 'images_to_video'
            : imageCount === 1
              ? 'image_to_video'
              : 'text_to_video';
        return [{ datasetItemId, audioUrls, generationType }];
      }

      const audioUrls = uniqueGenerationReferences(
        (inputMapping.referenceAudioColumns || []).map(column => row[column]),
      );
      const hasReferenceVideos = uniqueGenerationReferences(
        (inputMapping.referenceVideoColumns || []).map(column => row[column]),
      ).length > 0;
      const hasStartImage = Boolean(inputMapping.startImageColumn
        && uniqueGenerationReferences([row[inputMapping.startImageColumn]]).length);
      const hasEndImage = Boolean(inputMapping.endImageColumn
        && uniqueGenerationReferences([row[inputMapping.endImageColumn]]).length);
      const hasReferenceImages = uniqueGenerationReferences(
        (inputMapping.referenceImageColumns || []).map(column => row[column]),
      ).length > 0;
      const elementsColumn = inputMapping.extraInputMappings?.elements;
      const hasRawElements = Boolean(elementsColumn && hasConfiguredInputValue(row[elementsColumn]));
      const generationType = hasReferenceVideos
        ? 'reference_to_video'
        : hasStartImage || hasEndImage
          ? (hasEndImage ? 'images_to_video' : 'image_to_video')
          : hasReferenceImages || hasRawElements
            ? 'reference_to_video'
            : 'text_to_video';
      return [{ datasetItemId, audioUrls, generationType }];
    });
  }, [dataset.items, inputMapping, mappingMode, selectedDatasetItemIds]);

  useEffect(() => {
    audioProbeController.current?.abort();
    if (durationMode !== 'reference_audio' || !selectedModel || !durationControl) {
      setAudioProbe({ status: 'idle', values: {}, issues: {} });
      return undefined;
    }

    const controller = new AbortController();
    audioProbeController.current = controller;
    setAudioProbe({ status: 'probing', values: {}, issues: {} });
    const probeableUrls = selectedAudioCases
      .filter(item => item.audioUrls.length === 1)
      .map(item => item.audioUrls[0]);

    void probeAudioDurations(probeableUrls, {
      cache: audioDurationCache.current,
      concurrency: 4,
      timeoutMs: 12_000,
      signal: controller.signal,
    }).then(results => {
      if (controller.signal.aborted) return;
      const values: Record<string, GenerationReferenceAudioDuration> = {};
      const issues: Record<string, string> = {};
      for (const item of selectedAudioCases) {
        if (item.audioUrls.length !== 1) {
          issues[item.datasetItemId] = item.audioUrls.length
            ? '\u8ddf\u968f\u65f6\u957f\u6bcf\u4e2a case \u53ea\u80fd\u9009\u4e2d\u4e00\u6761\u53c2\u8003\u97f3\u9891\u3002'
            : '\u8ddf\u968f\u65f6\u957f\u9700\u8981\u4e00\u6761\u53c2\u8003\u97f3\u9891\u3002';
          continue;
        }
        const audioUrl = item.audioUrls[0];
        const probed = results[audioUrl];
        if (!probed?.seconds) {
          issues[item.datasetItemId] = probed?.error || '\u65e0\u6cd5\u8bfb\u53d6\u97f3\u9891\u65f6\u957f\u3002';
          continue;
        }
        const normalized = resolveReferenceAudioDuration(selectedModel, probed.seconds, item.generationType);
        if (!normalized.valid || normalized.resolvedDuration === undefined) {
          issues[item.datasetItemId] = normalized.error?.message || '\u97f3\u9891\u65f6\u957f\u4e0d\u53d7\u5f53\u524d\u6a21\u578b\u652f\u6301\u3002';
          continue;
        }
        values[item.datasetItemId] = {
          audioUrl,
          detectedSeconds: normalized.detectedSeconds,
          resolvedDuration: normalized.resolvedDuration,
        };
      }
      setAudioProbe({ status: 'ready', values, issues });
    }).catch(reason => {
      if ((reason as Error)?.name === 'AbortError' || controller.signal.aborted) return;
      const message = errorMessage(reason);
      setAudioProbe({
        status: 'ready',
        values: {},
        issues: Object.fromEntries(selectedAudioCases.map(item => [item.datasetItemId, message])),
      });
    });

    return () => controller.abort();
  }, [
    durationMode,
    durationControl,
    selectedModel,
    selectedAudioCases,
  ]);

  const startPolling = (batchId: string) => {
    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    void waitForExecutionBatch(batchId, setBatch, controller.signal)
      .catch(reason => {
        if ((reason as Error)?.name !== 'AbortError') setError(errorMessage(reason));
      });
  };

  useEffect(() => {
    if (!initialBatchId) return undefined;
    setBusy(true);
    getExecutionBatch(initialBatchId)
      .then(loaded => {
        setBatch(loaded);
        if (!isTerminalGenerationBatch(loaded)) startPolling(loaded.id);
      })
      .catch(reason => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
    return () => pollController.current?.abort();
  }, [initialBatchId]);

  useEffect(() => {
    setSelectedBatchItemIds([]);
  }, [batch?.id]);

  useEffect(() => {
    if (!preflight) return;
    setCaseStatusFilter(resolveDefaultGenerationCaseStatus(preflight.cases));
    setCaseIssueKey('');
    setCaseSearch('');
    setReviewDialogItemId(current => (
      current && preflight.cases.some(item => generationReviewDialogKey(item) === current)
        ? current
        : ''
    ));
    setBulkForceReason('');
    setBulkForceConfirmed(false);
    setBulkPromptColumn('');
  }, [preflight?.requestHash]);

  useEffect(() => {
    const selectable = new Set(selectableBatchItems.map(item => item.id));
    setSelectedBatchItemIds(current => current.filter(itemId => selectable.has(itemId)));
  }, [selectableBatchSignature]);

  useEffect(() => {
    if (!batch || isTerminalGenerationBatch(batch)) return undefined;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [batch?.id, batch?.status, batch?.writebackStatus]);
  useEffect(() => {
    if (!batch || isTerminalGenerationBatch(batch)) return undefined;
    let mounted = true;
    const refreshQueue = () => {
      void getGenerationQueue()
        .then(value => { if (mounted) setQueue(value); })
        .catch(() => undefined);
    };
    refreshQueue();
    const interval = window.setInterval(refreshQueue, 5_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [batch?.id, batch?.status, batch?.writebackStatus]);

  useEffect(() => {
    if (!batch?.id) {
      setBatchEvents([]);
      return;
    }
    void listExecutionBatchEvents(batch.id)
      .then(setBatchEvents)
      .catch(reason => console.error('Failed to load generation batch events:', reason));
  }, [batch?.id, batch?.updatedAt]);

  useEffect(() => () => {
    pollController.current?.abort();
    audioProbeController.current?.abort();
  }, []);

  const invalidatePreflight = () => {
    setPreflight(null);
    setCaseReviews({});
    setPendingReviewIds([]);
    setCaseIssueKey('');
    setCaseSearch('');
    setReviewDialogItemId('');
    setBulkForceReason('');
    setBulkForceConfirmed(false);
    setBulkPromptColumn('');
    setReviewsDirty(false);
    setConfirmed(false);
  };

  const saveCaseReview = (datasetItemId: string, review: GenerationCaseReview) => {
    setCaseReviews(current => ({ ...current, [datasetItemId]: review }));
    setPendingReviewIds(current => Array.from(new Set([...current, datasetItemId])));
    setReviewsDirty(true);
    setConfirmed(false);
  };

  const changeCaseScopeMode = (mode: GenerationCaseScopeMode) => {
    if (mode === caseScopeMode) return;
    const nextRows = resolveGenerationCaseScopeRows(dataset, mode, initialCaseScope);
    const nextEligibility = summarizeGenerationCaseScope(
      nextRows,
      targetColumn,
      row => !usesVidMuseEvaluationPreset
        || !selectedModel
        || generationRowMatchesModality(row, selectedModel.outputModality),
    );
    setCaseScopeMode(mode);
    setSelectedDatasetItemIds(nextEligibility.eligibleDatasetItemIds);
    invalidatePreflight();
  };

  const acceptFindingRule = (ruleId: string) => {
    if (!preflight) return;
    const next = { ...caseReviews };
    const affectedIds: string[] = [];
    preflight.cases.forEach(item => {
      const datasetItemId = String(item.resolvedCase.datasetItemId || '');
      const findings = (item.resolvedCase.compilerAudit?.contractFindings || []) as GenerationContractFinding[];
      findings.filter(finding => finding.ruleId === ruleId && finding.disposition !== 'force_required')
        .forEach(finding => {
          if (datasetItemId) affectedIds.push(datasetItemId);
          const current = next[datasetItemId] || {};
          next[datasetItemId] = {
            ...current,
            acceptedFindingIds: Array.from(new Set([...(current.acceptedFindingIds || []), finding.id])),
            rejectedFindingIds: (current.rejectedFindingIds || []).filter(id => id !== finding.id),
          };
        });
    });
    setCaseReviews(next);
    setPendingReviewIds(current => Array.from(new Set([...current, ...affectedIds])));
    setReviewsDirty(true);
    setConfirmed(false);
  };

  const setPresetParameterOmission = (key: string, omitted: boolean) => {
    setParameterBindings(current => {
      const next = { ...current };
      if (omitted) next[key] = { source: 'unused' };
      else delete next[key];
      return next;
    });
    invalidatePreflight();
  };

  const applyBulkForceReview = () => {
    if (!preflight || !activeBulkForceCode) return;
    setCaseReviews(current => applyBulkGenerationForceReview({
      cases: filteredPreflightCases,
      reviews: current,
      errorCode: activeBulkForceCode,
      reason: bulkForceReason.trim(),
      duplicateBillingRiskConfirmed: bulkForceConfirmed,
    }));
    setPendingReviewIds(current => Array.from(new Set([
      ...current,
      ...filteredPreflightCases
        .filter(item => item.errors.some(issue => issue.code === activeBulkForceCode))
        .map(item => String(item.resolvedCase.datasetItemId || ''))
        .filter(Boolean),
    ])));
    setReviewsDirty(true);
    setConfirmed(false);
  };

  const applyBulkPromptColumnOverride = async () => {
    if (!preflight || !bulkPromptColumn || bulkPromptPlan.expertConflictIds.length || bulkPromptPlan.missingStableIdCount) return;
    const nextReviews = bulkPromptPlan.reviews;
    setCaseReviews(nextReviews);
    setPendingReviewIds(current => Array.from(new Set([
      ...current,
      ...bulkPromptPlan.targetIds,
    ])));
    setReviewsDirty(true);
    setConfirmed(false);
    try {
      await runPreflight(nextReviews, true);
    } catch {
      // runPreflight keeps the pending reviews and exposes the server error in the modal.
    }
  };

  const changeTargetMode = (mode: GenerationTargetMode) => {
    const nextColumn = mode === 'new'
      ? targetColumnFor(selectedModel)
      : targetOptions.find(option => option.inspection && !option.inspection.errors.length)?.column || '';
    setTargetMode(mode);
    setTargetColumn(nextColumn);
    invalidatePreflight();
  };

  const updateCaseSelection = (ids: string[]) => {
    setSelectedDatasetItemIds(ids);
    invalidatePreflight();
  };

  const updateMapping = (patch: Partial<GenerationInputMapping>) => {
    setInputMapping(current => ({ ...current, ...patch }));
    invalidatePreflight();
  };

  const changeDurationMode = (mode: GenerationDurationSourceMode) => {
    setDurationMode(mode);
    if (mode !== 'column') setDurationColumn('');
    invalidatePreflight();
  };

  const buildRequest = (reviews: Record<string, GenerationCaseReview> = caseReviews): GenerationPreflightRequest => {
    if (!selectedModel) throw new Error('Select a model before preflight.');
    const requestDefaultControls = durationControl && durationMode === 'uniform'
      ? { duration: defaultControls.duration }
      : {};

    let durationSource: GenerationPreflightRequest['durationSource'];
    if (durationControl) {
      if (durationMode === 'uniform') {
        durationSource = { mode: 'uniform' };
      } else if (durationMode === 'column') {
        durationSource = { mode: 'column', column: durationColumn };
      } else {
        if (audioProbe.status !== 'ready') {
          throw new Error(copy.probingAudio);
        }
        durationSource = {
          mode: 'reference_audio',
          referenceAudio: audioProbe.values,
        };
      }
    }

    return {
      datasetId: dataset.id,
      datasetVersion: dataset.version || 1,
      datasetName: dataset.name,
      modelName: selectedModel.modelName || selectedModel.id,
      targetColumn: targetColumn.trim(),
      targetMode,
      selectedDatasetItemIds,
      inputMapping: {
        ...inputMapping,
        referenceVideoColumns: inputMapping.referenceVideoColumns || [],
      },
      defaultControls: requestDefaultControls,
      perCaseControlColumns: {},
      parameterBindings,
      durationSource,
      seedMode,
      seedPolicyVersion: 2,
      fixedSeed: seedMode === 'fixed' ? fixedSeed : undefined,
      seedColumn: seedMode === 'column' ? seedColumn : undefined,
      assetBindings,
      caseReviews: reviews,
    };
  };

  const runPreflight = async (
    reviews: Record<string, GenerationCaseReview> = caseReviews,
    throwOnError = false,
  ) => {
    setError('');
    setBusy(true);
    setConfirmed(false);
    try {
      const next = await createExecutionPreflight(buildRequest(reviews));
      setPreflight(next);
      setPendingReviewIds([]);
      setBulkPromptColumn('');
      setReviewsDirty(false);
      setStep(3);
      return next;
    } catch (reason) {
      setError(errorMessage(reason));
      if (throwOnError) throw reason;
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const saveCaseReviewAndRepreflight = async (datasetItemId: string, review: GenerationCaseReview) => {
    const nextReviews = { ...caseReviews, [datasetItemId]: review };
    setCaseReviews(nextReviews);
    setPendingReviewIds(current => Array.from(new Set([...current, datasetItemId])));
    setReviewsDirty(true);
    setConfirmed(false);
    const nextPreflight = await runPreflight(nextReviews, true);
    return nextPreflight?.cases.find(item => (
      String(item.resolvedCase.datasetItemId || '') === datasetItemId
    ));
  };

  const confirmPreflight = async () => {
    if (!preflight || !confirmed) return;
    setError('');
    setBusy(true);
    try {
      const created = await confirmExecutionPreflight(preflight.id);
      const loaded = await getExecutionBatch(created.batchId);
      setBatch(loaded);
      setPreflight(null);
      onBatchChange?.(loaded.id);
      setConfirmed(false);
      if (!isTerminalGenerationBatch(loaded)) startPolling(loaded.id);
    } catch (reason) {
      const typed = reason as Error & { status?: number };
      if (typed.status === 409 || typed.status === 410) {
        setPreflight(null);
        setConfirmed(false);
      }
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const cancelBatch = async () => {
    if (!batch) return;
    setBusy(true);
    setError('');
    try {
      await cancelExecutionBatch(batch.id);
      const loaded = await getExecutionBatch(batch.id);
      setBatch(loaded);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const skipSelectedItems = async () => {
    if (!batch || !canSkipSelected) return;
    setBusy(true);
    setError('');
    try {
      const loaded = await skipExecutionItems(batch.id, selectedBatchItemIds);
      setBatch(loaded);
      setSelectedBatchItemIds([]);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const retrySelectedItems = async () => {
    if (!batch || !canRetrySelected) return;
    if (selectedHasDuplicateBillingRisk) {
      const accepted = window.confirm(
        '\u9009\u4e2d case \u53ef\u80fd\u5df2\u7ecf\u6263\u8d39\u3002\u91cd\u8bd5\u53ef\u80fd\u4ea7\u751f\u91cd\u590d\u8ba1\u8d39\uff0c\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f',
      );
      if (!accepted) return;
    }
    setBusy(true);
    setError('');
    try {
      const nextPreflight = await createRetryPreflight(
        batch.id,
        selectedBatchItemIds,
        selectedHasDuplicateBillingRisk,
      );
      setPreflight(nextPreflight);
      setConfirmed(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    const uploaded: GenerationAssetBinding[] = [];
    try {
      const values = Array.from(files);
      for (let index = 0; index < values.length; index += 1) {
        const file = values[index];
        setUploadProgress(`${index + 1}/${values.length} ${file.webkitRelativePath || file.name}`);
        const asset = await uploadGenerationAsset(dataset.id, file);
        uploaded.push(asset);
      }
      setAssetBindings(current => {
        const byPath = new Map(current.map(asset => [asset.relativePath.toLowerCase(), asset]));
        uploaded.forEach(asset => byPath.set(asset.relativePath.toLowerCase(), asset));
        return Array.from(byPath.values());
      });
      invalidatePreflight();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  const renderColumnSelect = (
    value: string | undefined,
    onChange: (value: string) => void,
    label: string,
    elementKey?: string,
  ) => (
    <label key={elementKey} className="block text-xs text-slate-300">
      <span className="mb-1.5 block text-slate-400">{label}</span>
      <select
        value={value || ''}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100"
      >
        <option value="">{copy.none}</option>
        {headers.map(header => <option key={header} value={header}>{header}</option>)}
      </select>
    </label>
  );

  const renderControl = (control: GenerationModelConfig['controls'][number]) => {
    const value = defaultControls[control.key] ?? '';
    const setValue = (next: unknown) => {
      setDefaultControls(current => ({ ...current, [control.key]: next }));
      invalidatePreflight();
    };
    if (control.type === 'toggle') {
      return (
        <label key={control.key} className="flex h-10 items-center justify-between gap-3 border-b border-white/5 text-sm text-slate-200">
          <span>{control.label}</span>
          <input type="checkbox" checked={Boolean(value)} onChange={event => setValue(event.target.checked)} />
        </label>
      );
    }
    if (control.type === 'select') {
      return (
        <label key={control.key} className="block text-xs text-slate-400">
          <span className="mb-1.5 block">{control.label}</span>
          <select value={String(value)} onChange={event => setValue(event.target.value)} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100">
            {(control.options || []).map(option => <option key={option} value={option}>{option}{control.unit || ''}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label key={control.key} className="block text-xs text-slate-400">
        <span className="mb-1.5 block">{control.label}</span>
        {control.type === 'json' ? (
          <textarea value={String(value)} onChange={event => setValue(event.target.value)} rows={3} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100" />
        ) : (
          <input type={control.type === 'number' ? 'number' : 'text'} value={String(value)} onChange={event => setValue(event.target.value)} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" />
        )}
      </label>
    );
  };

  const updateParameterBinding = (key: string, binding: GenerationParameterBinding) => {
    setParameterBindings(current => ({ ...current, [key]: binding }));
    invalidatePreflight();
  };

  const changeParameterSource = (
    key: string,
    source: GenerationParameterBinding['source'],
    control?: GenerationModelConfig['controls'][number],
    advanced = false,
  ) => {
    const current = parameterBindings[key];
    const valueType = current && current.source !== 'unused' && current.valueType
      ? current.valueType
      : 'string';
    if (source === 'unused') {
      updateParameterBinding(key, { source: 'unused' });
    } else if (source === 'column') {
      updateParameterBinding(key, {
        source: 'column',
        column: current?.source === 'column' ? current.column : '',
        ...(advanced ? { valueType } : {}),
      });
    } else {
      updateParameterBinding(key, {
        source: 'uniform',
        value: current?.source === 'uniform'
          ? current.value
          : control?.defaultValue ?? (control?.type === 'toggle' ? false : ''),
        ...(advanced ? { valueType } : {}),
      });
    }
  };

  const renderUniformParameterValue = (
    value: unknown,
    setValue: (value: unknown) => void,
    control?: GenerationModelConfig['controls'][number],
    valueType?: GenerationParameterValueType,
  ) => {
    const type = control?.type || valueType || 'string';
    if (type === 'toggle' || type === 'boolean') {
      return (
        <label className="flex h-10 items-center justify-between gap-3 border-b border-white/5 text-sm text-slate-200">
          <span>{'\u7edf\u4e00\u503c'}</span>
          <input type="checkbox" checked={Boolean(value)} onChange={event => setValue(event.target.checked)} />
        </label>
      );
    }
    if (control?.type === 'select') {
      return (
        <select value={String(value ?? '')} onChange={event => setValue(event.target.value)} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100">
          {(control.options || []).map(option => <option key={option} value={option}>{option}{control.unit || ''}</option>)}
        </select>
      );
    }
    if (type === 'json') {
      return <textarea value={String(value ?? '')} onChange={event => setValue(event.target.value)} rows={3} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100" />;
    }
    return <input type={type === 'number' ? 'number' : 'text'} value={String(value ?? '')} onChange={event => setValue(event.target.value)} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" />;
  };

  const renderParameterBinding = ({
    key,
    label,
    control,
    advanced = false,
  }: {
    key: string;
    label: string;
    control?: GenerationModelConfig['controls'][number];
    advanced?: boolean;
  }) => {
    const binding = parameterBindings[key] || { source: 'unused' as const };
    const valueType = binding.source !== 'unused' ? binding.valueType || 'string' : 'string';
    return (
      <div key={key} data-generation-parameter={key} className="border border-white/10 bg-black/10 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-200">{label}</span>
          {advanced && <span className="text-[11px] text-amber-300">{'\u672a\u7ecf\u5408\u540c\u9a8c\u8bc1 / extra_params'}</span>}
        </div>
        <div className="mb-3 flex w-fit max-w-full flex-wrap border border-white/10 bg-black/20 p-1" role="group" aria-label={`${label} source`}>
          {([['uniform', copy.uniformDuration], ['column', copy.fromColumn], ['unused', copy.none]] as const).map(([source, sourceLabel]) => (
            <button
              key={source}
              type="button"
              aria-pressed={binding.source === source}
              onClick={() => changeParameterSource(key, source, control, advanced)}
              className={`px-3 py-1.5 text-xs ${binding.source === source ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
            >
              {sourceLabel}
            </button>
          ))}
        </div>
        {advanced && binding.source !== 'unused' && (
          <label className="mb-3 block text-xs text-slate-400">
            <span className="mb-1.5 block">Value type</span>
            <select
              value={valueType}
              onChange={event => updateParameterBinding(key, {
                ...binding,
                valueType: event.target.value as GenerationParameterValueType,
              })}
              className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {(['string', 'number', 'boolean', 'json'] as const).map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
        )}
        {binding.source === 'uniform' && renderUniformParameterValue(
          binding.value,
          value => updateParameterBinding(key, { ...binding, value }),
          control,
          advanced ? valueType : undefined,
        )}
        {binding.source === 'column' && renderColumnSelect(
          binding.column,
          column => updateParameterBinding(key, { ...binding, column }),
          copy.fromColumn,
          `${key}-parameter-column`,
        )}
      </div>
    );
  };

  const terminal = isTerminalGenerationBatch(batch || undefined);
  const completedItems = batch?.items.filter(item => ['succeeded', 'failed', 'submission_unknown', 'cancelled'].includes(item.status)).length || 0;
  const temporaryResultCount = batch?.items.filter(item => item.status === 'succeeded' && item.durability === 'temporary').length || 0;
  const progress = batch?.total ? Math.round((completedItems / batch.total) * 100) : 0;
  const targetBlocked = Boolean(targetInspection?.errors.length);
  const durationBlocked = Boolean(durationControl && (
    (durationMode === 'column' && !durationColumn)
    || (durationMode === 'reference_audio' && audioProbe.status !== 'ready')
  ));
  const selectionBlocked = !selectedDatasetItemIds.length || selectionTooLarge || durationBlocked;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-3 md:p-6">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden border border-white/15 bg-slate-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-100">
              <Wand2 size={20} className="text-amber-400" /> {copy.title}
            </h2>
            <p className="mt-1 text-xs text-slate-400">{dataset.name} / v{dataset.version || 1} / {dataset.items.length} cases</p>
          </div>
          <button type="button" onClick={onClose} title={copy.close} aria-label={copy.close} className="p-2 text-slate-400 hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </header>

        <nav className="flex gap-2 border-b border-white/10 px-5 py-3">
          {([
            [1, copy.modelStep],
            [2, copy.mappingStep],
            [3, copy.reviewStep],
          ] as const).map(([number, label]) => (
            <button
              key={number}
              type="button"
              onClick={() => !batch && setStep(number)}
              disabled={Boolean(batch) && number !== 3}
              className={`px-3 py-1.5 text-xs font-medium ${step === number ? 'border-b-2 border-amber-400 text-amber-300' : 'text-slate-400 hover:text-slate-200'} disabled:opacity-40`}
            >
              {number}. {label}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              {modelsLoading ? (
                <div className="flex items-center gap-2 py-12 text-sm text-slate-300"><Loader2 size={17} className="animate-spin" /> {copy.loadingModels}</div>
              ) : (
                <>
                  <section>
                    <h3 className="mb-3 text-sm font-semibold text-slate-100">VidMuse model</h3>
                    <select
                      value={modelId}
                      onChange={event => applyModel(models.find(model => model.id === event.target.value))}
                      className="w-full border border-white/10 bg-slate-900 px-3 py-3 text-sm text-slate-100"
                    >
                      {models.map(model => (
                        <option key={model.id} value={model.id}>{model.displayName} ({model.outputModality})</option>
                      ))}
                    </select>
                    {!models.length && <p className="mt-2 text-sm text-red-300">No enabled image or video model configuration is available.</p>}
                  </section>

                  {selectedModel && (
                    <section className="grid gap-4 border-y border-white/10 py-4 md:grid-cols-2">
                      <div>
                        <div className="text-xs text-slate-500">Model name</div>
                        <div className="mt-1 text-sm text-slate-100">{selectedModel.modelName || selectedModel.id}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Provider / modality</div>
                        <div className="mt-1 text-sm text-slate-100">{selectedModel.provider || '-'} / {selectedModel.outputModality}</div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs text-slate-500">Capabilities</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(selectedModel.capabilities || []).map(capability => <span key={capability} className="border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">{capability}</span>)}
                        </div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs text-slate-500">Configuration fingerprint</div>
                        <code className="mt-1 block break-all text-xs text-slate-300">{selectedModel.configFingerprint || '-'}</code>
                      </div>
                    </section>
                  )}

                  <section>
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">{copy.outputColumn}</h3>
                        <p className="mt-1 text-xs text-slate-400">{'\u65b0\u5efa\u5217\u7528\u4e8e\u65b0\u4e00\u8f6e\u751f\u6210\uff1b\u8865\u9f50\u6a21\u5f0f\u53ea\u5904\u7406\u5df2\u6709\u8f93\u51fa\u5217\u4e2d\u7684\u7a7a\u767d case\u3002'}</p>
                      </div>
                      <div className="flex border border-white/10 bg-black/20 p-1" role="group" aria-label={'\u76ee\u6807\u5217\u6a21\u5f0f'}>
                        <button
                          type="button"
                          aria-pressed={targetMode === 'new'}
                          onClick={() => changeTargetMode('new')}
                          className={`px-3 py-1.5 text-xs ${targetMode === 'new' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
                        >
                          {'\u65b0\u5efa\u8f93\u51fa\u5217'}
                        </button>
                        <button
                          type="button"
                          aria-pressed={targetMode === 'fill_existing'}
                          onClick={() => changeTargetMode('fill_existing')}
                          className={`px-3 py-1.5 text-xs ${targetMode === 'fill_existing' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
                        >
                          {'\u8865\u9f50\u5df2\u6709\u5217'}
                        </button>
                      </div>
                    </div>

                    {targetMode === 'new' ? (
                      <label className="block text-xs text-slate-400">
                        <span className="mb-1.5 block">{'\u65b0\u5217\u540d'}</span>
                        <input
                          value={targetColumn}
                          onChange={event => { setTargetColumn(event.target.value); invalidatePreflight(); }}
                          className="w-full border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-slate-100"
                        />
                      </label>
                    ) : (
                      <label className="block text-xs text-slate-400">
                        <span className="mb-1.5 block">{'\u9009\u62e9\u5f85\u8865\u9f50\u7684\u6a21\u578b\u8f93\u51fa\u5217'}</span>
                        <select
                          value={targetColumn}
                          onChange={event => { setTargetColumn(event.target.value); invalidatePreflight(); }}
                          className="w-full border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-slate-100"
                        >
                          <option value="">{'\u8bf7\u9009\u62e9\u8f93\u51fa\u5217'}</option>
                          {targetOptions.map(option => (
                            <option
                              key={option.column}
                              value={option.column}
                              disabled={Boolean(option.inspection?.errors.length)}
                            >
                              {option.column} ({'\u5df2\u5b8c\u6210'} {option.inspection?.completedCount || 0} / {'\u7a7a\u767d'} {option.inspection?.emptyCount || 0})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {targetMode === 'fill_existing' && !targetOptions.length && (
                      <div className="mt-3 flex items-start gap-2 text-sm text-amber-300">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span>{'\u5f53\u524d\u8bc4\u6d4b\u96c6\u6ca1\u6709\u53ef\u8865\u9f50\u7684\u6a21\u578b\u8f93\u51fa\u5217\u3002'}</span>
                      </div>
                    )}
                    {targetInspection?.errors.map((issue, index) => (
                      <div key={`${issue.code}-${issue.field || ''}-${issue.message}-${index}`} className="mt-3 flex items-start gap-2 text-sm text-red-300">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span>[{issue.code}] {issue.message}</span>
                      </div>
                    ))}
                    {targetInspection?.warnings.map((issue, index) => (
                      <div key={`${issue.code}-${issue.field || ''}-${issue.message}-${index}`} className="mt-3 flex items-start gap-2 text-sm text-amber-300">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span>[{issue.code}] {issue.message}</span>
                      </div>
                    ))}
                  </section>
                </>
              )}
            </div>
          )}

          {step === 2 && selectedModel && (
            <div className="space-y-7">
              <section>
                <h3 className="mb-3 text-sm font-semibold text-slate-100">Input mapping</h3>
                {inputMapping.presetId === 'vidmuse_evaluation_v1' && (
                  <div className="mb-4 flex items-start gap-2 border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                    <span>{'\u5df2\u6309\u7cbe\u786e\u5217\u540d\u5e94\u7528 VidMuse \u8bc4\u6d4b\u96c6\u9884\u8bbe\uff1b\u4e0b\u65b9\u7684\u5185\u5bb9\u5b57\u6bb5\u548c\u53c2\u6570\u6765\u6e90\u5747\u53ef\u5728\u63d0\u4ea4\u524d\u4fee\u6539\u3002'}</span>
                  </div>
                )}
                <DatasetGenerationContentMappingEditor
                  headers={headers}
                  model={selectedModel}
                  mapping={inputMapping}
                  onChange={next => updateMapping(next)}
                />
              </section>

              {runtimeHealth?.assetMode === 'temporary_url' && (
                <div className="flex items-start gap-2 border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                  <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{'\u5f53\u524d\u672a\u542f\u7528 ManuEval OSS'}</div>
                    <div className="mt-1 text-xs text-amber-200/80">{'\u751f\u6210\u7ed3\u679c\u5c06\u4f18\u5148\u4f7f\u7528 Aion \u5df2\u6301\u4e45\u5316\u7684 VidMuse \u7528\u6237\u8d44\u4ea7\uff1b\u82e5\u8fd4\u56de\u4e2d\u7f3a\u5c11\u53ef\u9a8c\u8bc1\u7684\u8d44\u4ea7\u8def\u5f84\uff0c\u4ec5\u5bf9\u5e94 case \u56de\u9000\u4e3a\u53ef\u80fd\u8fc7\u671f\u7684\u4f9b\u5e94\u5546\u4e34\u65f6\u94fe\u63a5\u3002\u8f93\u5165\u7d20\u6750\u4ecd\u53ea\u652f\u6301 CSV \u4e2d\u53ef\u516c\u7f51\u8bbf\u95ee\u7684 URL\u3002'}</div>
                  </div>
                </div>
              )}

              {runtimeHealth?.executionTransport === 'task_worker' && (
                <div className="flex items-start gap-2 border border-sky-400/30 bg-sky-500/10 px-3 py-3 text-sm text-sky-100">
                  <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                  <div>{'\u672c\u5730\u9a8c\u8bc1\u4f7f\u7528 VidMuse task-worker \u517c\u5bb9\u901a\u8def\uff1b\u5b83\u4e0d\u7ecf\u8fc7 Planner\uff0c\u4f46\u53ea\u8f6c\u53d1\u6807\u51c6\u56fe\u7247/\u89c6\u9891\u53c2\u6570\uff0c\u7ed3\u679c\u53ef\u80fd\u662f VidMuse CDN \u94fe\u63a5\u3002\u6b63\u5f0f dev \u90e8\u7f72\u4ecd\u4f7f\u7528\u96c6\u7fa4\u5185 Model API\u3002'}</div>
                </div>
              )}

              <section className="border-y border-white/10 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">{copy.localAssets}</h3>
                    <p className="mt-1 text-xs text-slate-400">CSV paths use normalized relative-path matching, then unique file-name fallback.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10">
                      <FileUp size={15} /> {copy.selectFiles}
                      <input type="file" multiple disabled={runtimeHealth?.localUploadsEnabled === false} className="hidden" onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }} />
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2 border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10">
                      <FolderUp size={15} /> {copy.selectFolder}
                      <input
                        type="file"
                        multiple
                        disabled={runtimeHealth?.localUploadsEnabled === false}
                        className="hidden"
                        {...({ webkitdirectory: '', directory: '' } as any)}
                        onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }}
                      />
                    </label>
                  </div>
                </div>
                {runtimeHealth?.localUploadsEnabled === false && <div className="mt-2 text-xs text-amber-300">{'\u5f53\u524d\u6a21\u5f0f\u4e0d\u652f\u6301\u672c\u5730\u7d20\u6750\u4e0a\u4f20\u3002'}</div>}
                {uploading && <div className="mt-3 flex items-center gap-2 text-xs text-blue-300"><Loader2 size={14} className="animate-spin" /> {uploadProgress}</div>}
                {!!assetBindings.length && (
                  <div className="mt-3 max-h-32 overflow-auto border border-white/10">
                    {assetBindings.map(asset => (
                      <div key={asset.id} className="flex items-center justify-between gap-3 border-b border-white/5 px-3 py-2 text-xs last:border-0">
                        <span className="truncate text-slate-300" title={asset.relativePath}>{asset.relativePath}</span>
                        <button type="button" title="Remove" aria-label="Remove" onClick={() => { setAssetBindings(current => current.filter(value => value.id !== asset.id)); invalidatePreflight(); }} className="text-slate-500 hover:text-red-300"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-sm font-semibold text-slate-100">{copy.controls}</h3>
                {durationControl && (
                  <div className="mb-5 border-b border-white/10 pb-5">
                    <div className="text-sm font-medium text-slate-100">视频时长（Duration）</div>
                    <div className="mt-1 text-xs text-slate-400">控制每个 case 请求的视频秒数。</div>
                    <div className="mb-2 mt-3 text-xs text-slate-400">{copy.durationSource}</div>
                    <div className="mb-3 flex w-fit max-w-full flex-wrap border border-white/10 bg-black/20 p-1" role="group" aria-label={copy.durationSource}>
                      {([
                        ['uniform', copy.uniformDuration],
                        ['column', '\u4ece\u65f6\u957f\u5217\u8bfb\u53d6'],
                        ['reference_audio', copy.followAudioDuration],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={durationMode === mode}
                          onClick={() => changeDurationMode(mode)}
                          className={`px-3 py-1.5 text-xs ${durationMode === mode ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="max-w-sm">
                      {durationMode === 'uniform' && renderControl(durationControl)}
                      {durationMode === 'column' && renderColumnSelect(
                        durationColumn,
                        value => { setDurationColumn(value); invalidatePreflight(); },
                        copy.durationColumn,
                        'duration-source-column',
                      )}
                      {durationMode === 'reference_audio' && (
                        <div className="text-xs text-slate-400">
                          {audioProbe.status === 'probing' ? (
                            <span className="inline-flex items-center gap-2 text-blue-300">
                              <Loader2 size={14} className="animate-spin" /> {copy.probingAudio}
                            </span>
                          ) : audioProbe.status === 'ready' ? (
                            <span>
                              <span className="text-emerald-300">{Object.keys(audioProbe.values).length} {'\u6761\u5df2\u89e3\u6790'}</span>
                              {' / '}
                              <span className={Object.keys(audioProbe.issues).length ? 'text-red-300' : 'text-slate-500'}>
                                {Object.keys(audioProbe.issues).length} {'\u6761\u65e0\u6548'}
                              </span>
                            </span>
                          ) : <span>-</span>}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  {(selectedModel.controls || [])
                    .filter(control => control.key !== 'duration' && control.key !== 'seed')
                    .map(control => renderParameterBinding({
                      key: control.key,
                      label: control.label,
                      control,
                    }))}
                </div>
                {!!(selectedModel.advancedParameters || []).length && (
                  <details className="mt-5 border-t border-white/10 pt-4">
                    <summary className="cursor-pointer text-xs font-medium text-amber-300">
                      {'\u9ad8\u7ea7\u6a21\u578b\u53c2\u6570'} ({selectedModel.advancedParameters.length})
                    </summary>
                    <div className="mt-2 text-xs text-amber-200/80">
                      {'\u8fd9\u4e9b\u5b57\u6bb5\u672a\u7ecf\u7edf\u4e00 Aion \u5408\u540c\u9a8c\u8bc1\uff0c\u9ed8\u8ba4\u4e0d\u53d1\u9001\uff1b\u542f\u7528\u540e\u4ec5\u901a\u8fc7 extra_params \u900f\u4f20\u3002'}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {selectedModel.advancedParameters.map(parameter => renderParameterBinding({
                        key: parameter.key,
                        label: parameter.label,
                        advanced: true,
                      }))}
                    </div>
                  </details>
                )}
                {!!(selectedModel.invalidParameters || []).length && (
                  <div className="mt-5 space-y-2 border-t border-white/10 pt-4">
                    {selectedModel.invalidParameters.map(parameter => (
                      <div key={parameter.key} className="flex items-start gap-2 text-xs text-amber-300">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span><strong>{parameter.key}</strong>: {parameter.message} {parameter.replacement}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {!!unsupportedPresetParameters.length && (
                <section className="border border-amber-400/30 bg-amber-500/10 p-4">
                  <h3 className="text-sm font-semibold text-amber-100">{'评测集参数合同冲突'}</h3>
                  <p className="mt-1 text-xs leading-5 text-amber-200/80">
                    {'下列预设列有值，但当前模型实时配置未声明支持。默认预检阻断；可明确不使用，或在预检后逐 case 提供最终 Aion JSON 强制覆盖。'}
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {unsupportedPresetParameters.map(item => {
                      const omitted = parameterBindings[item.key]?.source === 'unused';
                      return (
                        <div key={item.key} className="flex items-center justify-between gap-3 border border-white/10 bg-black/20 p-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-100">{item.key}</div>
                            <div className="mt-1 truncate text-[11px] text-slate-400" title={item.column}>
                              {item.column} / {item.affected} cases
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPresetParameterOmission(item.key, !omitted)}
                            className={`shrink-0 border px-3 py-1.5 text-xs ${omitted ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-amber-300/30 text-amber-100'}`}
                          >
                            {omitted ? '已明确不使用' : '本批次不使用'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {selectedModel?.supportsSeed && runtimeHealth?.executionTransport === 'model_api' && (
                <section className="border-t border-white/10 pt-5">
                  <h3 className="mb-3 text-sm font-semibold text-slate-100">{copy.seed}</h3>
                  <div className="flex flex-wrap gap-4 text-sm text-slate-300">
                    {([
                      ['unused', copy.unusedSeed],
                      ['derive_from_case', copy.derived],
                      ['fixed', copy.fixed],
                      ['column', copy.fromColumn],
                    ] as const).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2"><input type="radio" checked={seedMode === value} onChange={() => { setSeedMode(value); invalidatePreflight(); }} /> {label}</label>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {seedMode === 'unused' && '\u672a\u53d1\u9001\uff0c\u4f7f\u7528\u6a21\u578b\u9ed8\u8ba4'}
                    {seedMode === 'derive_from_case' && '\u6309 case \u6d3e\u751f'}
                    {seedMode === 'fixed' && '\u56fa\u5b9a\u503c'}
                    {seedMode === 'column' && '\u6570\u636e\u96c6\u5217'}
                  </div>
                  {seedMode === 'fixed' && <input type="number" value={fixedSeed} onChange={event => { setFixedSeed(Number(event.target.value)); invalidatePreflight(); }} className="mt-3 w-44 border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" />}
                  {seedMode === 'column' && <div className="mt-3 max-w-sm">{renderColumnSelect(seedColumn, value => { setSeedColumn(value); invalidatePreflight(); }, 'Seed column')}</div>}
                </section>
              )}

              <section className="border-y border-white/10 py-5" data-testid="generation-case-scope">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">生产范围</h3>
                    <p className="mt-1 text-xs text-slate-400">
                      {caseScopeMode === 'filtered' ? '当前筛选结果快照' : '评测集全量'} · 数据集 v{dataset.version || 1}
                    </p>
                  </div>
                  <div className="flex border border-white/10 bg-black/20 p-1" role="group" aria-label="生产范围来源">
                    {initialCaseScope && (
                      <button
                        type="button"
                        onClick={() => changeCaseScopeMode('filtered')}
                        disabled={!scopeSnapshotCurrent}
                        aria-pressed={caseScopeMode === 'filtered'}
                        className={`px-3 py-2 text-xs font-medium ${caseScopeMode === 'filtered' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        当前筛选结果 {initialCaseScope.filteredSourceRowIndexes.length}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => changeCaseScopeMode('all')}
                      aria-pressed={caseScopeMode === 'all'}
                      className={`px-3 py-2 text-xs font-medium ${caseScopeMode === 'all' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
                    >
                      评测集全量 {dataset.items.length}
                    </button>
                  </div>
                </div>

                {initialCaseScope && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {initialCaseScope.filters.map(filter => (
                      <span key={filter.columnKey} className="max-w-full border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-100" title={`${filter.columnLabel}: ${filter.selectedLabels.join('、')}`}>
                        {filter.columnLabel}: {filter.selectedLabels.slice(0, 3).join('、') || '无匹配值'}{filter.selectedLabels.length > 3 ? ` +${filter.selectedLabels.length - 3}` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {caseScopeMode === 'filtered' && !scopeSnapshotCurrent && (
                  <div className="mt-3 border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    筛选快照对应的数据集版本已变化。请关闭配置并重新筛选，或明确切换到评测集全量。
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-px border border-white/10 bg-white/10 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['范围 case', scopeCounts.total, 'text-slate-100'],
                    ['可生成', scopeCounts.eligible, 'text-emerald-300'],
                    ['已有结果', scopeCounts.targetFilled, 'text-sky-300'],
                    ['模态不匹配', scopeCounts.modalityMismatch, 'text-amber-300'],
                    ['缺稳定 ID', scopeCounts.missingStableId, 'text-red-300'],
                    ['最终已选', selectedDatasetItemIds.length, 'text-amber-200'],
                  ].map(([label, value, tone]) => (
                    <div key={String(label)} className="bg-slate-950 px-3 py-2.5">
                      <div className={`text-base font-semibold ${tone}`}>{value}</div>
                      <div className="mt-0.5 text-slate-500">{label}</div>
                    </div>
                  ))}
                </div>
              </section>

              <GenerationCaseSelector
                dataset={dataset}
                inputMapping={inputMapping}
                outputModality={selectedModel?.outputModality}
                targetColumn={targetColumn}
                selectedDatasetItemIds={selectedDatasetItemIds}
                scopeSourceRowIndexes={scopeSourceRowIndexes}
                maxBatchSize={maxBatchSize}
                onSelectionChange={updateCaseSelection}
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              {!preflight && !batch && (
                <div className="py-16 text-center text-sm text-slate-400">{'\u8bf7\u8fd4\u56de\u4e0a\u4e00\u6b65\u9009\u62e9 case\uff0c\u7136\u540e\u6267\u884c\u9884\u68c0\u3002'}</div>
              )}

              {preflight && (
                <>
                  <section>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-100">Preflight result</h3>
                        <p className="mt-1 text-xs text-slate-400">Expires {new Date(preflight.expiresAt).toLocaleString()}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-center text-xs sm:grid-cols-4">
                        <div><div className="text-xl font-semibold text-slate-100">{preflight.selectionSummary?.selected ?? preflight.total}</div><div className="text-slate-500">{'\u5df2\u9009'}</div></div>
                        <div><div className="text-xl font-semibold text-emerald-300">{preflight.validCount}</div><div className="text-slate-500">{'\u6709\u6548\u5e76\u5c06\u63d0\u4ea4'}</div></div>
                        <div><div className="text-xl font-semibold text-red-300">{preflight.invalidCount}</div><div className="text-slate-500">{'\u65e0\u6548\u4e0d\u63d0\u4ea4'}</div></div>
                        <div><div className="text-xl font-semibold text-slate-400">{preflight.selectionSummary?.unselected ?? Math.max(0, dataset.items.length - preflight.total)}</div><div className="text-slate-500">{'\u672a\u9009'}</div></div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 border-y border-white/10 py-4 md:grid-cols-2">
                      <div>
                        <div className="text-xs text-slate-500">Configuration snapshot</div>
                        <div className="mt-1 text-sm text-slate-100">{preflight.model.displayName}</div>
                        <code className="mt-1 block break-all text-[11px] text-slate-400">{preflight.configFingerprint}</code>
                        {!!preflight.model.description && (
                          <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">{preflight.model.description}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-slate-500">Estimated upper-bound cost</div>
                        <div className={`mt-1 text-lg font-semibold ${preflight.costEstimate.known ? 'text-amber-300' : 'text-red-300'}`}>
                          {preflight.costEstimate.known ? `${preflight.costEstimate.totalCredits ?? 0} credits` : '\u8d39\u7528\u672a\u77e5'}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {preflight.costEstimate.known ? `${preflight.costEstimate.unitCredits ?? 0} credits / ${preflight.costEstimate.unitLabel || 'case'}` : 'Aion configuration does not expose a reliable compatible price item.'}
                        </div>
                      </div>
                    </div>
                  </section>

                  {!!preflight.batchWarnings?.length && (
                    <section className="border border-amber-400/30 bg-amber-500/10 px-4 py-3">
                      <h3 className="text-sm font-semibold text-amber-100">{'\u6279\u6b21\u8b66\u544a'}</h3>
                      <div className="mt-2 space-y-1 text-xs text-amber-200">
                        {preflight.batchWarnings.map((issue, index) => (
                          <div key={`${issue.code}-${issue.field || ''}-${issue.message}-${index}`}>[{issue.code}] {issue.message}</div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">Case 预检结果</h3>
                        <p className="mt-1 text-xs text-slate-500">当前显示 {filteredPreflightCases.length} / {preflight.cases.length} 个 case。点击一行查看问题、修改 Prompt 或审计请求。</p>
                      </div>
                    </div>
                    <div className="sticky top-0 z-10 grid gap-3 border border-white/10 bg-slate-950/95 p-3 md:grid-cols-3">
                      <label className="block text-xs text-slate-400">
                        <span className="mb-1.5 block">状态</span>
                        <select value={caseStatusFilter} onChange={event => setCaseStatusFilter(event.target.value as GenerationCaseStatusFilter)} className="h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-slate-100">
                          <option value="needs_attention">需处理</option>
                          <option value="invalid">无效</option>
                          <option value="warning">有警告</option>
                          <option value="valid">有效且无警告</option>
                          <option value="all">全部</option>
                        </select>
                      </label>
                      <label className="block text-xs text-slate-400">
                        <span className="mb-1.5 block">问题类型</span>
                        <select
                          value={caseIssueKey}
                          onChange={event => {
                            const nextKey = event.target.value;
                            setCaseIssueKey(nextKey);
                            const option = caseIssueOptions.find(candidate => candidate.key === nextKey);
                            if (option) setCaseStatusFilter(option.severity === 'error' ? 'invalid' : 'warning');
                            setBulkForceReason('');
                            setBulkForceConfirmed(false);
                          }}
                          className="h-10 w-full border border-white/10 bg-slate-950 px-3 text-sm text-slate-100"
                        >
                          <option value="">全部问题</option>
                          <optgroup label="阻断错误">
                            {caseIssueOptions.filter(option => option.severity === 'error').map(option => <option key={option.key} value={option.key}>{option.label} ({option.count})</option>)}
                          </optgroup>
                          <optgroup label="警告">
                            {caseIssueOptions.filter(option => option.severity === 'warning').map(option => <option key={option.key} value={option.key}>{option.label} ({option.count})</option>)}
                          </optgroup>
                        </select>
                      </label>
                      <label className="block text-xs text-slate-400">
                        <span className="mb-1.5 block">Case ID</span>
                        <span className="relative block">
                          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                          <input value={caseSearch} onChange={event => setCaseSearch(event.target.value)} placeholder="搜索 Case ID" className="h-10 w-full border border-white/10 bg-slate-950 pl-9 pr-3 text-sm text-slate-100" />
                        </span>
                      </label>
                    </div>

                    {selectedCaseIssue?.code === 'PROMPT_TOO_LONG' && bulkPromptPlan.targetIds.length > 0 && (
                      <div className="mt-3 border border-sky-400/30 bg-sky-500/10 p-4">
                        <h4 className="text-sm font-semibold text-sky-100">批量替换超限 Prompt</h4>
                        <p className="mt-1 text-xs leading-5 text-sky-200/80">
                          作用于本次预检中全部 {bulkPromptPlan.targetIds.length} 个 Prompt 超限 case；上方状态筛选和 Case ID 搜索只影响列表展示，不会缩小批量范围。平台不会修改原评测集或自动判断翻译质量。
                        </p>
                        <label className="mt-3 block text-xs text-slate-300">
                          <span className="mb-1.5 block">备用 Prompt 列</span>
                          <select
                            value={bulkPromptColumn}
                            onChange={event => setBulkPromptColumn(event.target.value)}
                            className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                          >
                            <option value="">选择列，例如 prompt_zh</option>
                            {promptReplacementColumns.map(column => <option key={column} value={column}>{column}</option>)}
                          </select>
                        </label>
                        <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                          <div>将替换：<span className="text-sky-200">{bulkPromptPlan.targetIds.length}</span></div>
                          <div>备用列空值：<span className={bulkPromptEmptyCount ? 'text-amber-300' : 'text-emerald-300'}>{bulkPromptColumn ? bulkPromptEmptyCount : '-'}</span></div>
                          <div>覆盖已有 Prompt 修复：<span className={bulkPromptPlan.overwrittenPromptReviewCount ? 'text-amber-300' : 'text-slate-200'}>{bulkPromptPlan.overwrittenPromptReviewCount}</span></div>
                        </div>
                        {bulkPromptEmptyCount > 0 && (
                          <div className="mt-2 text-xs leading-5 text-amber-200">
                            空值也会按当前策略替换；重新预检后这些 case 将明确报告缺少 Prompt，不会回退原 Prompt。
                          </div>
                        )}
                        {bulkPromptPlan.expertConflictIds.length > 0 && (
                          <div className="mt-2 text-xs leading-5 text-red-200">
                            有 {bulkPromptPlan.expertConflictIds.length} 个目标 case 已使用专家最终 Aion JSON。请先逐条退出专家模式，批量操作不会静默覆盖这些请求。
                          </div>
                        )}
                        {bulkPromptPlan.missingStableIdCount > 0 && (
                          <div className="mt-2 text-xs leading-5 text-red-200">
                            有 {bulkPromptPlan.missingStableIdCount} 个目标 case 缺少 stable item ID，无法安全按行覆盖。请先修复数据集标识后重新预检。
                          </div>
                        )}
                        {!promptReplacementColumns.length && (
                          <div className="mt-2 text-xs text-amber-200">当前数据集没有其他可用的文本业务列。</div>
                        )}
                        <button
                          type="button"
                          disabled={!bulkPromptColumn || busy || bulkPromptPlan.expertConflictIds.length > 0 || bulkPromptPlan.missingStableIdCount > 0}
                          onClick={() => { void applyBulkPromptColumnOverride(); }}
                          className="mt-3 inline-flex items-center gap-2 border border-sky-300/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 disabled:opacity-40"
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          替换 {bulkPromptPlan.targetIds.length} 个 case 并立即重新预检
                        </button>
                      </div>
                    )}

                    {activeBulkForceCode && filteredPreflightCases.length > 0 && (
                      <div className="mt-3 border border-red-400/30 bg-red-500/10 p-4">
                        <h4 className="text-sm font-semibold text-red-100">批量确认当前筛选风险</h4>
                        <p className="mt-1 text-xs leading-5 text-red-200/80">
                          当前问题：{selectedCaseIssue?.label}。批量操作只写入原因、计费确认和错误码，不会生成或修改最终 Aion JSON。
                        </p>
                        <label className="mt-3 block text-xs text-slate-300">
                          <span className="mb-1.5 block">强制提交原因</span>
                          <input value={bulkForceReason} onChange={event => setBulkForceReason(event.target.value)} className="w-full border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100" />
                        </label>
                        <label className="mt-3 flex items-start gap-2 text-xs text-red-100">
                          <input type="checkbox" checked={bulkForceConfirmed} onChange={event => setBulkForceConfirmed(event.target.checked)} />
                          <span>我已阅读该类风险，并确认可能产生重复计费。</span>
                        </label>
                        {generationForceRequiresFinalJson([activeBulkForceCode]) && (
                          <div className="mt-2 text-xs text-amber-200">该问题必须逐 case 提供最终 Aion JSON；批量确认后仍保持无效。</div>
                        )}
                        <button type="button" disabled={!bulkForceReason.trim() || !bulkForceConfirmed} onClick={applyBulkForceReview} className="mt-3 border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs text-red-100 disabled:opacity-40">
                          应用到当前筛选的 {filteredPreflightCases.length} 个 case
                        </button>
                      </div>
                    )}

                    <div className="mt-3 min-h-[420px] max-h-[55vh] overflow-auto border border-white/10">
                      {filteredPreflightCases.map((item, index) => {
                        const primary = getPrimaryGenerationIssue(item, caseIssueKey);
                        const repairCount = buildGenerationRepairGroups(item).length;
                        const datasetItemId = String(item.resolvedCase.datasetItemId || '');
                        const pending = pendingReviewIds.includes(datasetItemId);
                        return (
                          <button
                            type="button"
                            key={`${datasetItemId || getGenerationCaseId(item)}-${index}`}
                            onClick={() => setReviewDialogItemId(generationReviewDialogKey(item))}
                            className="grid w-full min-w-[780px] grid-cols-[minmax(180px,0.9fr)_90px_minmax(150px,0.8fr)_minmax(260px,1.6fr)_auto] items-center gap-3 border-b border-white/5 px-3 py-3 text-left text-xs last:border-0 hover:bg-white/[0.04]"
                          >
                            <span className="truncate font-medium text-slate-100" title={getGenerationCaseId(item)}>{getGenerationCaseId(item)}</span>
                            <span className={item.valid ? 'text-emerald-300' : 'text-red-300'}>{item.valid ? '有效' : '无效'}</span>
                            <span className="truncate text-sky-300" title={item.generationType}>{item.generationType}</span>
                            <span className="min-w-0">
                              {primary ? <span className={primary.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>{primary.title}</span> : <span className="text-emerald-300">无预检问题</span>}
                              {repairCount > 1 && <span className="ml-2 text-slate-500">另有 {repairCount - 1} 个根因</span>}
                              {pending && <span className="ml-2 text-sky-300">已修改，待重新预检</span>}
                            </span>
                            <ChevronRight size={16} className="text-slate-500" />
                          </button>
                        );
                      })}
                      {!filteredPreflightCases.length && <div className="flex min-h-[220px] items-center justify-center text-sm text-slate-500">没有符合当前筛选条件的 case。</div>}
                    </div>
                  </section>

                  {reviewDialogItem && preflight && (
                    <GenerationCaseReviewDialog
                      item={reviewDialogItem}
                      model={preflight.model}
                      position={reviewDialogIndex >= 0 ? reviewDialogIndex : Math.max(0, reviewDialogAllIndex)}
                      total={reviewDialogIndex >= 0 ? filteredPreflightCases.length : preflight.cases.length}
                      outsideCurrentFilter={reviewDialogIndex < 0}
                      review={caseReviews[String(reviewDialogItem.resolvedCase.datasetItemId || '')]}
                      promptColumnOptions={reviewDialogPromptColumnOptions}
                      onClose={() => setReviewDialogItemId('')}
                      onPrevious={reviewDialogIndex > 0 ? () => setReviewDialogItemId(generationReviewDialogKey(filteredPreflightCases[reviewDialogIndex - 1])) : undefined}
                      onNext={reviewDialogIndex < filteredPreflightCases.length - 1 ? () => setReviewDialogItemId(generationReviewDialogKey(filteredPreflightCases[reviewDialogIndex + 1])) : undefined}
                      onSaveDraft={saveCaseReview}
                      onSaveAndRepreflight={saveCaseReviewAndRepreflight}
                      onAcceptFindingRule={acceptFindingRule}
                    />
                  )}

                  {reviewsDirty && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                      <span>已保存 {pendingReviewIds.length} 条修改。重新预检后才会生成新的请求哈希和最终请求快照。</span>
                      <button type="button" disabled={busy} onClick={() => { void runPreflight(); }} className="inline-flex items-center gap-2 border border-sky-300/30 px-3 py-1.5 text-xs disabled:opacity-40">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 应用 {pendingReviewIds.length} 条修改并重新预检
                      </button>
                    </div>
                  )}

                  <label className="flex items-start gap-3 border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    <input type="checkbox" checked={confirmed} disabled={reviewsDirty} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
                    <span>{copy.explicitConfirm}</span>
                  </label>
                </>
              )}

              {batch && !preflight && (
                <>
                  {temporaryResultCount > 0 && (
                    <div className="flex items-start gap-2 border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
                      <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                      <div>{'\u672c\u6279\u6b21\u6709 '}{temporaryResultCount}{' \u4e2a\u6210\u529f\u7ed3\u679c\u672a\u8fd4\u56de\u53ef\u9a8c\u8bc1\u7684 VidMuse \u8d44\u4ea7\u8def\u5f84\uff0c\u5df2\u56de\u586b\u4f9b\u5e94\u5546\u4e34\u65f6\u94fe\u63a5\u3002'}</div>
                    </div>
                  )}
                  <section>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-slate-100">{batch.targetColumn}</h3>
                        <p className="mt-1 text-xs text-slate-400">{batch.modelConfig?.displayName} / {batch.id}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-slate-100">{statusLabel(batch.status)}</div>
                        <div className="mt-1 text-xs text-slate-400">Writeback: {statusLabel(batch.writebackStatus)}</div>
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden bg-white/10">
                      <div className="h-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                      <span>{completedItems}/{batch.total} terminal</span>
                      <span className="text-emerald-300">{batch.succeeded} succeeded</span>
                      <span className="text-red-300">{batch.failed} failed or unknown</span>
                      {batch.cancelRequested && <span className="text-amber-300">Cancellation requested</span>}
                    </div>
                  </section>

                  {batch.writebackStatus === 'conflict' && (
                    <div className="flex items-start gap-2 border border-red-400/30 bg-red-500/10 px-3 py-3 text-sm text-red-200">
                      <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                      <div><div className="font-medium">Dataset writeback conflict</div><div className="mt-1 text-xs">{batch.error?.message || 'The dataset changed and the result cannot be merged without overwriting data.'}</div></div>
                    </div>
                  )}

                  <section>
                    <h3 className="mb-3 text-sm font-semibold text-slate-100">Case execution</h3>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-y border-white/10 py-2">
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          checked={selectableBatchItems.length > 0 && selectedBatchItemIds.length === selectableBatchItems.length}
                          onChange={event => setSelectedBatchItemIds(
                            event.target.checked ? selectableBatchItems.map(item => item.id) : [],
                          )}
                          disabled={!selectableBatchItems.length}
                        />
                        {'\u5df2\u9009'} {selectedBatchItemIds.length} / {selectableBatchItems.length}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy || !canSkipSelected} onClick={() => { void skipSelectedItems(); }} className="inline-flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-30">
                          <Square size={13} /> {'\u8df3\u8fc7 / \u4e0d\u518d\u91cd\u8bd5'}
                        </button>
                        <button type="button" disabled={busy || !canRetrySelected} onClick={() => { void retrySelectedItems(); }} className="inline-flex items-center gap-2 rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-100 disabled:opacity-30">
                          <RefreshCw size={13} /> {'\u91cd\u8bd5\u9009\u4e2d case'}
                        </button>
                      </div>
                    {batch.items.some(item => ['submitting', 'submitted', 'processing', 'reconciling', 'archiving'].includes(item.status)) && (
                      <div className="mb-3 text-xs text-slate-500">
                        {'\u8fd0\u884c\u4e2d\u548c\u5f52\u6863\u4e2d\u7684 case \u4e0d\u80fd\u8df3\u8fc7\uff1aAion \u6682\u65e0\u901a\u7528\u53d6\u6d88\u63a5\u53e3\uff0c\u5df2\u63d0\u4ea4\u4efb\u52a1\u4f1a\u7ee7\u7eed\u8f6e\u8be2\u5e76\u5f52\u6863\u3002'}
                      </div>
                    )}
                    </div>
                    <div className="max-h-[380px] overflow-auto border border-white/10">
                      {batch.items.map(item => {
                        const isSelectable = selectableBatchItems.some(candidate => candidate.id === item.id);
                        const providerActive = ['submitting', 'submitted', 'processing'].includes(item.status);
                        const startedAt = item.submissionStartedAt || item.startedAt;
                        const released = ['failed', 'submission_unknown', 'cancelled', 'succeeded', 'completed'].includes(item.status);
                        const receivedAionError = item.status === 'failed'
                          && (item.error?.responseReceived === true
                            || item.error?.code === 'AION_HTTP_ERROR'
                            || item.error?.code === 'AION_SUBMIT_REJECTED');
                        const noAionResponse = item.status === 'submission_unknown'
                          && item.error?.responseReceived !== true;
                        return (
                          <div key={item.id} className="grid min-h-[72px] gap-3 border-b border-white/5 px-3 py-3 text-xs last:border-0 md:grid-cols-[28px_170px_120px_minmax(0,1fr)_180px]">
                            <div className="pt-1">
                              <input
                                type="checkbox"
                                checked={selectedBatchItemIds.includes(item.id)}
                                disabled={!isSelectable}
                                onChange={event => setSelectedBatchItemIds(current => event.target.checked
                                  ? [...current, item.id]
                                  : current.filter(itemId => itemId !== item.id))}
                                aria-label={`Select ${item.caseId}`}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-slate-200" title={item.caseId}>{item.caseId}</div>
                              <div className="mt-1 truncate text-slate-500" title={item.providerJobId}>{item.providerJobId || item.requestId || '-'}</div>
                            </div>
                            <div>
                              <div className={item.status === 'succeeded' ? 'text-emerald-300' : item.status === 'failed' || item.status === 'submission_unknown' ? 'text-red-300' : item.status === 'reconciling' ? 'text-amber-300' : 'text-blue-300'}>{statusLabel(item.status)}</div>
                              {item.status === 'succeeded' && item.durability && (
                                <div className={'mt-1 ' + durabilityClass(item.durability)}>{durabilityLabel(item.durability)}</div>
                              )}
                              {item.resolutionStatus === 'skipped' && (
                                <div className="mt-1 text-slate-500">{'\u5df2\u786e\u8ba4\u4e0d\u518d\u91cd\u8bd5'}</div>
                              )}
                              {item.resolutionStatus === 'retrying' && (
                                <div className="mt-1 text-blue-300">{'\u5df2\u5efa\u7acb retry \u6279\u6b21'}</div>
                              )}
                            </div>
                            <div className="min-w-0 break-words text-slate-400">
                              {receivedAionError && (
                                <div className="mb-1 font-medium text-red-300">{'Aion 已明确返回错误'}</div>
                              )}
                              {noAionResponse && (
                                <div className="mb-1 font-medium text-amber-300">{'未收到 Aion 响应，提交结果未知'}</div>
                              )}
                              <div>{item.error?.message || item.providerStatus || '-'}</div>
                              {item.error?.code && (
                                <div className="mt-1 font-mono text-[11px] text-slate-500">
                                  {item.error.code}
                                  {item.error.httpStatus ? ' / HTTP ' + item.error.httpStatus : ''}
                                  {item.error.transportCode ? ' / ' + item.error.transportCode : ''}
                                  {item.error.errorName ? ' / ' + item.error.errorName : ''}
                                </div>
                              )}

                              {released && startedAt && item.finishedAt && (
                                <div className="mt-1 text-slate-500">
                                  {'\u63d0\u4ea4'} {new Date(startedAt).toLocaleString('zh-CN')}
                                  {' / \u7ec8\u6b62'} {new Date(item.finishedAt).toLocaleString('zh-CN')}
                                  {' / \u8017\u65f6'} {formatElapsed(item.finishedAt - startedAt)}
                                </div>
                              )}
                              {providerActive && startedAt && (
                                <div className="mt-1 text-blue-300">
                                  {'\u63d0\u4ea4'} {new Date(startedAt).toLocaleString('zh-CN')}
                                  {' / \u5df2\u8fd0\u884c'} {formatElapsed(clock - startedAt)}
                                  {' / \u5360\u7528'} {batch.modelConfig.outputModality === 'video' ? '\u89c6\u9891' : '\u56fe\u7247'} {'\u69fd\u4f4d'}
                                </div>
                              )}
                              {providerActive && item.timeoutAt && (
                                <div className="mt-1 text-slate-500">
                                  {'ManuEval \u622a\u6b62'} {new Date(item.timeoutAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              )}
                              {item.status === 'reconciling' && (
                                <div className="mt-1 space-y-1 text-amber-200">
                                  <div>{'\u4ec5\u6838\u5bf9\u5df2\u63d0\u4ea4\u7684 Aion \u4efb\u52a1\uff0c\u4e0d\u4f1a\u81ea\u52a8\u91cd\u63d0\uff0c\u4e14\u4e0d\u5360\u7528\u751f\u6210\u69fd\u4f4d\u3002'}</div>
                                  {item.reconciliationDeadlineAt && (
                                    <div className="text-slate-400">
                                      {'\u6838\u5bf9\u622a\u6b62'} {new Date(item.reconciliationDeadlineAt).toLocaleString('zh-CN')}
                                    </div>
                                  )}
                                  <div className="text-slate-500">
                                    {'\u6700\u8fd1\u6210\u529f\u8f6e\u8be2'} {item.lastPollSucceededAt ? new Date(item.lastPollSucceededAt).toLocaleString('zh-CN') : '-'}
                                    {' / \u8fde\u7eed\u8f6e\u8be2\u5931\u8d25'} {item.consecutivePollFailures || 0}
                                  </div>
                                  <div className="text-slate-500">{'\u5df2\u91ca\u653e\u5e76\u53d1\u4f4d\uff0c\u540e\u53f0\u7ee7\u7eed\u6838\u5bf9'}</div>
                                </div>
                              )}
                              {item.status === 'pending' && <div className="mt-1 text-slate-500">{pendingQueueLabel}</div>}
                              {item.status === 'archiving' && <div className="mt-1 text-slate-500">{'\u5df2\u91ca\u653e\u6a21\u578b\u69fd\u4f4d\uff0c\u6b63\u5728\u5f52\u6863'}</div>}
                              {released && <div className="mt-1 text-slate-500">{'\u5df2\u91ca\u653e\u5e76\u53d1\u4f4d'}</div>}
                            </div>
                            <div className="h-20 w-44 overflow-hidden bg-black/30">
                              {item.resultUrl ? (
                                <MediaRenderer
                                  url={item.resultUrl}
                                  isActive={false}
                                  forceType={(item.mediaType || batch.modelConfig.outputModality) as DatasetPreviewType}
                                  videoPreload="metadata"
                                  className="h-full w-full border-0 object-cover shadow-none"
                                />
                              ) : <div className="flex h-full items-center justify-center text-slate-600">-</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  {!!batchEvents.length && (
                    <details className="border border-white/10 bg-black/20">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-300">
                        {'\u4efb\u52a1\u4e8b\u4ef6'} ({batchEvents.length})
                      </summary>
                      <div className="max-h-44 divide-y divide-white/5 overflow-auto border-t border-white/10">
                        {batchEvents.map(event => (
                          <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                            <span className="text-slate-300">{({
                              batch_created: '\u521b\u5efa\u6279\u6b21',
                              retry_batch_created: '\u521b\u5efa retry \u6279\u6b21',
                              retry_created: '\u521b\u5efa case retry',
                              items_skipped: '\u8df3\u8fc7 case',
                              batch_cancelled: '\u53d6\u6d88\u672a\u63d0\u4ea4 case',
                              writeback_finished: '\u56de\u586b\u5b8c\u6210',
                            } as Record<string, string>)[event.action] || event.action}</span>
                            <span className="text-slate-500">{event.actorName || '\u7cfb\u7edf'} ? {new Date(event.createdAt).toLocaleString('zh-CN')}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white">{copy.close}</button>
          <div className="flex flex-wrap justify-end gap-2">
            {!batch && step > 1 && (
              <button type="button" disabled={busy || uploading} onClick={() => setStep((step - 1) as GenerationStep)} className="border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 disabled:opacity-40">{copy.previous}</button>
            )}
            {!batch && step === 1 && (
              <button type="button" disabled={!selectedModel || !targetColumn.trim() || targetBlocked || modelsLoading} onClick={() => setStep(2)} className="bg-amber-500 px-5 py-2 text-sm font-medium text-black disabled:opacity-40">{copy.next}</button>
            )}
            {!batch && step === 2 && (
              <button type="button" disabled={busy || uploading || !selectedModel || targetBlocked || selectionBlocked} onClick={() => { void runPreflight(); }} className="inline-flex items-center gap-2 bg-amber-500 px-5 py-2 text-sm font-medium text-black disabled:opacity-40">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {preflight ? copy.rerunPreflight : copy.preflight}
              </button>
            )}
            {preflight && (
              <>
                <button type="button" disabled={busy} onClick={() => { setPreflight(null); setConfirmed(false); setStep(2); }} className="border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 disabled:opacity-40">{copy.rerunPreflight}</button>
                <button type="button" disabled={busy || reviewsDirty || !confirmed || preflight.validCount === 0} onClick={() => { void confirmPreflight(); }} className="inline-flex items-center gap-2 bg-amber-500 px-5 py-2 text-sm font-medium text-black disabled:opacity-40">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {copy.confirm}
                </button>
              </>
            )}
            {batch && !terminal && (
              <button type="button" disabled={busy || batch.cancelRequested} onClick={() => { void cancelBatch(); }} className="inline-flex items-center gap-2 border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200 disabled:opacity-40"><Square size={15} /> {copy.cancel}</button>
            )}
            {batch?.writebackStatus === 'completed' && onCreateEvaluation && (
              <button type="button" onClick={() => onCreateEvaluation(dataset.id, batch.targetColumn)} className="inline-flex items-center gap-2 bg-emerald-500 px-5 py-2 text-sm font-medium text-black"><CheckCircle2 size={16} /> {copy.createEvaluation}</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};

export default DatasetGenerationExecutionModal;
