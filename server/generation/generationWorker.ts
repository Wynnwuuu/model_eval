import { randomUUID } from 'node:crypto';

import { serverConfig } from '../config.ts';
import { aionGenerationClient } from './aionGenerationClient.ts';
import { generationAssetService } from './generationAssetService.ts';
import {
  buildAionGenerationRequest,
  type GenerationCase,
  type NormalizedGenerationModel,
} from './generationPlanning.ts';
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

export const providerResult = (rawPayload: Record<string, any>) => {
  const payload = normalizeProviderPayload(rawPayload);
  const media = Array.isArray(payload.images) && payload.images.length
    ? payload.images[0]
    : Array.isArray(payload.videos) && payload.videos.length
      ? payload.videos[0]
      : null;
  const directUrl = payload.result_url
    || payload.resultUrl
    || payload.video_url
    || payload.videoUrl
    || payload.image_url
    || payload.imageUrl
    || payload.url;
  const url = media?.url || media?.file_url || directUrl;
  return url
    ? {
      originalResultUrl: String(url),
      previewUrl: media?.preview_url || media?.previewUrl
        ? String(media.preview_url || media.previewUrl)
        : undefined,
      media: media || { url },
    }
    : null;
};

export const temporaryGenerationResult = (
  existing: Record<string, any>,
  originalResultUrl: string,
  mediaType: 'image' | 'video',
) => ({
  ...existing,
  originalResultUrl,
  resultUrl: originalResultUrl,
  mediaType,
  durability: 'temporary',
});

const nextPollAt = (attempt: number) =>
  Date.now() + Math.min(30000, serverConfig.generationPollIntervalMs * Math.max(1, 2 ** Math.min(attempt, 3)));

const prepareInputs = async (item: ClaimedGenerationItem, generationCase: GenerationCase) => {
  const resolve = async (value: string) => {
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
  return {
    ...generationCase,
    imageUrls: await Promise.all(generationCase.imageUrls.map(value => resolve(value))),
    audioUrls: await Promise.all(generationCase.audioUrls.map(value => resolve(value))),
    extraInputs,
  };
};

const archiveResult = async (
  item: ClaimedGenerationItem,
  originalResultUrl: string,
  mediaType: 'image' | 'video',
) => {
  if (generationAssetService.usesTemporaryUrls()) {
    await updateGenerationItem(item.id, {
      status: 'succeeded',
      result: temporaryGenerationResult(item.result, originalResultUrl, mediaType),
      archivedAssetId: null,
      providerStatus: 'succeed',
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    return;
  }
  const archived = await generationAssetService.archiveRemote(originalResultUrl, {
    datasetId: item.job.datasetId,
    jobId: item.jobId,
    jobItemId: item.id,
    kind: 'output',
    fileName: `${item.request?.caseId || item.id}.${mediaType === 'image' ? 'png' : 'mp4'}`,
    createdBy: item.job.createdBy,
  });
  await updateGenerationItem(item.id, {
    status: 'succeeded',
    result: {
      ...item.result,
      originalResultUrl,
      resultUrl: archived.stableUrl,
      mediaType,
    },
    archivedAssetId: archived.id,
    providerStatus: 'succeed',
    finishedAt: Date.now(),
    nextPollAt: null,
  });
};

const handleProviderPayload = async (
  item: ClaimedGenerationItem,
  payload: Record<string, any>,
) => {
  payload = normalizeProviderPayload(payload);
  const providerStatus = String(payload.task_status || payload.status || '').toLowerCase();
  const result = providerResult(payload);
  const endpointType = payload.endpoint_type ? String(payload.endpoint_type) : item.providerEndpointType;
  const taskId = payload.task_id ? String(payload.task_id) : item.providerTaskId;

  if (result && (TERMINAL_PROVIDER_STATUSES.has(providerStatus) || !providerStatus)) {
    await updateGenerationItem(item.id, {
      status: 'archiving',
      providerTaskId: taskId,
      providerEndpointType: endpointType,
      providerStatus: providerStatus || 'succeed',
      result: { ...item.result, ...result },
      nextPollAt: Date.now(),
    });
    await archiveResult(
      { ...item, providerTaskId: taskId, providerEndpointType: endpointType, result: { ...item.result, ...result } },
      result.originalResultUrl,
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
    });
    return;
  }

  await updateGenerationItem(item.id, {
    status: providerStatus === 'processing' ? 'processing' : 'submitted',
    providerTaskId: taskId,
    providerEndpointType: endpointType,
    providerStatus: providerStatus || 'submitted',
    nextPollAt: nextPollAt(item.attempt),
  });
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
    const status = Number((error as any)?.status);
    const definitelyRejected = Number.isFinite(status) && status >= 400 && status < 500;
    await updateGenerationItem(item.id, {
      status: definitelyRejected ? 'failed' : 'submission_unknown',
      error: {
        code: definitelyRejected ? 'AION_SUBMIT_REJECTED' : 'AION_SUBMISSION_UNKNOWN',
        message: definitelyRejected
          ? (error instanceof Error ? error.message : String(error))
          : 'The Aion submission response was lost; automatic retry is disabled to prevent duplicate billing.',
        ...(status ? { httpStatus: status } : {}),
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
  if ((item.submissionStartedAt || item.startedAt || Date.now()) + serverConfig.generationTaskTimeoutMs < Date.now()) {
    await updateGenerationItem(item.id, {
      status: 'failed',
      error: { code: 'GENERATION_TIMEOUT', message: 'The generation task exceeded the configured timeout.' },
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    return;
  }

  try {
    const payload = await aionGenerationClient.getTask(
      item.providerTaskId,
      String(item.job.model.modelName),
      item.providerEndpointType,
    );
    await handleProviderPayload(item, payload);
  } catch (error) {
    await updateGenerationItem(item.id, {
      status: item.status === 'processing' ? 'processing' : 'submitted',
      error: {
        code: 'AION_POLL_RETRY',
        message: error instanceof Error ? error.message : String(error),
      },
      nextPollAt: nextPollAt(item.attempt + 1),
    });
  }
};

const resumeArchive = async (item: ClaimedGenerationItem) => {
  const originalResultUrl = String(item.result.originalResultUrl || '');
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
    await archiveResult(item, originalResultUrl, item.job.model.outputModality);
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
    } else if (item.status === 'submitted' || item.status === 'processing') await pollItem(item);
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
