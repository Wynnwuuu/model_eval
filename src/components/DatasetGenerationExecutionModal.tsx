import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  FolderUp,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Wand2,
  X,
} from 'lucide-react';

import {
  DatasetPreviewType,
  EvalDataset,
  GenerationAssetDurability,
  GenerationAssetBinding,
  GenerationJobEvent,
  GenerationDurationSourceMode,
  GenerationInputMapping,
  GenerationReferenceAudioDuration,
  GenerationModelConfig,
  GenerationPreflightResult,
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
import MediaRenderer from './MediaRenderer';
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
  getGenerationRuntimeHealth,
  isTerminalGenerationBatch,
  listExecutionModels,
  uploadGenerationAsset,
  waitForExecutionBatch,
} from '../features/generation/executionApi';

import {
  defaultGenerationInputMapping,
  getGenerationImageRole,
  inferGenerationImageRole,
  setGenerationImageRole,
} from '../features/generation/inputMapping';
import {
  GenerationImageRole,
  getGenerationReferenceVideoSupport,
  getSupportedGenerationImageRoles,
  modelDeclaresGenerationInput,
} from '../features/generation/modelCapabilities';
import {
  probeAudioDurations,
  resolveReferenceAudioDuration,
} from '../features/generation/audioDuration';
import {
  parseStructuredGenerationValue,
  uniqueGenerationReferences,
} from '../features/generation/mediaReferences';

interface DatasetGenerationExecutionModalProps {
  dataset: EvalDataset;
  initialBatchId?: string;
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
  durationColumn: '\u4ece\u5217\u8bfb\u53d6',
  followAudioDuration: '\u8ddf\u968f\u53c2\u8003\u97f3\u9891',
  probingAudio: '\u6b63\u5728\u8bfb\u53d6\u97f3\u9891\u65f6\u957f...',
  none: '\u4e0d\u4f7f\u7528',
  controls: '\u751f\u6210\u53c2\u6570',
  caseColumn: '\u9010 case \u8986\u76d6\u5217',
  seed: 'Seed \u7b56\u7565',
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

const imageRoleLabels: Record<GenerationImageRole, string> = {
  reference: '\u53c2\u8003\u56fe',
  start: '\u9996\u5e27',
  end: '\u5c3e\u5e27',
};

const emptyMapping: GenerationInputMapping = {
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

const advancedInputKeysFor = (model?: GenerationModelConfig) => {
  const schema = model?.inputSchema || {};
  const keys = new Set<string>(Object.keys(schema.properties || {}));
  for (const field of ['required_inputs', 'optional_inputs']) {
    const declaration = schema[field];
    if (Array.isArray(declaration)) declaration.forEach(key => keys.add(String(key)));
    else Object.values(declaration || {}).forEach(value => {
      if (Array.isArray(value)) value.forEach(key => keys.add(String(key)));
    });
  }
  if (Array.isArray(schema.supported_inputs)) schema.supported_inputs.forEach(key => keys.add(String(key)));
  Object.values(schema.required_one_of_inputs || {}).forEach(value => {
    if (!Array.isArray(value)) return;
    value.flatMap(group => Array.isArray(group) ? group : [group]).forEach(key => keys.add(String(key)));
  });
  [
    'prompt', 'image_urls', 'audio_url', 'audios', 'video_url', 'video_urls',
    'reference_video_urls', 'elements', 'generation_type', 'model_name', 'features', 'extra_params',
  ].forEach(key => keys.delete(key));
  (model?.controls || []).forEach(control => keys.delete(control.key));
  return Array.from(keys).sort();
};

const DatasetGenerationExecutionModal: React.FC<DatasetGenerationExecutionModalProps> = ({
  dataset,
  initialBatchId,
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
  const [selectedDatasetItemIds, setSelectedDatasetItemIds] = useState<string[]>([]);
  const [inputMapping, setInputMapping] = useState<GenerationInputMapping>(emptyMapping);
  const [defaultControls, setDefaultControls] = useState<Record<string, unknown>>({});
  const [perCaseControlColumns, setPerCaseControlColumns] = useState<Record<string, string>>({});
  const [durationMode, setDurationMode] = useState<GenerationDurationSourceMode>('uniform');
  const [durationColumn, setDurationColumn] = useState('');
  const [referenceInputMode, setReferenceInputMode] = useState<'video_columns' | 'raw_elements'>('video_columns');
  const [seedMode, setSeedMode] = useState<GenerationSeedMode>('derive_from_case');
  const [fixedSeed, setFixedSeed] = useState(42);
  const [seedColumn, setSeedColumn] = useState('');
  const [assetBindings, setAssetBindings] = useState<GenerationAssetBinding[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [preflight, setPreflight] = useState<GenerationPreflightResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [batch, setBatch] = useState<GenerationBatch | null>(null);
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
  const eligibleDatasetItemIds = useMemo(() => dataset.items
    .filter(row => String(row[DATASET_ITEM_ID_KEY] || '').trim() && !String(row[targetColumn] ?? '').trim())
    .map(row => String(row[DATASET_ITEM_ID_KEY]).trim()), [dataset.items, targetColumn]);
  const eligibleSelectionSignature = eligibleDatasetItemIds.join('|');
  const maxBatchSize = runtimeHealth?.maxBatchSize || 500;
  const selectionTooLarge = selectedDatasetItemIds.length > maxBatchSize;
  const advancedInputKeys = useMemo(() => advancedInputKeysFor(selectedModel), [selectedModel]);
  const imageRoles = useMemo(() => getSupportedGenerationImageRoles(selectedModel), [selectedModel]);
  const referenceVideoSupport = useMemo(() => getGenerationReferenceVideoSupport(selectedModel), [selectedModel]);
  const supportsRawElements = modelDeclaresGenerationInput(selectedModel, 'elements');
  const durationControl = selectedModel?.controls.find(control => control.key === 'duration');
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


  const applyModel = (model?: GenerationModelConfig) => {
    setModelId(model?.id || '');
    setTargetMode('new');
    setTargetColumn(targetColumnFor(model));
    setDefaultControls(Object.fromEntries(
      (model?.controls || []).map(control => [control.key, control.defaultValue ?? '']),
    ));
    setPerCaseControlColumns({});
    setDurationMode('uniform');
    setDurationColumn('');
    const videoSupport = getGenerationReferenceVideoSupport(model);
    setReferenceInputMode(videoSupport.supported ? 'video_columns' : 'raw_elements');
    audioProbeController.current?.abort();
    setAudioProbe({ status: 'idle', values: {}, issues: {} });
    setInputMapping(current => ({
      ...current,
      referenceVideoColumns: [],
      extraInputMappings: {},
    }));
    setPreflight(null);
    setConfirmed(false);
  };

  useEffect(() => {
    setInputMapping(defaultGenerationInputMapping(dataset, headers, mappings));
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
  }, [dataset.items, inputMapping, selectedDatasetItemIds]);

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
    setConfirmed(false);
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

  const toggleMappingColumn = (
    field: 'referenceImageColumns' | 'referenceAudioColumns' | 'referenceVideoColumns' | 'extraInputColumns',
    column: string,
  ) => {
    const values = inputMapping[field] || [];
    updateMapping({
      [field]: values.includes(column) ? values.filter(value => value !== column) : [...values, column],
    });
  };

  const imageRoleOccupied = (role: GenerationImageRole, column: string) => (
    role === 'start'
      ? Boolean(inputMapping.startImageColumn && inputMapping.startImageColumn !== column)
      : role === 'end'
        ? Boolean(inputMapping.endImageColumn && inputMapping.endImageColumn !== column)
        : false
  );

  const toggleImageColumn = (column: string) => {
    const currentRole = getGenerationImageRole(inputMapping, column);
    if (currentRole) {
      updateMapping(setGenerationImageRole(inputMapping, column));
      return;
    }

    const inferredRole = selectedModel?.outputModality === 'image'
      ? 'reference'
      : inferGenerationImageRole(column, dataset.inputSchema || []);
    const nextRole = [inferredRole, ...imageRoles]
      .find((role, index, roles) => roles.indexOf(role) === index
        && imageRoles.includes(role)
        && !imageRoleOccupied(role, column));
    if (!nextRole) {
      setError('\u5f53\u524d\u6a21\u578b\u6ca1\u6709\u53ef\u7528\u7684\u56fe\u50cf\u8f93\u5165\u89d2\u8272\u3002');
      return;
    }
    setError('');
    updateMapping(setGenerationImageRole(inputMapping, column, nextRole));
  };

  const changeImageRole = (column: string, role: GenerationImageRole) => {
    if (!imageRoles.includes(role) || imageRoleOccupied(role, column)) return;
    updateMapping(setGenerationImageRole(inputMapping, column, role));
  };

  const changeDurationMode = (mode: GenerationDurationSourceMode) => {
    setDurationMode(mode);
    if (mode !== 'column') setDurationColumn('');
    invalidatePreflight();
  };

  const changeReferenceInputMode = (mode: 'video_columns' | 'raw_elements') => {
    setReferenceInputMode(mode);
    if (mode === 'video_columns') {
      const nextMappings = { ...(inputMapping.extraInputMappings || {}) };
      delete nextMappings.elements;
      updateMapping({ extraInputMappings: nextMappings });
      return;
    }
    updateMapping({ referenceVideoColumns: [] });
  };

  const changeRawElementsColumn = (column: string) => {
    const nextMappings = { ...(inputMapping.extraInputMappings || {}) };
    if (column) nextMappings.elements = column;
    else delete nextMappings.elements;
    updateMapping({
      extraInputMappings: nextMappings,
      referenceVideoColumns: [],
    });
  };

  const buildRequest = (): GenerationPreflightRequest => {
    if (!selectedModel) throw new Error('Select a model before preflight.');
    const requestDefaultControls = { ...defaultControls };
    const requestPerCaseControlColumns = { ...perCaseControlColumns };
    delete requestPerCaseControlColumns.duration;

    let durationSource: GenerationPreflightRequest['durationSource'];
    if (durationControl) {
      if (durationMode === 'uniform') {
        durationSource = { mode: 'uniform' };
      } else if (durationMode === 'column') {
        delete requestDefaultControls.duration;
        durationSource = { mode: 'column', column: durationColumn };
      } else {
        delete requestDefaultControls.duration;
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
      perCaseControlColumns: requestPerCaseControlColumns,
      durationSource,
      seedMode,
      fixedSeed: seedMode === 'fixed' ? fixedSeed : undefined,
      seedColumn: seedMode === 'column' ? seedColumn : undefined,
      assetBindings,
    };
  };

  const runPreflight = async () => {
    setError('');
    setBusy(true);
    setConfirmed(false);
    try {
      const next = await createExecutionPreflight(buildRequest());
      setPreflight(next);
      setStep(3);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
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
                    {targetInspection?.errors.map(issue => (
                      <div key={issue.code} className="mt-3 flex items-start gap-2 text-sm text-red-300">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <span>[{issue.code}] {issue.message}</span>
                      </div>
                    ))}
                    {targetInspection?.warnings.map(issue => (
                      <div key={issue.code} className="mt-3 flex items-start gap-2 text-sm text-amber-300">
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
                <div className="max-w-xl">
                  {renderColumnSelect(inputMapping.promptColumn, value => updateMapping({ promptColumn: value }), copy.promptColumn)}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-2 text-xs text-slate-400">{copy.imageInputs}</div>
                    <div data-testid="generation-image-input-columns" className="max-h-44 space-y-1 overflow-auto border border-white/10 p-2">
                      {headers.map(header => {
                        const selectedRole = getGenerationImageRole(inputMapping, header);
                        const roleOptions = selectedRole
                          ? Array.from(new Set([selectedRole, ...imageRoles]))
                          : imageRoles;
                        const hasAvailableRole = imageRoles.some(role => !imageRoleOccupied(role, header));
                        return (
                          <div key={header} className="flex min-h-8 items-center gap-2 px-1 py-1 text-xs text-slate-300">
                            <label className="flex min-w-0 flex-1 items-center gap-2">
                              <input
                                type="checkbox"
                                data-generation-image-column={header}
                                checked={Boolean(selectedRole)}
                                disabled={!selectedRole && !hasAvailableRole}
                                onChange={() => toggleImageColumn(header)}
                              />
                              <span className="truncate" title={header}>{header}</span>
                            </label>
                            {selectedRole && selectedModel.outputModality === 'video' && roleOptions.length > 1 ? (
                              <select
                                value={selectedRole}
                                aria-label={`${header} ${copy.imageRole}`}
                                onChange={event => changeImageRole(header, event.target.value as GenerationImageRole)}
                                className={`w-24 shrink-0 rounded-md border bg-slate-900 px-2 py-1 text-xs ${
                                  imageRoles.includes(selectedRole)
                                    ? 'border-white/10 text-slate-200'
                                    : 'border-red-400/40 text-red-300'
                                }`}
                              >
                                {roleOptions.map(role => (
                                  <option
                                    key={role}
                                    value={role}
                                    disabled={!imageRoles.includes(role) || imageRoleOccupied(role, header)}
                                  >
                                    {imageRoleLabels[role]}
                                  </option>
                                ))}
                              </select>
                            ) : selectedRole ? (
                              <span className={`shrink-0 px-2 py-1 ${
                                imageRoles.includes(selectedRole) ? 'text-slate-400' : 'text-red-300'
                              }`}>
                                {selectedModel.outputModality === 'image'
                                  ? copy.imageRole
                                  : imageRoles.includes(selectedRole)
                                    ? imageRoleLabels[selectedRole]
                                    : copy.unsupportedRole}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 text-xs text-slate-400">{copy.refAudios}</div>
                    <div data-testid="generation-audio-input-columns" className="max-h-44 space-y-1 overflow-auto border border-white/10 p-2">
                      {headers.map(header => (
                        <label key={header} className="flex min-h-8 items-center gap-2 px-1 py-1 text-xs text-slate-300">
                          <input type="checkbox" checked={inputMapping.referenceAudioColumns.includes(header)} onChange={() => toggleMappingColumn('referenceAudioColumns', header)} />
                          <span className="truncate" title={header}>{header}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                {selectedModel.outputModality === 'video'
                  && (referenceVideoSupport.supported || supportsRawElements)
                  && (
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs font-medium text-slate-300">{copy.refVideosAndElements}</div>
                        {referenceVideoSupport.supported && supportsRawElements && (
                          <div className="flex border border-white/10 bg-black/20 p-1" role="group" aria-label={copy.refVideosAndElements}>
                            <button
                              type="button"
                              aria-pressed={referenceInputMode === 'video_columns'}
                              onClick={() => changeReferenceInputMode('video_columns')}
                              className={`px-3 py-1.5 text-xs ${referenceInputMode === 'video_columns' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
                            >
                              {copy.videoColumns}
                            </button>
                            <button
                              type="button"
                              aria-pressed={referenceInputMode === 'raw_elements'}
                              onClick={() => changeReferenceInputMode('raw_elements')}
                              className={`px-3 py-1.5 text-xs ${referenceInputMode === 'raw_elements' ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/5'}`}
                            >
                              {copy.rawElements}
                            </button>
                          </div>
                        )}
                      </div>
                      {referenceVideoSupport.supported && referenceInputMode === 'video_columns' ? (
                        <div data-testid="generation-video-input-columns" className="max-h-44 space-y-1 overflow-auto border border-white/10 p-2">
                          {headers.map(header => (
                            <label key={header} className="flex min-h-8 items-center gap-2 px-1 py-1 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                checked={(inputMapping.referenceVideoColumns || []).includes(header)}
                                onChange={() => toggleMappingColumn('referenceVideoColumns', header)}
                              />
                              <span className="truncate" title={header}>{header}</span>
                            </label>
                          ))}
                        </div>
                      ) : supportsRawElements ? (
                        <div className="max-w-xl">
                          {renderColumnSelect(
                            inputMapping.extraInputMappings?.elements,
                            changeRawElementsColumn,
                            'elements JSON',
                            'elements',
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                {!!advancedInputKeys.length && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs text-slate-400">Advanced model inputs</div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {advancedInputKeys.map(inputKey => renderColumnSelect(
                        inputMapping.extraInputMappings?.[inputKey],
                        value => updateMapping({
                          extraInputMappings: {
                            ...(inputMapping.extraInputMappings || {}),
                            [inputKey]: value,
                          },
                        }),
                        inputKey,
                        inputKey,
                      ))}
                    </div>
                  </div>
                )}
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
                    <div className="mb-2 text-xs text-slate-400">{copy.durationSource}</div>
                    <div className="mb-3 flex w-fit max-w-full flex-wrap border border-white/10 bg-black/20 p-1" role="group" aria-label={copy.durationSource}>
                      {([
                        ['uniform', copy.uniformDuration],
                        ['column', copy.durationColumn],
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
                <div className="grid gap-3 md:grid-cols-3">
                  {(selectedModel.controls || []).filter(control => control.key !== 'duration').map(renderControl)}
                </div>
                {!!selectedModel.controls.filter(control => control.key !== 'duration').length && (
                  <div className="mt-5">
                    <div className="mb-2 text-xs text-slate-400">{copy.caseColumn}</div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {selectedModel.controls.filter(control => control.key !== 'duration').map(control => renderColumnSelect(
                        perCaseControlColumns[control.key],
                        value => { setPerCaseControlColumns(current => ({ ...current, [control.key]: value })); invalidatePreflight(); },
                        control.label,
                        control.key,
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="border-t border-white/10 pt-5">
                <h3 className="mb-3 text-sm font-semibold text-slate-100">{copy.seed}</h3>
                <div className="flex flex-wrap gap-4 text-sm text-slate-300">
                  {([
                    ['derive_from_case', copy.derived],
                    ['fixed', copy.fixed],
                    ['column', copy.fromColumn],
                  ] as const).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2"><input type="radio" checked={seedMode === value} onChange={() => { setSeedMode(value); invalidatePreflight(); }} /> {label}</label>
                  ))}
                </div>
                {seedMode === 'fixed' && <input type="number" value={fixedSeed} onChange={event => { setFixedSeed(Number(event.target.value)); invalidatePreflight(); }} className="mt-3 w-44 border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" />}
                {seedMode === 'column' && <div className="mt-3 max-w-sm">{renderColumnSelect(seedColumn, value => { setSeedColumn(value); invalidatePreflight(); }, 'Seed column')}</div>}
              </section>

              <GenerationCaseSelector
                dataset={dataset}
                inputMapping={inputMapping}
                targetColumn={targetColumn}
                selectedDatasetItemIds={selectedDatasetItemIds}
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
                        {preflight.batchWarnings.map(issue => (
                          <div key={issue.code}>[{issue.code}] {issue.message}</div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section>
                    <h3 className="mb-3 text-sm font-semibold text-slate-100">Case validation</h3>
                    <div className="max-h-72 overflow-auto border border-white/10">
                      {preflight.cases.map((item, index) => (
                        <div key={`${String(item.resolvedCase.caseId || index)}-${index}`} className="grid gap-2 border-b border-white/5 px-3 py-3 text-xs last:border-0 md:grid-cols-[180px_130px_1fr]">
                          <div className="truncate text-slate-200" title={String(item.resolvedCase.caseId || '')}>{String(item.resolvedCase.caseId || `case-${index + 1}`)}</div>
                          <div className={item.valid ? 'text-emerald-300' : 'text-red-300'}>{item.valid ? '\u6709\u6548' : '\u65e0\u6548'} / {item.generationType}</div>
                          <div className="space-y-1 text-slate-400">
                            {item.errors.map(issue => <div key={`${issue.code}-${issue.field || ''}`} className="text-red-300">[{issue.code}] {issue.message}</div>)}
                            {item.warnings.map(issue => <div key={`${issue.code}-${issue.field || ''}`} className="text-amber-300">[{issue.code}] {issue.message}</div>)}
                            {item.resolvedCase.durationResolution?.source === 'reference_audio' && (
                              <div className="text-sky-300">
                                {'\u97f3\u9891 '}{item.resolvedCase.durationResolution.detectedSeconds}s
                                {' \u2192 \u8bf7\u6c42 '}{item.resolvedCase.durationResolution.resolvedDuration}s
                              </div>
                            )}
                            {!item.errors.length && !item.warnings.length && !item.resolvedCase.durationResolution && <span>-</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <label className="flex items-start gap-3 border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                    <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
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
                    {batch.items.some(item => ['submitting', 'submitted', 'processing', 'archiving'].includes(item.status)) && (
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
                              <div className={item.status === 'succeeded' ? 'text-emerald-300' : item.status === 'failed' || item.status === 'submission_unknown' ? 'text-red-300' : 'text-blue-300'}>{statusLabel(item.status)}</div>
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
                              <div>{item.error?.message || item.providerStatus || '-'}</div>
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
                              {item.status === 'pending' && <div className="mt-1 text-slate-500">{'\u7b49\u5f85\u516c\u5e73\u8c03\u5ea6'}</div>}
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
                <button type="button" disabled={busy || !confirmed || preflight.validCount === 0} onClick={() => { void confirmPreflight(); }} className="inline-flex items-center gap-2 bg-amber-500 px-5 py-2 text-sm font-medium text-black disabled:opacity-40">
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
