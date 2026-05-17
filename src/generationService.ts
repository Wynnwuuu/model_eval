import {
  DatasetGenerationJobItem,
  DatasetPreviewType,
  GenerationInputMapping,
  GenerationModelConfig
} from './types';

export interface GenerationCasePayload {
  caseId: string;
  rowIndex: number;
  prompt?: string;
  referenceImageUrls: string[];
  referenceAudioUrls: string[];
  startImageUrl?: string;
  endImageUrl?: string;
  lyricsOrDialogue?: string;
  extraInputs: Record<string, any>;
  controls: Record<string, any>;
  seed: number;
  idempotencyKey: string;
}

export interface GenerationBatchPayload {
  jobId: string;
  datasetId: string;
  model: GenerationModelConfig;
  targetColumn: string;
  inputMapping: GenerationInputMapping;
  defaultControls: Record<string, any>;
  cases: GenerationCasePayload[];
}

interface BackendBatchStatus {
  id?: string;
  status?: string;
  items?: Array<Partial<DatasetGenerationJobItem> & {
    caseId: string;
    rowIndex?: number;
    errorCode?: string;
    errorMessage?: string;
  }>;
}
type BackendBatchItem = NonNullable<BackendBatchStatus['items']>[number];

const BACKEND_URL = (import.meta.env.VITE_GENERATION_BACKEND_URL || '').replace(/\/+$/, '');

const VIDEO_SAMPLES = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4'
];

export const DEFAULT_GENERATION_MODELS: GenerationModelConfig[] = [
  {
    id: 'seedance-2.0-fast',
    displayName: 'Seedance 2.0 Fast',
    provider: 'mock-vidmuse',
    outputModality: 'video',
    previewType: 'video',
    capabilities: ['text2video', 'image2video', 'ref2video', 'keyframe2video'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportedResolutions: ['720p'],
    supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    controls: [
      { key: 'aspect_ratio', label: '宽高比', type: 'select', options: ['16:9', '9:16', '1:1', '4:3', '3:4'], defaultValue: '16:9' },
      { key: 'resolution', label: '分辨率', type: 'select', options: ['720p'], defaultValue: '720p' },
      { key: 'duration', label: '时长', type: 'select', options: ['4', '5', '6', '8', '10', '12', '15'], defaultValue: '5', unit: 's' },
      { key: 'quality', label: '画质', type: 'select', options: ['standard', 'high'], defaultValue: 'standard' },
      { key: 'fps', label: 'FPS', type: 'number', defaultValue: 24 },
      { key: 'style', label: '风格/生成方式', type: 'text', defaultValue: '' },
      { key: 'test_variable', label: '测试变量', type: 'text', defaultValue: '' },
      { key: 'control_variable', label: '控制变量', type: 'text', defaultValue: '' },
      { key: 'constraints', label: '约束条件', type: 'text', defaultValue: '' }
    ]
  },
  {
    id: 'seedance-2.0-pro',
    displayName: 'Seedance 2.0 Pro',
    provider: 'mock-vidmuse',
    outputModality: 'video',
    previewType: 'video',
    capabilities: ['text2video', 'image2video', 'ref2video', 'keyframe2video'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportedResolutions: ['720p', '1080p'],
    supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    controls: [
      { key: 'aspect_ratio', label: '宽高比', type: 'select', options: ['16:9', '9:16', '1:1', '4:3', '3:4'], defaultValue: '16:9' },
      { key: 'resolution', label: '分辨率', type: 'select', options: ['720p', '1080p'], defaultValue: '1080p' },
      { key: 'duration', label: '时长', type: 'select', options: ['4', '5', '6', '8', '10', '12', '15'], defaultValue: '5', unit: 's' },
      { key: 'quality', label: '画质', type: 'select', options: ['standard', 'high'], defaultValue: 'high' },
      { key: 'fps', label: 'FPS', type: 'number', defaultValue: 24 },
      { key: 'style', label: '风格/生成方式', type: 'text', defaultValue: '' },
      { key: 'test_variable', label: '测试变量', type: 'text', defaultValue: '' },
      { key: 'control_variable', label: '控制变量', type: 'text', defaultValue: '' },
      { key: 'constraints', label: '约束条件', type: 'text', defaultValue: '' }
    ]
  },
  {
    id: 'mock-image-generator',
    displayName: 'Mock Image Generator',
    provider: 'mock',
    outputModality: 'image',
    previewType: 'image',
    capabilities: ['text2image', 'image2image'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportedResolutions: ['1024px'],
    controls: [
      { key: 'aspect_ratio', label: '宽高比', type: 'select', options: ['16:9', '9:16', '1:1', '4:3', '3:4'], defaultValue: '1:1' },
      { key: 'quality', label: '画质', type: 'select', options: ['standard', 'high'], defaultValue: 'standard' },
      { key: 'style', label: '风格/生成方式', type: 'text', defaultValue: '' },
      { key: 'constraints', label: '约束条件', type: 'text', defaultValue: '' }
    ]
  },
  {
    id: 'mock-audio-generator',
    displayName: 'Mock Audio Generator',
    provider: 'mock',
    outputModality: 'audio',
    previewType: 'audio',
    capabilities: ['text2audio', 'lyrics2audio'],
    supportedDurations: [10, 30, 60],
    controls: [
      { key: 'duration', label: '时长', type: 'select', options: ['10', '30', '60'], defaultValue: '30', unit: 's' },
      { key: 'quality', label: '画质/音质', type: 'select', options: ['standard', 'high'], defaultValue: 'standard' },
      { key: 'style', label: '风格/生成方式', type: 'text', defaultValue: '' }
    ]
  }
];

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export const hashStringToSeed = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const normalizeBackendItem = (
  jobId: string,
  datasetId: string,
  fallbackCase: GenerationCasePayload | undefined,
  item: BackendBatchItem
): DatasetGenerationJobItem => ({
  id: item.id || `${jobId}-${item.caseId}`,
  jobId,
  datasetId,
  rowIndex: item.rowIndex ?? fallbackCase?.rowIndex ?? 0,
  caseId: item.caseId,
  status: (item.status as DatasetGenerationJobItem['status']) || 'failed',
  requestId: item.requestId,
  providerJobId: item.providerJobId,
  resolvedInputs: item.resolvedInputs || fallbackCase || {},
  resolvedControls: item.resolvedControls || fallbackCase?.controls || {},
  seed: item.seed ?? fallbackCase?.seed,
  resultUrl: item.resultUrl,
  resultText: item.resultText,
  mediaType: item.mediaType,
  error: item.error || (item.errorMessage ? { code: item.errorCode, message: item.errorMessage } : undefined),
  startedAt: item.startedAt,
  finishedAt: item.finishedAt
});

const mockResultForCase = (payload: GenerationBatchPayload, item: GenerationCasePayload): Pick<DatasetGenerationJobItem, 'resultUrl' | 'resultText' | 'mediaType'> => {
  const previewType = payload.model.previewType;
  if (previewType === 'video') {
    return {
      resultUrl: VIDEO_SAMPLES[item.seed % VIDEO_SAMPLES.length],
      mediaType: 'video'
    };
  }
  if (previewType === 'image') {
    const ratio = String(item.controls.aspect_ratio || '1:1');
    const [w, h] = ratio === '16:9'
      ? [1024, 576]
      : ratio === '9:16'
        ? [576, 1024]
        : ratio === '4:3'
          ? [1024, 768]
          : ratio === '3:4'
            ? [768, 1024]
            : [900, 900];
    return {
      resultUrl: `https://picsum.photos/seed/eval-${item.seed}/${w}/${h}`,
      mediaType: 'image'
    };
  }
  if (previewType === 'audio') {
    return {
      resultUrl: `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${(item.seed % 3) + 1}.mp3`,
      mediaType: 'audio'
    };
  }
  return {
    resultText: `[Mock ${payload.model.displayName}] ${item.prompt || item.caseId}`,
    mediaType: 'text' as DatasetPreviewType
  };
};

export const listGenerationModels = async (): Promise<GenerationModelConfig[]> => {
  if (!BACKEND_URL) return DEFAULT_GENERATION_MODELS;

  try {
    const response = await fetch(`${BACKEND_URL}/api/generation/models`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : data.models || DEFAULT_GENERATION_MODELS;
  } catch (error) {
    console.warn('Failed to load generation models from backend, using mock defaults.', error);
    return DEFAULT_GENERATION_MODELS;
  }
};

export const runGenerationBatch = async (
  payload: GenerationBatchPayload,
  onItemUpdate: (item: DatasetGenerationJobItem) => Promise<void> | void,
  isCancelled: () => boolean
) => {
  if (!BACKEND_URL) {
    for (const item of payload.cases) {
      if (isCancelled()) return;
      const now = Date.now();
      await onItemUpdate({
        id: `${payload.jobId}-${item.caseId}`,
        jobId: payload.jobId,
        datasetId: payload.datasetId,
        rowIndex: item.rowIndex,
        caseId: item.caseId,
        status: 'running',
        requestId: `mock-req-${item.seed}`,
        providerJobId: `mock-provider-${item.seed}`,
        resolvedInputs: item,
        resolvedControls: item.controls,
        seed: item.seed,
        startedAt: now
      });

      await sleep(350);
      const shouldFail = /mock[-_\s]?fail|fail_generation|模拟失败/i.test(`${item.prompt || ''} ${item.caseId}`);
      const finishedAt = Date.now();
      await onItemUpdate({
        id: `${payload.jobId}-${item.caseId}`,
        jobId: payload.jobId,
        datasetId: payload.datasetId,
        rowIndex: item.rowIndex,
        caseId: item.caseId,
        status: shouldFail ? 'failed' : 'completed',
        requestId: `mock-req-${item.seed}`,
        providerJobId: `mock-provider-${item.seed}`,
        resolvedInputs: item,
        resolvedControls: item.controls,
        seed: item.seed,
        ...(shouldFail
          ? { error: { code: 'MOCK_FAILURE', message: 'Mock 失败：prompt 或 caseId 命中了 mock-fail 标记。' } }
          : mockResultForCase(payload, item)),
        startedAt: now,
        finishedAt
      });
    }
    return;
  }

  let backendBatchId = '';
  try {
    const createResponse = await fetch(`${BACKEND_URL}/api/generation/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!createResponse.ok) throw new Error(`创建批量生产任务失败：HTTP ${createResponse.status}`);
    const created = await createResponse.json();
    backendBatchId = created.id || created.batchId || payload.jobId;
  } catch (error: any) {
    await Promise.all(payload.cases.map(item => onItemUpdate({
      id: `${payload.jobId}-${item.caseId}`,
      jobId: payload.jobId,
      datasetId: payload.datasetId,
      rowIndex: item.rowIndex,
      caseId: item.caseId,
      status: 'failed',
      resolvedInputs: item,
      resolvedControls: item.controls,
      seed: item.seed,
      error: { code: 'BACKEND_CREATE_FAILED', message: error?.message || String(error) },
      finishedAt: Date.now()
    })));
    return;
  }

  const emitted = new Map<string, string>();
  const casesById = new Map(payload.cases.map(item => [item.caseId, item]));

  for (let attempt = 0; attempt < 720; attempt += 1) {
    if (isCancelled()) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/generation/batches/${encodeURIComponent(backendBatchId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.json() as BackendBatchStatus;
      const items = status.items || [];
      for (const item of items) {
        const normalized = normalizeBackendItem(payload.jobId, payload.datasetId, casesById.get(item.caseId), item);
        const signature = JSON.stringify(normalized);
        if (emitted.get(normalized.caseId) !== signature) {
          emitted.set(normalized.caseId, signature);
          await onItemUpdate(normalized);
        }
      }
      const done = status.status && ['completed', 'partial', 'failed', 'cancelled'].includes(status.status);
      if (done) return;
    } catch (error: any) {
      await Promise.all(payload.cases.map(item => {
        if (emitted.has(item.caseId)) return undefined;
        return onItemUpdate({
          id: `${payload.jobId}-${item.caseId}`,
          jobId: payload.jobId,
          datasetId: payload.datasetId,
          rowIndex: item.rowIndex,
          caseId: item.caseId,
          status: 'failed',
          resolvedInputs: item,
          resolvedControls: item.controls,
          seed: item.seed,
          error: { code: 'BACKEND_POLL_FAILED', message: error?.message || String(error) },
          finishedAt: Date.now()
        });
      }));
      return;
    }

    await sleep(1500);
  }
};
