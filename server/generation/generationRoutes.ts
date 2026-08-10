import { Router } from 'express';
import { getDataset } from '../datasets/datasetRepository.ts';
import { serverConfig } from '../config.ts';
import { ApiError, badRequest } from '../http/errors.ts';
import { aionGenerationClient } from './aionGenerationClient.ts';
import { generationOptionsSupportSeed } from './generationPlanning.ts';
import { generationAssetService } from './generationAssetService.ts';
import {
  getGenerationBatch,
  refreshGenerationJob,
  getGenerationQueueState,
  isGenerationBatchInOrganization,
  isGenerationDatasetInOrganization,
  listGenerationJobEvents,
  skipGenerationItems,
  requestGenerationCancellation,
} from './generationExecutionRepository.ts';
import {
  confirmGenerationPreflight,
  createGenerationPreflight,
} from './generationPreflightService.ts';

import { writeGenerationBatchToDataset } from './generationWritebackService.ts';
import {
  deleteGenerationJob,
  isExecutionManagedGenerationJob,
  listGenerationJobItems,
  listGenerationJobs,
  saveGenerationJob,
  saveGenerationJobItem,
} from './generationRepository.ts';
import { notFound, sendError } from '../http/errors.ts';
import { requireBodyObject, validateGenerationJobItemPayload, validateGenerationJobPayload } from '../http/validation.ts';

export const generationRoutes = Router();

const assertLegacyJobMutable = async (jobId: string, organizationId: string) => {
  const existing = await getGenerationBatch(jobId);
  if (existing && !await isGenerationBatchInOrganization(jobId, organizationId)) {
    throw notFound('Generation job');
  }
  if (await isExecutionManagedGenerationJob(jobId)) {
    throw new ApiError(409, 'EXECUTION_MANAGED_JOB', 'This batch is managed by the generation worker.');
  }
};

generationRoutes.get('/health', async (_req, res) => {
  const aionConfigured = aionGenerationClient.isExecutionConfigured();
  const ossConfigured = generationAssetService.isConfigured();
  const assetMode = generationAssetService.mode();
  const configured = aionConfigured && generationAssetService.isExecutionReady();
  res.json({
    configured,
    aionConfigured,
    ossConfigured,
    assetMode,
    executionTransport: aionGenerationClient.executionTransport(),
    durableAssets: assetMode === 'oss' && ossConfigured,
    localUploadsEnabled: assetMode === 'oss' && ossConfigured,
    workerEnabled: serverConfig.generationWorkerEnabled && configured,
    maxBatchSize: serverConfig.generationMaxBatchSize,
    imageConcurrency: serverConfig.generationImageConcurrency,
    videoConcurrency: serverConfig.generationVideoConcurrency,
    videoAdaptiveEnabled: serverConfig.generationVideoAdaptiveEnabled,
    videoHardLimit: serverConfig.generationVideoAdaptivePolicy.hardLimit,
    videoInitialGlobalLimit: serverConfig.generationVideoAdaptivePolicy.initialGlobalLimit,
    videoSubmitWorkers: serverConfig.generationVideoAdaptivePolicy.submitWorkers,
    videoPollWorkers: serverConfig.generationVideoAdaptivePolicy.pollWorkers,
    taskTimeoutMs: serverConfig.generationTaskTimeoutMs,
  });
});


generationRoutes.get('/queue', async (req, res) => {
  try {
    res.json({ queue: await getGenerationQueueState(req.user.organizationId) });
  } catch (error) {
    sendError(res, error, 'Failed to load generation queue');
  }
});
generationRoutes.get('/models', async (_req, res) => {
  try {
    const models = await aionGenerationClient.listModels();
    res.json({ models });
  } catch (error) {
    sendError(res, new ApiError(503, 'MODEL_CONFIG_UNAVAILABLE', error instanceof Error ? error.message : String(error)));
  }
});

generationRoutes.post('/preflights', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'preflight');
    const preflight = await createGenerationPreflight(payload as any, req.user);
    res.status(201).json({ preflight });
  } catch (error) {
    sendError(res, error, 'Failed to create generation preflight');
  }
});

generationRoutes.post('/batches', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'batch');
    if (typeof payload.preflightId !== 'string' || !payload.preflightId) {
      throw badRequest('preflightId is required.');
    }
    const batch = await confirmGenerationPreflight(payload.preflightId, req.user);
    res.status(batch.reused ? 200 : 201).json({ batchId: batch.id, reused: batch.reused });
  } catch (error) {
    sendError(res, error, 'Failed to create generation batch');
  }
});

generationRoutes.get('/batches/:batchId', async (req, res) => {
  try {
    const batch = await getGenerationBatch(req.params.batchId, req.user.organizationId);
    if (!batch) throw notFound('Generation batch');
    res.json({ batch });
  } catch (error) {
    sendError(res, error, 'Failed to load generation batch');
  }
});

generationRoutes.post('/batches/:batchId/cancel', async (req, res) => {
  try {
    const batch = await getGenerationBatch(req.params.batchId, req.user.organizationId);
    if (!batch) throw notFound('Generation batch');
    const cancelled = await requestGenerationCancellation(req.params.batchId, req.user);
    if (!cancelled) throw notFound('Generation batch');
    const aggregate = await refreshGenerationJob(req.params.batchId);
    if (aggregate?.terminal) await writeGenerationBatchToDataset(req.params.batchId);
    res.status(202).json({ accepted: true });
  } catch (error) {
    sendError(res, error, 'Failed to cancel generation batch');
  }
});

generationRoutes.post('/batches/:batchId/retry', async (req, res) => {
  try {
    const batch = await getGenerationBatch(req.params.batchId, req.user.organizationId);
    if (!batch) throw notFound('Generation batch');
    const itemIds = Array.isArray(req.body?.itemIds)
      ? [...new Set(req.body.itemIds.filter((id: unknown) => typeof id === 'string' && id))]
      : [];
    if (!itemIds.length) throw badRequest('Select at least one case to retry.');
    const selected = itemIds
      .map((itemId: string) => batch.items.find(item => item.id === itemId))
      .filter(Boolean);
    if (selected.length !== itemIds.length) {
      throw badRequest('One or more selected cases do not belong to this batch.');
    }
    const retryable = selected.filter(item =>
      item
      && ['failed', 'submission_unknown', 'cancelled'].includes(item.status)
      && item.resolutionStatus !== 'retrying');
    if (retryable.length !== selected.length) {
      throw badRequest('One or more selected cases are not currently retryable.');
    }
    const duplicateRisk = retryable.filter(item =>
      item!.status === 'submission_unknown' || item!.error?.code === 'GENERATION_TIMEOUT');
    const duplicateRiskAcknowledged = req.body?.forceDuplicateBillingRisk === true
      || req.body?.forceSubmissionUnknown === true;
    if (duplicateRisk.length && !duplicateRiskAcknowledged) {
      throw badRequest('These cases may already have been charged. Confirm the duplicate-billing risk to retry.', {
        caseIds: duplicateRisk.map(item => item!.caseId),
      });
    }
    const currentDataset = await getDataset(batch.datasetId);
    if (!currentDataset) throw notFound('Dataset');
    const stableDatasetItemIds = retryable.map(item => item!.datasetItemId).filter(Boolean) as string[];
    if (stableDatasetItemIds.length !== retryable.length) {
      throw badRequest('One or more selected cases no longer have a stable dataset item ID.');
    }
    const legacySeedSupported = batch.modelConfig.supportsSeed
      ?? generationOptionsSupportSeed(batch.modelConfig.options);
    const retrySeedMode = batch.controls.seedPolicyVersion === 2
      ? batch.controls.seedMode || 'unused'
      : legacySeedSupported
        ? batch.controls.seedMode || 'derive_from_case'
        : 'unused';
    const preflight = await createGenerationPreflight({
      datasetId: batch.datasetId,
      datasetVersion: currentDataset.version || 1,
      datasetName: currentDataset.name,
      modelName: batch.modelConfig.modelName,
      targetColumn: batch.targetColumn,
      targetMode: batch.controls.targetMode || 'new',
      inputMapping: batch.inputMapping,
      defaultControls: batch.controls.defaultControls || {},
      perCaseControlColumns: batch.controls.perCaseControlColumns || {},
      parameterBindings: batch.controls.parameterBindings,
      caseReviews: batch.controls.caseReviews,
      durationSource: batch.controls.durationSource,
      retryOfJobId: batch.id,
      retrySourceItemIds: Object.fromEntries(
        retryable.map(item => [item!.datasetItemId, item!.id]),
      ),
      retryDuplicateBillingRiskConfirmed: duplicateRiskAcknowledged,
      seedMode: retrySeedMode,
      seedPolicyVersion: batch.controls.seedPolicyVersion === 2 || !legacySeedSupported
        ? 2
        : undefined,
      fixedSeed: batch.controls.fixedSeed,
      seedColumn: batch.controls.seedColumn,
      selectedDatasetItemIds: stableDatasetItemIds,
      assetBindings: batch.controls.assetBindings || [],
    }, req.user);
    res.status(201).json({ preflight });
  } catch (error) {
    sendError(res, error, 'Failed to preflight generation retry');
  }
});

generationRoutes.post('/batches/:batchId/items/skip', async (req, res) => {
  try {
    const batch = await getGenerationBatch(req.params.batchId, req.user.organizationId);
    if (!batch) throw notFound('Generation batch');
    const itemIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.filter((id: unknown) => typeof id === 'string' && id)
      : [];
    await skipGenerationItems(req.params.batchId, itemIds, req.user);
    const aggregate = await refreshGenerationJob(req.params.batchId);
    if (aggregate?.terminal) await writeGenerationBatchToDataset(req.params.batchId);
    res.json({
      accepted: true,
      batch: await getGenerationBatch(req.params.batchId, req.user.organizationId),
    });
  } catch (error) {
    sendError(res, error, 'Failed to skip generation cases');
  }
});

generationRoutes.get('/batches/:batchId/events', async (req, res) => {
  try {
    if (!await isGenerationBatchInOrganization(req.params.batchId, req.user.organizationId)) {
      throw notFound('Generation batch');
    }
    res.json({
      events: await listGenerationJobEvents(req.params.batchId, req.user.organizationId),
    });
  } catch (error) {
    sendError(res, error, 'Failed to load generation batch events');
  }
});

generationRoutes.post('/assets/initiate', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'asset');
    const upload = await generationAssetService.createUpload({
      datasetId: typeof payload.datasetId === 'string' ? payload.datasetId : undefined,
      fileName: String(payload.fileName || ''),
      relativePath: typeof payload.relativePath === 'string' ? payload.relativePath : undefined,
      contentType: typeof payload.contentType === 'string' ? payload.contentType : undefined,
      sizeBytes: Number(payload.sizeBytes),
    }, req.user);
    res.status(201).json({ upload });
  } catch (error) {
    sendError(res, error, 'Failed to initiate asset upload');
  }
});

generationRoutes.post('/assets/:assetId/complete', async (req, res) => {
  try {
    const asset = await generationAssetService.completeUpload(req.params.assetId, {
      uploadId: typeof req.body?.uploadId === 'string' ? req.body.uploadId : undefined,
      parts: Array.isArray(req.body?.parts) ? req.body.parts : undefined,
    }, req.user);
    res.json({ asset });
  } catch (error) {
    sendError(res, error, 'Failed to complete asset upload');
  }
});


generationRoutes.get('/jobs', async (req, res) => {
  try {
    const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const model = typeof req.query.model === 'string' ? req.query.model : undefined;
    const createdBy = typeof req.query.createdBy === 'string' ? req.query.createdBy : undefined;
    const page = typeof req.query.page === 'string' ? Number(req.query.page) : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    res.json(await listGenerationJobs({
      organizationId: req.user.organizationId,
      datasetId,
      status,
      model,
      createdBy,
      page,
      limit,
    }));
  } catch (error) {
    sendError(res, error, 'Failed to list generation jobs');
  }
});

generationRoutes.put('/jobs/:jobId', async (req, res) => {
  try {
    await assertLegacyJobMutable(req.params.jobId, req.user.organizationId);
    const payload = requireBodyObject(req.body, 'job');
    validateGenerationJobPayload(payload);
    if (!await isGenerationDatasetInOrganization(String(payload.datasetId || ''), req.user.organizationId)) {
      throw new ApiError(403, 'FORBIDDEN', 'This dataset is outside your organization.');
    }
    const job = await saveGenerationJob({ ...payload, id: req.params.jobId } as any);
    res.json({ job });
  } catch (error) {
    sendError(res, error, 'Failed to save generation job');
  }
});

generationRoutes.get('/jobs/:jobId/items', async (req, res) => {
  try {
    if (!await isGenerationBatchInOrganization(req.params.jobId, req.user.organizationId)) {
      throw notFound('Generation job');
    }
    res.json({ items: await listGenerationJobItems(req.params.jobId, req.user.organizationId) });
  } catch (error) {
    sendError(res, error, 'Failed to list generation job items');
  }
});

generationRoutes.put('/jobs/:jobId/items/:itemId', async (req, res) => {
  try {
    await assertLegacyJobMutable(req.params.jobId, req.user.organizationId);
    const payload = requireBodyObject(req.body, 'item');
    validateGenerationJobItemPayload(payload);
    const item = await saveGenerationJobItem({ ...payload, id: req.params.itemId, jobId: req.params.jobId } as any);
    res.json({ item });
  } catch (error) {
    sendError(res, error, 'Failed to save generation job item');
  }
});

generationRoutes.delete('/jobs/:jobId', async (req, res) => {
  try {
    await assertLegacyJobMutable(req.params.jobId, req.user.organizationId);
    const deleted = await deleteGenerationJob(req.params.jobId);
    if (!deleted) {
      throw notFound('Generation job');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete generation job');
  }
});
