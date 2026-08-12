import {
  DatasetGenerationJob,
  DatasetGenerationJobItem,
  GenerationAssetBinding,
  GenerationDurationSource,
  GenerationCaseReview,
  GenerationInputMapping,
  GenerationModelConfig,
  GenerationPreflightResult,
  GenerationJobEvent,
  GenerationJobStatus,
  GenerationQueueState,
  GenerationSeedMode,
  GenerationParameterBinding,
  GenerationTargetMode,
} from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';

export interface GenerationPreflightRequest {
  datasetId: string;
  datasetVersion: number;
  datasetName?: string;
  modelName: string;
  expectedConfigFingerprint?: string;
  targetColumn: string;
  targetMode: GenerationTargetMode;
  inputMapping: GenerationInputMapping;
  defaultControls: Record<string, unknown>;
  perCaseControlColumns: Record<string, string>;
  parameterBindings?: Record<string, GenerationParameterBinding>;
  durationSource?: GenerationDurationSource;
  seedMode: GenerationSeedMode;
  seedPolicyVersion: 2;
  fixedSeed?: number;
  seedColumn?: string;
  selectedDatasetItemIds?: string[];
  assetBindings?: GenerationAssetBinding[];
  caseReviews?: Record<string, GenerationCaseReview>;
}

export interface GenerationRuntimeHealth {
  configured: boolean;
  aionConfigured: boolean;
  ossConfigured: boolean;
  assetMode: 'oss' | 'temporary_url';
  executionTransport: 'model_api' | 'task_worker';
  durableAssets: boolean;
  localUploadsEnabled: boolean;
  workerEnabled: boolean;
  maxBatchSize: number;
  imageConcurrency: number;
  videoConcurrency: number;
  taskTimeoutMs: number;
}

export interface GenerationBatch extends DatasetGenerationJob {
  sourceDatasetVersion: number;
  controls: Record<string, any>;
  targetMode?: GenerationTargetMode;
  costEstimate: GenerationPreflightResult['costEstimate'];
  items: Array<DatasetGenerationJobItem & {
    datasetItemId?: string;
  }>;
  error?: Record<string, any>;
  startedAt?: number;
  finishedAt?: number;
}

interface SingleUpload {
  assetId: string;
  mode: 'single';
  uploadUrl: string;
  headers?: Record<string, string>;
}

interface MultipartUpload {
  assetId: string;
  mode: 'multipart';
  uploadId: string;
  partSize: number;
  partUrls: Array<{ partNumber: number; url: string }>;
}

type UploadPlan = SingleUpload | MultipartUpload;

const requireSharedBackend = () => {
  if (!USE_SHARED_DATA_SOURCE) {
    throw new Error('Model generation requires the shared ManuEval dev backend.');
  }
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  requireSharedBackend();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getApiAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || body?.error || body?.message || `Request failed: HTTP ${response.status}`,
    ) as Error & { code?: string; details?: Record<string, any>; status?: number };
    error.code = body?.error?.code || body?.code;
    error.details = body?.error?.details || body?.details;
    error.status = response.status;
    throw error;
  }
  return body as T;
};

export const listExecutionModels = async (): Promise<GenerationModelConfig[]> => {
  const response = await requestJson<{ models: GenerationModelConfig[] }>('/api/generation/models');
  return Array.isArray(response.models) ? response.models : [];
};

export const getGenerationRuntimeHealth = async (): Promise<GenerationRuntimeHealth> =>
  requestJson<GenerationRuntimeHealth>('/api/generation/health');

export const createExecutionPreflight = async (
  preflight: GenerationPreflightRequest,
): Promise<GenerationPreflightResult> => {
  const response = await requestJson<{ preflight: GenerationPreflightResult }>('/api/generation/preflights', {
    method: 'POST',
    body: JSON.stringify({ preflight }),
  });
  return response.preflight;
};

export const confirmExecutionPreflight = async (preflightId: string) => {
  return requestJson<{ batchId: string; reused: boolean }>('/api/generation/batches', {
    method: 'POST',
    body: JSON.stringify({ batch: { preflightId } }),
  });
};

export const getExecutionBatch = async (batchId: string): Promise<GenerationBatch> => {
  const response = await requestJson<{ batch: GenerationBatch }>(
    `/api/generation/batches/${encodeURIComponent(batchId)}`,
  );
  return response.batch;
};

export const cancelExecutionBatch = async (batchId: string) => {
  await requestJson(`/api/generation/batches/${encodeURIComponent(batchId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

export const createRetryPreflight = async (
  batchId: string,
  itemIds: string[],
  forceDuplicateBillingRisk = false,
): Promise<GenerationPreflightResult> => {
  const response = await requestJson<{ preflight: GenerationPreflightResult }>(
    `/api/generation/batches/${encodeURIComponent(batchId)}/retry`,
    {
      method: 'POST',
      body: JSON.stringify({ itemIds, forceDuplicateBillingRisk }),
    },
  );
  return response.preflight;
};

export type GenerationJobListFilters = {
  datasetId?: string;
  status?: GenerationJobStatus | '';
  model?: string;
  createdBy?: string;
  page?: number;
  limit?: number;
};

export const listExecutionJobs = async (filters: GenerationJobListFilters = {}) => {
  const search = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const suffix = search.toString();
  return requestJson<{
    jobs: DatasetGenerationJob[];
    total: number;
    page: number;
    limit: number;
  }>(`/api/generation/jobs${suffix ? `?${suffix}` : ''}`);
};

export const getGenerationQueue = async (): Promise<GenerationQueueState> => {
  const response = await requestJson<{ queue: GenerationQueueState }>('/api/generation/queue');
  return response.queue;
};

export const skipExecutionItems = async (batchId: string, itemIds: string[]) => {
  const response = await requestJson<{ accepted: boolean; batch: GenerationBatch }>(
    `/api/generation/batches/${encodeURIComponent(batchId)}/items/skip`,
    {
      method: 'POST',
      body: JSON.stringify({ itemIds }),
    },
  );
  return response.batch;
};

export const listExecutionBatchEvents = async (batchId: string): Promise<GenerationJobEvent[]> => {
  const response = await requestJson<{ events: GenerationJobEvent[] }>(
    `/api/generation/batches/${encodeURIComponent(batchId)}/events`,
  );
  return response.events;
};

const initiateUpload = async (datasetId: string, file: File, relativePath: string) => {
  const response = await requestJson<{ upload: UploadPlan }>('/api/generation/assets/initiate', {
    method: 'POST',
    body: JSON.stringify({
      asset: {
        datasetId,
        fileName: file.name,
        relativePath,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      },
    }),
  });
  return response.upload;
};

const completeUpload = async (
  assetId: string,
  multipart?: { uploadId: string; parts: Array<{ number: number; etag: string }> },
) => {
  const response = await requestJson<{
    asset: GenerationAssetBinding & {
      assetUrl: string;
      stableUrl: string;
      contentType?: string;
      sizeBytes?: number;
    };
  }>(`/api/generation/assets/${encodeURIComponent(assetId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(multipart || {}),
  });
  const asset = response.asset as typeof response.asset & { assetId?: string };
  return { ...asset, id: asset.id || asset.assetId || assetId };
};

const uploadSingle = async (file: File, plan: SingleUpload) => {
  const response = await fetch(plan.uploadUrl, {
    method: 'PUT',
    headers: plan.headers,
    body: file,
  });
  if (!response.ok) throw new Error(`OSS upload failed: HTTP ${response.status}`);
};

const uploadMultipart = async (file: File, plan: MultipartUpload) => {
  const parts: Array<{ number: number; etag: string }> = [];
  for (const part of plan.partUrls) {
    const start = (part.partNumber - 1) * plan.partSize;
    const end = Math.min(start + plan.partSize, file.size);
    const response = await fetch(part.url, {
      method: 'PUT',
      body: file.slice(start, end),
    });
    if (!response.ok) {
      throw new Error(`OSS multipart upload failed at part ${part.partNumber}: HTTP ${response.status}`);
    }
    const etag = response.headers.get('etag');
    if (!etag) throw new Error('OSS multipart upload did not expose the ETag response header.');
    parts.push({ number: part.partNumber, etag });
  }
  return parts;
};

export const uploadGenerationAsset = async (
  datasetId: string,
  file: File,
  relativePath = file.webkitRelativePath || file.name,
) => {
  const plan = await initiateUpload(datasetId, file, relativePath);
  if (plan.mode === 'single') {
    await uploadSingle(file, plan);
    return completeUpload(plan.assetId);
  }
  const parts = await uploadMultipart(file, plan);
  return completeUpload(plan.assetId, { uploadId: plan.uploadId, parts });
};

export const isTerminalGenerationBatch = (batch?: Pick<GenerationBatch, 'status' | 'writebackStatus'>) => {
  if (!batch) return false;
  const terminal = ['completed', 'partial', 'failed', 'cancelled', 'writeback_conflict'].includes(batch.status);
  return terminal && ['completed', 'conflict', 'failed'].includes(batch.writebackStatus || '');
};

export const waitForExecutionBatch = async (
  batchId: string,
  onUpdate: (batch: GenerationBatch) => void,
  signal?: AbortSignal,
) => {
  let delay = 1000;
  while (!signal?.aborted) {
    const batch = await getExecutionBatch(batchId);
    onUpdate(batch);
    if (isTerminalGenerationBatch(batch)) return batch;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(resolve, delay);
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
    delay = Math.min(5000, Math.round(delay * 1.35));
  }
  throw new DOMException('Aborted', 'AbortError');
};
