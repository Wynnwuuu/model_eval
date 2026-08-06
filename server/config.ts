import 'dotenv/config';
import { parseGenerationVideoModelLimits } from './generation/generationConcurrencyPolicy.ts';
import { parseGenerationModelValidationOverrides } from './generation/generationValidationPolicy.ts';


const DEFAULT_DATABASE_URL = 'postgresql://eval_studio:eval_studio_dev@localhost:5432/eval_studio';

const parseGenerationAssetMode = (value: string | undefined): 'oss' | 'temporary_url' =>
  value?.toLowerCase() === 'temporary_url' ? 'temporary_url' : 'oss';

const parseAionExecutionTransport = (value: string | undefined): 'model_api' | 'task_worker' =>
  value?.toLowerCase() === 'task_worker' ? 'task_worker' : 'model_api';

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const generationVideoConcurrency = parsePort(process.env.GENERATION_VIDEO_CONCURRENCY, 8);
const generationVideoModelLimits = parseGenerationVideoModelLimits(
  process.env.GENERATION_VIDEO_MODEL_LIMITS_JSON,
  generationVideoConcurrency,
);

const generationModelValidationOverrides = parseGenerationModelValidationOverrides(
  process.env.GENERATION_MODEL_VALIDATION_OVERRIDES_JSON,
);

export const serverConfig = {
  apiPort: parsePort(process.env.API_PORT, 8787),
  databaseUrl: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  databaseConnectionTimeoutMs: parsePort(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 15000),
  authMode: (process.env.AUTH_MODE || 'local').toLowerCase(),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresDays: parsePort(process.env.JWT_EXPIRES_DAYS, 7),
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  feishuRedirectUri: process.env.FEISHU_REDIRECT_URI || '',
  publicBaseUrl: (process.env.MANUEVAL_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  aionManagerBaseUrl: (process.env.AION_MANAGER_BASE_URL || '').replace(/\/+$/, ''),
  aionModelApiBaseUrl: (process.env.AION_MODEL_API_BASE_URL || '').replace(/\/+$/, ''),
  aionExecutionTransport: parseAionExecutionTransport(process.env.AION_EXECUTION_TRANSPORT),
  aionTaskWorkerBaseUrl: (process.env.AION_TASK_WORKER_BASE_URL || '').replace(/\/+$/, ''),
  aionTaskWorkerThreadId: process.env.AION_TASK_WORKER_THREAD_ID || '',
  aionTaskWorkerImageBaseUrl: (process.env.AION_TASK_WORKER_IMAGE_BASE_URL || 'https://vidmuse-dev.sandcdn.com').replace(/\/+$/, ''),
  aionTaskWorkerVideoBaseUrl: (process.env.AION_TASK_WORKER_VIDEO_BASE_URL || 'https://vidmuse-dev-video.sandcdn.com').replace(/\/+$/, ''),
  aionEvalUserId: process.env.AION_EVAL_USER_ID || '',
  aionRequestTimeoutMs: parsePort(process.env.AION_REQUEST_TIMEOUT_MS, 30000),
  generationWorkerEnabled: process.env.GENERATION_WORKER_ENABLED !== 'false',
  generationMaxBatchSize: parsePort(process.env.GENERATION_MAX_BATCH_SIZE, 500),
  generationImageConcurrency: parsePort(process.env.GENERATION_IMAGE_CONCURRENCY, 4),
  generationVideoConcurrency,
  generationVideoModelLimits,
  generationModelValidationOverrides,
  generationPollIntervalMs: parsePort(process.env.GENERATION_POLL_INTERVAL_MS, 5000),
  generationLeaseMs: parsePort(process.env.GENERATION_LEASE_MS, 60000),
  generationTaskTimeoutMs: parsePort(process.env.GENERATION_TASK_TIMEOUT_MS, 1500000),
  generationAssetMode: parseGenerationAssetMode(process.env.GENERATION_ASSET_MODE),
  generationReconciliationTimeoutMs: parsePort(process.env.GENERATION_RECONCILIATION_TIMEOUT_MS, 7200000),
  generationReconciliationPollMaxMs: parsePort(process.env.GENERATION_RECONCILIATION_POLL_MAX_MS, 600000),
  ossAccessKeyId: process.env.MANUEVAL_OSS_ACCESS_KEY_ID || '',
  ossAccessKeySecret: process.env.MANUEVAL_OSS_ACCESS_KEY_SECRET || '',
  ossEndpoint: process.env.MANUEVAL_OSS_ENDPOINT || '',
  ossRegion: process.env.MANUEVAL_OSS_REGION || '',
  ossBucket: process.env.MANUEVAL_OSS_BUCKET || '',
  ossPrefix: (process.env.MANUEVAL_OSS_PREFIX || 'manueval-dev').replace(/^\/+|\/+$/g, ''),
  ossPublicBaseUrl: (process.env.MANUEVAL_OSS_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  ossSignedUrlTtlSeconds: parsePort(process.env.MANUEVAL_OSS_SIGNED_URL_TTL_SECONDS, 86400),
  generationMaxAssetBytes: parsePort(process.env.GENERATION_MAX_ASSET_BYTES, 2147483647),
};
