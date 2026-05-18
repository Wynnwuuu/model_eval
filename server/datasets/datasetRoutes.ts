import { Router } from 'express';

import { deleteDataset, getDataset, listDatasets, saveDataset } from './datasetRepository.ts';

export const datasetRoutes = Router();

datasetRoutes.get('/', async (_req, res) => {
  try {
    res.json({ datasets: await listDatasets() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list datasets';
    res.status(500).json({ error: message });
  }
});

datasetRoutes.get('/:datasetId', async (req, res) => {
  try {
    const dataset = await getDataset(req.params.datasetId);
    if (!dataset) {
      res.status(404).json({ error: 'Dataset not found' });
      return;
    }
    res.json({ dataset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load dataset';
    res.status(500).json({ error: message });
  }
});

datasetRoutes.post('/', async (req, res) => {
  try {
    const dataset = await saveDataset(req.body.dataset);
    res.status(201).json({ dataset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save dataset';
    res.status(500).json({ error: message });
  }
});

datasetRoutes.put('/:datasetId', async (req, res) => {
  try {
    const dataset = await saveDataset({ ...req.body.dataset, id: req.params.datasetId });
    res.json({ dataset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save dataset';
    res.status(500).json({ error: message });
  }
});

datasetRoutes.delete('/:datasetId', async (req, res) => {
  try {
    const deleted = await deleteDataset(req.params.datasetId);
    if (!deleted) {
      res.status(404).json({ error: 'Dataset not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete dataset';
    res.status(500).json({ error: message });
  }
});
