import { Router } from 'express';
import { getDataset } from '../datasets/datasetRepository.ts';
import { serverConfig } from '../config.ts';
import { ApiError, badRequest } from '../http/errors.ts';
import { aionGenerationClient } from './aionGenerationClient.ts';
import { generationAssetService } from './generationAssetService.ts';
import {
  getGenerationBatch,
  refreshGenerationJob,
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

const assertLegacyJobMutable = async (jobId: string) => {
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
  });
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
    const batch = await getGenerationBatch(req.params.batchId);
    if (!batch) throw notFound('Generation batch');
    res.json({ batch });
  } catch (error) {
    sendError(res, error, 'Failed to load generation batch');
  }
});

generationRoutes.post('/batches/:batchId/cancel', async (req, res) => {
  try {
    const batch = await getGenerationBatch(req.params.batchId);
    if (!batch) throw notFound('Generation batch');
    if (batch.createdBy !== req.user.id) throw new ApiError(403, 'FORBIDDEN', 'Only the batch creator can cancel it.');
    const cancelled = await requestGenerationCancellation(req.params.batchId);
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
    const batch = await getGenerationBatch(req.params.batchId);
    if (!batch) throw notFound('Generation batch');
    if (batch.createdBy !== req.user.id) throw new ApiError(403, 'FORBIDDEN', 'Only the batch creator can retry it.');
    const retryable = batch.items.filter(item => ['failed', 'submission_unknown', 'cancelled'].includes(item.status));
    const ambiguous = retryable.filter(item => item.status === 'submission_unknown');
    if (ambiguous.length && req.body?.forceSubmissionUnknown !== true) {
      throw badRequest('submission_unknown cases require an explicit duplicate-billing acknowledgement.', {
        caseIds: ambiguous.map(item => item.caseId),
      });
    }
    if (!retryable.length) throw badRequest('The batch has no retryable cases.');
    const currentDataset = await getDataset(batch.datasetId);
    if (!currentDataset) throw notFound('Dataset');
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
      durationSource: batch.controls.durationSource,
      retryOfJobId: batch.id,
      seedMode: batch.controls.seedMode,
      fixedSeed: batch.controls.fixedSeed,
      seedColumn: batch.controls.seedColumn,
      selectedDatasetItemIds: retryable.map(item => item.datasetItemId),
      assetBindings: batch.controls.assetBindings || [],
    }, req.user);
    res.status(201).json({ preflight });
  } catch (error) {
    sendError(res, error, 'Failed to preflight generation retry');
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
    res.json({ jobs: await listGenerationJobs({ datasetId }) });
  } catch (error) {
    sendError(res, error, 'Failed to list generation jobs');
  }
});

generationRoutes.put('/jobs/:jobId', async (req, res) => {
  try {
    await assertLegacyJobMutable(req.params.jobId);
    const payload = requireBodyObject(req.body, 'job');
    validateGenerationJobPayload(payload);
    const job = await saveGenerationJob({ ...payload, id: req.params.jobId } as any);
    res.json({ job });
  } catch (error) {
    sendError(res, error, 'Failed to save generation job');
  }
});

generationRoutes.get('/jobs/:jobId/items', async (req, res) => {
  try {
    res.json({ items: await listGenerationJobItems(req.params.jobId) });
  } catch (error) {
    sendError(res, error, 'Failed to list generation job items');
  }
});

generationRoutes.put('/jobs/:jobId/items/:itemId', async (req, res) => {
  try {
    await assertLegacyJobMutable(req.params.jobId);
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
    await assertLegacyJobMutable(req.params.jobId);
    const deleted = await deleteGenerationJob(req.params.jobId);
    if (!deleted) {
      throw notFound('Generation job');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete generation job');
  }
});
