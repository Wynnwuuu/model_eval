import { Router } from 'express';

import {
  deleteGenerationJob,
  listGenerationJobItems,
  listGenerationJobs,
  saveGenerationJob,
  saveGenerationJobItem,
} from './generationRepository.ts';

export const generationRoutes = Router();

generationRoutes.get('/jobs', async (req, res) => {
  try {
    const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : undefined;
    res.json({ jobs: await listGenerationJobs({ datasetId }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list generation jobs';
    res.status(500).json({ error: message });
  }
});

generationRoutes.put('/jobs/:jobId', async (req, res) => {
  try {
    const job = await saveGenerationJob({ ...req.body.job, id: req.params.jobId });
    res.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save generation job';
    res.status(500).json({ error: message });
  }
});

generationRoutes.get('/jobs/:jobId/items', async (req, res) => {
  try {
    res.json({ items: await listGenerationJobItems(req.params.jobId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list generation job items';
    res.status(500).json({ error: message });
  }
});

generationRoutes.put('/jobs/:jobId/items/:itemId', async (req, res) => {
  try {
    const item = await saveGenerationJobItem({ ...req.body.item, id: req.params.itemId, jobId: req.params.jobId });
    res.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save generation job item';
    res.status(500).json({ error: message });
  }
});

generationRoutes.delete('/jobs/:jobId', async (req, res) => {
  try {
    const deleted = await deleteGenerationJob(req.params.jobId);
    if (!deleted) {
      res.status(404).json({ error: 'Generation job not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete generation job';
    res.status(500).json({ error: message });
  }
});
