import { Router } from 'express';

import { deleteDataset, getDataset, listDatasets, saveDataset } from './datasetRepository.ts';
import { notFound, sendError } from '../http/errors.ts';
import { requireBodyObject, validateDatasetPayload } from '../http/validation.ts';

export const datasetRoutes = Router();

datasetRoutes.get('/', async (_req, res) => {
  try {
    res.json({ datasets: await listDatasets() });
  } catch (error) {
    sendError(res, error, 'Failed to list datasets');
  }
});

datasetRoutes.get('/:datasetId', async (req, res) => {
  try {
    const dataset = await getDataset(req.params.datasetId);
    if (!dataset) {
      throw notFound('Dataset');
    }
    res.json({ dataset });
  } catch (error) {
    sendError(res, error, 'Failed to load dataset');
  }
});

datasetRoutes.post('/', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'dataset');
    validateDatasetPayload(payload);
    const dataset = await saveDataset(payload as any);
    res.status(201).json({ dataset });
  } catch (error) {
    sendError(res, error, 'Failed to save dataset');
  }
});

datasetRoutes.put('/:datasetId', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'dataset');
    validateDatasetPayload(payload);
    const dataset = await saveDataset({ ...payload, id: req.params.datasetId } as any);
    res.json({ dataset });
  } catch (error) {
    sendError(res, error, 'Failed to save dataset');
  }
});

datasetRoutes.delete('/:datasetId', async (req, res) => {
  try {
    const deleted = await deleteDataset(req.params.datasetId);
    if (!deleted) {
      throw notFound('Dataset');
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to delete dataset');
  }
});
