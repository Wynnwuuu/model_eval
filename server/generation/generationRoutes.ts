import { Router } from 'express';

import {
  deleteGenerationJob,
  listGenerationJobItems,
  listGenerationJobs,
  saveGenerationJob,
  saveGenerationJobItem,
} from './generationRepository.ts';
import { notFound, sendError } from '../http/errors.ts';
import { requireBodyObject, validateGenerationJobItemPayload, validateGenerationJobPayload } from '../http/validation.ts';

export const generationRoutes = Router();

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
    const deleted = await deleteGenerationJob(req.params.jobId);
    if (!deleted) {
      throw notFound('Generation job');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete generation job');
  }
});
