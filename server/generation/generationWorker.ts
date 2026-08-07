import { randomUUID } from 'node:crypto';

import { serverConfig } from '../config.ts';
import {
  aionGenerationClient,
  aionUserAssetPathToUrl,
  type AionUserAssetOptions,
} from './aionGenerationClient.ts';
import { generationAssetService } from './generationAssetService.ts';
import {
  buildAionGenerationRequest,
  type GenerationCase,
  type NormalizedGenerationModel,
} from './generationPlanning.ts';
import { isForceableRelativeGenerationAsset } from '../../src/features/generation/vidmuseInputContract.ts';
import {
  claimNextGenerationItem,
  beginGenerationSubmission,
  findGenerationWritebackCandidate,
  refreshGenerationJob,
  releaseGenerationItemLease,
  renewGenerationItemLease,
  updateGenerationItem,
  type ClaimedGenerationItem,
} from './generationExecutionRepository.ts';
import { writeGenerationBatchToDataset } from './generationWritebackService.ts';

const TERMINAL_PROVIDER_STATUSES = new Set(['succeed', 'succeeded', 'success', 'completed']);
const FAILED_PROVIDER_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled']);

export const normalizeProviderPayload = (payload: Record<string, any>) => {
  const nested = [payload.data, payload.result, payload.payload]
    .find(value => value && typeof value === 'object' && !Array.isArray(value)) || {};
  const merged = { ...payload, ...nested };
  return {
    ...merged,
    task_id: merged.task_id ?? merged.taskId,
    task_status: merged.task_status ?? merged.taskStatus ?? merged.status,
    task_status_msg: merged.task_status_msg ?? merged.taskStatusMessage,
    endpoint_type: merged.endpoint_type ?? merged.endpointType,
    images: merged.images ?? merged.output?.images,
    videos: merged.videos ?? merged.output?.videos,
  };
};

type ProviderResultOptions = Partial<Omit<AionUserAssetOptions, 'mediaType'>> & {
  mediaType?: 'image' | 'video';
};

export type ResolvedProviderResult = {
  originalResultUrl: string;
  resultUrl: string;
  durability: 'vidmuse_asset' | 'temporary';
  previewUrl?: string;
};

export const providerResult = (
  rawPayload: Record<string, any>,
  options: ProviderResultOptions = {},
): ResolvedProviderResult | null => {
  const payload = normalizeProviderPayload(rawPayload);
  const imageMedia = Array.isArray(payload.images) && payload.images.length ? payload.images[0] : null;
  const videoMedia = Array.isArray(payload.videos) && payload.videos.length ? payload.videos[0] : null;
  const media = imageMedia || videoMedia;
  const mediaType = options.mediaType || (imageMedia ? 'image' : videoMedia ? 'video' : undefined);
  const directUrl = payload.result_url
    || payload.resultUrl
    || payload.video_url
    || payload.videoUrl
    || payload.image_url
    || payload.imageUrl
    || payload.url;
  const providerUrl = media?.url || media?.file_url || media?.fileUrl || directUrl;
  const originalResultUrl = providerUrl ? String(providerUrl) : undefined;
  const assetOptions = mediaType ? {
    mediaType,
    expectedUserId: options.expectedUserId ?? serverConfig.aionEvalUserId,
    imageBaseUrl: options.imageBaseUrl ?? serverConfig.aionTaskWorkerImageBaseUrl,
    videoBaseUrl: options.videoBaseUrl ?? serverConfig.aionTaskWorkerVideoBaseUrl,
  } : undefined;
  const persistedCandidates = [
    media?.local_path,
    media?.localPath,
    media?.file_path,
    media?.filePath,
    payload.local_path,
    payload.localPath,
    payload.file_path,
    payload.filePath,
    originalResultUrl,
  ];
  const stableResultUrl = assetOptions
    ? persistedCandidates
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map(value => aionUserAssetPathToUrl(value, assetOptions))
      .find(Boolean)
    : undefined;
  const resultUrl = stableResultUrl || originalResultUrl;
  if (!resultUrl) return null;
  return {
    originalResultUrl: originalResultUrl || resultUrl,
    resultUrl,
    durability: stableResultUrl ? 'vidmuse_asset' : 'temporary',
    previewUrl: media?.preview_url || media?.previewUrl
      ? String(media.preview_url || media.previewUrl)
      : undefined,
  };
};

export const unarchivedGenerationResult = (
  existing: Record<string, any>,
  result: ResolvedProviderResult,
  mediaType: 'image' | 'video',
) => ({
  ...existing,
  ...result,
  mediaType,
});

export const archivedGenerationResult = (
  existing: Record<string, any>,
  provider: ResolvedProviderResult,
  archivedResultUrl: string,
  mediaType: 'image' | 'video',
) => ({
  ...existing,
  originalResultUrl: provider.originalResultUrl,
  resultUrl: archivedResultUrl,
  mediaType,
  durability: 'manueval_oss' as const,
});

const nextPollAt = (attempt: number) =>
  Date.now() + Math.min(30000, serverConfig.generationPollIntervalMs * Math.max(1, 2 ** Math.min(attempt, 3)));


export type GenerationPollPhase = 'normal' | 'start_reconciling' | 'reconciling' | 'expired';

export const generationPollPhase = ({
  status,
  now,
  timeoutAt,
  reconciliationDeadlineAt,
}: {
  status: string;
  now: number;
  timeoutAt: number;
  reconciliationDeadlineAt?: number;
}): GenerationPollPhase => {
  if (status === 'reconciling') {
    return reconciliationDeadlineAt && now >= reconciliationDeadlineAt ? 'expired' : 'reconciling';
  }
  return now >= timeoutAt ? 'start_reconciling' : 'normal';
};

const reconciliationNextPollAt = (consecutiveFailures: number) => {
  const exponent = Math.min(Math.max(0, consecutiveFailures), 6);
  const delay = Math.max(
    30_000,
    serverConfig.generationPollIntervalMs * (2 ** exponent),
  );
  return Date.now() + Math.min(serverConfig.generationReconciliationPollMaxMs, delay);
};

type ProviderPollContext = {
  polledAt?: number;
  nonTerminalPhase?: 'normal' | 'reconciling' | 'expired';
  reconciliationStartedAt?: number;
  reconciliationDeadlineAt?: number;
  consecutivePollFailures?: number;
};
const prepareInputs = async (item: ClaimedGenerationItem, generationCase: GenerationCase) => {
  const resolve = async (value: string) => {
    if (isForceableRelativeGenerationAsset(value)) return value;
    if (generationAssetService.usesTemporaryUrls()) {
      if (value.startsWith('asset://')) {
        throw new Error('Uploaded local assets require OSS mode. Use a public media URL in temporary URL mode.');
      }
      return value;
    }
    if (value.startsWith('asset://')) return generationAssetService.resolveInputReference(value);
    const archived = await generationAssetService.archiveRemote(value, {
      datasetId: item.job.datasetId,
      jobId: item.jobId,
      jobItemId: item.id,
      kind: 'input',
      createdBy: item.job.createdBy,
    });
    return archived.signedUrl;
  };
  const mediaFieldPattern = /(?:url|uri|path|file|image|audio|video|asset|element|reference)/i;
  const resolveNestedAssets = async (
    value: unknown,
    fieldPath: string,
    inheritedMediaField = false,
  ): Promise<unknown> => {
    const mediaField = inheritedMediaField || mediaFieldPattern.test(fieldPath);
    if (mediaField && typeof value === 'string' && /^(https?:\/\/|asset:\/\/)/i.test(value)) {
      return resolve(value);
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((entry, index) => resolveNestedAssets(entry, `${fieldPath}[${index}]`, mediaField)));
    }
    if (value && typeof value === 'object') {
      const entries = await Promise.all(
        Object.entries(value).map(async ([key, entry]) => [
          key,
          await resolveNestedAssets(entry, `${fieldPath}.${key}`, mediaField),
        ] as const),
      );
      return Object.fromEntries(entries);
    }
    return value;
  };
  const extraInputs = generationCase.extraInputs
    ? Object.fromEntries(await Promise.all(Object.entries(generationCase.extraInputs).map(async ([key, value]) => [
      key,
      await resolveNestedAssets(value, key, /^elements?$/i.test(key)),
    ] as const)))
    : undefined;
  const audioInputs = generationCase.audioInputs?.length
    ? await Promise.all(generationCase.audioInputs.map(async audio => ({
        ...audio,
        url: await resolve(audio.url),
      })))
    : undefined;
  const audioUrls = audioInputs?.length
    ? audioInputs.map(audio => audio.url)
    : await Promise.all(generationCase.audioUrls.map(value => resolve(value)));
  const overrideAudit = generationCase.compilerAudit?.overrideAudit;
  const resolvedOverrideRequest = overrideAudit?.finalRequest
    ? await resolveNestedAssets(overrideAudit.finalRequest, 'request') as Record<string, unknown>
    : undefined;
  const compilerAudit = resolvedOverrideRequest && generationCase.compilerAudit
    ? {
        ...generationCase.compilerAudit,
        finalAionRequest: resolvedOverrideRequest,
        overrideAudit: {
          ...overrideAudit,
          finalRequest: resolvedOverrideRequest,
        },
      }
    : generationCase.compilerAudit;
  return {
    ...generationCase,
    imageUrls: await Promise.all(generationCase.imageUrls.map(value => resolve(value))),
    audioUrls,
    ...(audioInputs ? { audioInputs } : {}),
    extraInputs,
    ...(compilerAudit ? { compilerAudit } : {}),
  };
};

const archiveResult = async (
  item: ClaimedGenerationItem,
  provider: ResolvedProviderResult,
  mediaType: 'image' | 'video',
) => {
  if (generationAssetService.usesTemporaryUrls()) {
    await updateGenerationItem(item.id, {
      status: 'succeeded',
      result: unarchivedGenerationResult(item.result, provider, mediaType),
      archivedAssetId: null,
      providerStatus: 'succeed',
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    return;
  }
  const archived = await generationAssetService.archiveRemote(provider.originalResultUrl, {
    datasetId: item.job.datasetId,
    jobId: item.jobId,
    jobItemId: item.id,
    kind: 'output',
    fileName: `${item.request?.caseId || item.id}.${mediaType === 'image' ? 'png' : 'mp4'}`,
    createdBy: item.job.createdBy,
  });
  await updateGenerationItem(item.id, {
    status: 'succeeded',
    result: archivedGenerationResult(item.result, provider, archived.stableUrl, mediaType),
    archivedAssetId: archived.id,
    providerStatus: 'succeed',
    finishedAt: Date.now(),
    nextPollAt: null,
  });
};

const handleProviderPayload = async (
  item: ClaimedGenerationItem,
  payload: Record<string, any>,
  context: ProviderPollContext = {},
) => {
  payload = normalizeProviderPayload(payload);
  const providerStatus = String(payload.task_status || payload.status || '').toLowerCase();
  const result = providerResult(payload, {
    mediaType: item.job.model.outputModality,
  });
  const endpointType = payload.endpoint_type ? String(payload.endpoint_type) : item.providerEndpointType;
  const taskId = payload.task_id ? String(payload.task_id) : item.providerTaskId;
  const successfulPoll = context.polledAt ? {
    lastPollSucceededAt: context.polledAt,
    consecutivePollFailures: 0,
  } : {};

  if (result && (TERMINAL_PROVIDER_STATUSES.has(providerStatus) || !providerStatus)) {
    await updateGenerationItem(item.id, {
      status: 'archiving',
      providerTaskId: taskId,
      providerEndpointType: endpointType,
      providerStatus: providerStatus || 'succeed',
      result: { ...item.result, ...result },
      nextPollAt: Date.now(),
      ...successfulPoll,
    });
    await archiveResult(
      { ...item, providerTaskId: taskId, providerEndpointType: endpointType, result: { ...item.result, ...result } },
      result,
      item.job.model.outputModality,
    );
    return;
  }

  if (FAILED_PROVIDER_STATUSES.has(providerStatus)) {
    await updateGenerationItem(item.id, {
      status: 'failed',
      providerTaskId: taskId,
      providerEndpointType: endpointType,
      providerStatus,
      error: {
        code: 'PROVIDER_FAILED',
        message: String(payload.task_status_msg || payload.message || 'Aion provider task failed'),
        response: payload,
      },
      finishedAt: Date.now(),
      nextPollAt: null,
      ...successfulPoll,
    });
    return;
  }

  if (!taskId) {
    await updateGenerationItem(item.id, {
      status: 'submission_unknown',
      providerStatus: providerStatus || 'unknown',
      error: {
        code: 'MISSING_PROVIDER_TASK_ID',
        message: 'Aion returned no task_id; the submission cannot be safely retried.',
        response: payload,
      },
      finishedAt: Date.now(),
      nextPollAt: null,
      ...successfulPoll,
    });
    return;
  }

  if (context.nonTerminalPhase === 'expired') {
    await updateGenerationItem(item.id, {
      status: 'submission_unknown',
      providerTaskId: taskId,
      providerEndpointType: endpointType,
      providerStatus: providerStatus || item.providerStatus || 'unknown',
      error: {
        code: 'RECONCILIATION_EXPIRED',
        message: 'Aion remained non-terminal after the two-hour reconciliation window. Automatic retry is disabled.',
      },
      finishedAt: Date.now(),
      nextPollAt: null,
      ...successfulPoll,
    });
    return;
  }

  if (context.nonTerminalPhase === 'reconciling') {
    await updateGenerationItem(item.id, {
      status: 'reconciling',
      providerTaskId: taskId,
      providerEndpointType: endpointType,
      providerStatus: providerStatus || item.providerStatus || 'processing',
      error: {
        code: 'STATUS_RECONCILING',
        message: 'The local timeout was reached; ManuEval is still reconciling the existing Aion task and will not resubmit it.',
      },
      reconciliationStartedAt: context.reconciliationStartedAt,
      reconciliationDeadlineAt: context.reconciliationDeadlineAt,
      nextPollAt: reconciliationNextPollAt(0),
      ...successfulPoll,
    });
    return;
  }

  await updateGenerationItem(item.id, {
    status: providerStatus === 'processing' ? 'processing' : 'submitted',
    providerTaskId: taskId,
    providerEndpointType: endpointType,
    providerStatus: providerStatus || 'submitted',
    nextPollAt: nextPollAt(item.attempt),
    ...successfulPoll,
  });
};

export type GenerationSubmissionErrorDiagnostics = {
  httpStatus?: number;
  errorName?: string;
  transportCode?: string;
  definitelyRejected: boolean;
};

const safeDiagnosticToken = (value: unknown) => {
  const token = typeof value === 'string' ? value.trim() : '';
  return token && /^[A-Za-z0-9_.-]{1,64}$/.test(token) ? token : undefined;
};

export const generationSubmissionErrorDiagnostics = (
  error: unknown,
): GenerationSubmissionErrorDiagnostics => {
  const rawStatus = Number((error as any)?.status);
  const httpStatus = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
    ? rawStatus
    : undefined;
  const errorName = safeDiagnosticToken(error instanceof Error ? error.name : undefined);
  const transportCode = safeDiagnosticToken((error as any)?.code)
    || safeDiagnosticToken((error as any)?.cause?.code);
  return {
    ...(httpStatus ? { httpStatus } : {}),
    ...(errorName ? { errorName } : {}),
    ...(transportCode ? { transportCode } : {}),
    definitelyRejected: Boolean(httpStatus && httpStatus >= 400 && httpStatus < 500),
  };
};

const submitItem = async (item: ClaimedGenerationItem) => {
  const generationCase = item.request.resolvedInputs as GenerationCase & { generationType: string };
  let request: ReturnType<typeof buildAionGenerationRequest>;
  try {
    const resolvedCase = await prepareInputs(item, generationCase);
    request = buildAionGenerationRequest(
      item.job.model as NormalizedGenerationModel,
      resolvedCase as GenerationCase & { generationType: string },
    );
  } catch (error) {
    await updateGenerationItem(item.id, {
      status: 'failed',
      error: {
        code: 'INPUT_PREPARATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
      startedAt: item.startedAt || Date.now(),
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    return;
  }

  const submissionStartedAt = Date.now();
  const maySubmit = await beginGenerationSubmission(
    item.id,
    item.attempt + 1,
    item.startedAt || submissionStartedAt,
    submissionStartedAt,
  );
  if (!maySubmit) return;

  try {
    const payload = await aionGenerationClient.submit(request.path, request.body);
    await handleProviderPayload({
      ...item,
      attempt: item.attempt + 1,
      submissionStartedAt,
    }, payload);
  } catch (error) {
    const diagnostics = generationSubmissionErrorDiagnostics(error);
    const { definitelyRejected } = diagnostics;
    console.error('[generation-worker] provider submission failed', {
      modelName: String(item.job.model.modelName || item.job.model.name || 'unknown-model'),
      batchId: item.job.id,
      itemId: item.id,
      endpointPath: request.path,
      httpStatus: diagnostics.httpStatus,
      errorName: diagnostics.errorName,
      transportCode: diagnostics.transportCode,
      definitelyRejected,
    });
    await updateGenerationItem(item.id, {
      status: definitelyRejected ? 'failed' : 'submission_unknown',
      error: {
        code: definitelyRejected ? 'AION_SUBMIT_REJECTED' : 'AION_SUBMISSION_UNKNOWN',
        message: definitelyRejected
          ? (error instanceof Error ? error.message : String(error))
          : 'The Aion submission response was lost; automatic retry is disabled to prevent duplicate billing.',
        ...(diagnostics.httpStatus ? { httpStatus: diagnostics.httpStatus } : {}),
        ...(diagnostics.errorName ? { errorName: diagnostics.errorName } : {}),
        ...(diagnostics.transportCode ? { transportCode: diagnostics.transportCode } : {}),
      },
      finishedAt: Date.now(),
      nextPollAt: null,
    });
  }
};

const pollItem = async (item: ClaimedGenerationItem) => {
  if (!item.providerTaskId) {
    await updateGenerationItem(item.id, {
      status: 'submission_unknown',
      error: {
        code: 'MISSING_PROVIDER_TASK_ID',
        message: 'The submitted item has no provider task ID and cannot be polled safely.',
      },
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    return;
  }

  const now = Date.now();
  const timeoutAt = (item.submissionStartedAt || item.startedAt || now)
    + serverConfig.generationTaskTimeoutMs;
  const phase = generationPollPhase({
    status: item.status,
    now,
    timeoutAt,
    reconciliationDeadlineAt: item.reconciliationDeadlineAt,
  });
  const reconciliationStartedAt = item.reconciliationStartedAt || now;
  const reconciliationDeadlineAt = item.reconciliationDeadlineAt
    || reconciliationStartedAt + serverConfig.generationReconciliationTimeoutMs;
  const modelName = String(item.job.model.modelName || item.job.model.name || 'unknown-model');

  if (phase !== 'normal') {
    console.info('[generation-worker] reconciling provider task', {
      modelName,
      taskId: item.providerTaskId,
      phase,
    });
  }

  try {
    const payload = await aionGenerationClient.getTask(
      item.providerTaskId,
      modelName,
      item.providerEndpointType,
    );
    const polledAt = Date.now();
    await handleProviderPayload(item, payload, {
      polledAt,
      nonTerminalPhase: phase === 'normal'
        ? 'normal'
        : phase === 'expired' ? 'expired' : 'reconciling',
      reconciliationStartedAt,
      reconciliationDeadlineAt,
      consecutivePollFailures: 0,
    });
  } catch (error) {
    const consecutivePollFailures = item.consecutivePollFailures + 1;
    if (phase === 'expired') {
      await updateGenerationItem(item.id, {
        status: 'submission_unknown',
        error: {
          code: 'RECONCILIATION_EXPIRED',
          message: 'The final Aion reconciliation query failed after the two-hour window. Automatic retry is disabled.',
        },
        consecutivePollFailures,
        finishedAt: Date.now(),
        nextPollAt: null,
      });
      return;
    }

    if (phase === 'start_reconciling' || phase === 'reconciling') {
      await updateGenerationItem(item.id, {
        status: 'reconciling',
        error: {
          code: 'AION_RECONCILIATION_POLL_RETRY',
          message: error instanceof Error ? error.message : String(error),
        },
        reconciliationStartedAt,
        reconciliationDeadlineAt,
        consecutivePollFailures,
        nextPollAt: reconciliationNextPollAt(consecutivePollFailures),
      });
      return;
    }

    await updateGenerationItem(item.id, {
      status: item.status === 'processing' ? 'processing' : 'submitted',
      error: {
        code: 'AION_POLL_RETRY',
        message: error instanceof Error ? error.message : String(error),
      },
      consecutivePollFailures,
      nextPollAt: nextPollAt(item.attempt + 1),
    });
  }
};

const resumeArchive = async (item: ClaimedGenerationItem) => {
  const originalResultUrl = String(item.result.originalResultUrl || item.result.resultUrl || '');
  if (!originalResultUrl) {
    await updateGenerationItem(item.id, {
      status: 'failed',
      error: { code: 'ARCHIVE_SOURCE_MISSING', message: 'The provider result URL is missing.' },
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    return;
  }
  try {
    await archiveResult(item, {
      originalResultUrl,
      resultUrl: String(item.result.resultUrl || originalResultUrl),
      durability: item.result.durability === 'vidmuse_asset' ? 'vidmuse_asset' : 'temporary',
      previewUrl: item.result.previewUrl,
    }, item.job.model.outputModality);
  } catch (error) {
    await updateGenerationItem(item.id, {
      status: 'archiving',
      error: {
        code: 'ARCHIVE_RETRY',
        message: error instanceof Error ? error.message : String(error),
      },
      nextPollAt: nextPollAt(item.attempt + 1),
    });
  }
};

const processClaimedItem = async (item: ClaimedGenerationItem, owner: string) => {
  const leaseHeartbeat = setInterval(() => {
    void renewGenerationItemLease(item.id, owner).catch(error => {
      console.error('[generation-worker] lease renewal failed', {
        itemId: item.id,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, Math.max(1000, Math.floor(serverConfig.generationLeaseMs / 3)));
  leaseHeartbeat.unref();

  try {
    if (item.status === 'pending') await submitItem(item);
    else if (item.status === 'submitting') {
      await updateGenerationItem(item.id, {
        status: 'submission_unknown',
        error: {
          code: 'INTERRUPTED_SUBMISSION',
          message: 'The service restarted during submission; the Aion result is unknown and will not be resent automatically.',
        },
        finishedAt: Date.now(),
        nextPollAt: null,
      });
    } else if (item.status === 'submitted' || item.status === 'processing' || item.status === 'reconciling') await pollItem(item);
    else if (item.status === 'archiving') await resumeArchive(item);
  } finally {
    clearInterval(leaseHeartbeat);
    await releaseGenerationItemLease(item.id);
    const aggregate = await refreshGenerationJob(item.jobId);
    if (aggregate?.terminal) await writeGenerationBatchToDataset(item.jobId);
  }
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let stopRequested = false;
let workerPromise: Promise<void> | null = null;

const lane = async (modality: 'image' | 'video', laneIndex: number) => {
  const owner = `${process.pid}-${randomUUID()}-${modality}-${laneIndex}`;
  while (!stopRequested) {
    try {
      const item = await claimNextGenerationItem(modality, owner);
      if (item) await processClaimedItem(item, owner);
      else await sleep(1000);
    } catch (error) {
      console.error('[generation-worker] lane failed', {
        modality,
        laneIndex,
        message: error instanceof Error ? error.message : String(error),
      });
      await sleep(3000);
    }
  }
};

const writebackLane = async () => {
  while (!stopRequested) {
    try {
      const jobId = await findGenerationWritebackCandidate();
      if (jobId) await writeGenerationBatchToDataset(jobId);
      else await sleep(1000);
    } catch (error) {
      console.error('[generation-worker] writeback lane failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      await sleep(3000);
    }
  }
};

export const startGenerationWorker = () => {
  if (workerPromise || !serverConfig.generationWorkerEnabled) return workerPromise;
  if (!aionGenerationClient.isExecutionConfigured() || !generationAssetService.isExecutionReady()) {
    console.warn('[generation-worker] disabled because Aion or generation asset configuration is incomplete');
    return null;
  }
  stopRequested = false;
  const lanes = [
    ...Array.from({ length: serverConfig.generationImageConcurrency }, (_, index) => lane('image', index)),
    ...Array.from({ length: serverConfig.generationVideoConcurrency }, (_, index) => lane('video', index)),
    writebackLane(),
  ];
  workerPromise = Promise.all(lanes).then(() => undefined);
  console.log('[generation-worker] started', {
    imageConcurrency: serverConfig.generationImageConcurrency,
    videoConcurrency: serverConfig.generationVideoConcurrency,
    assetMode: generationAssetService.mode(),
    executionTransport: aionGenerationClient.executionTransport(),
  });
  return workerPromise;
};

export const stopGenerationWorker = async () => {
  stopRequested = true;
  await Promise.race([workerPromise || Promise.resolve(), sleep(5000)]);
  workerPromise = null;
};
