import { Router } from 'express';

import { deleteDataset, getDataset, getDatasetVersion, listDatasets, rollbackDataset, saveDataset } from './datasetRepository.ts';
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

datasetRoutes.get('/:datasetId/versions/:version', async (req, res) => {
  try {
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) {
      throw notFound('Dataset version');
    }
    const dataset = await getDatasetVersion(req.params.datasetId, version);
    if (!dataset) {
      throw notFound('Dataset version');
    }
    res.json({ dataset });
  } catch (error) {
    sendError(res, error, 'Failed to load dataset version');
  }
});

datasetRoutes.post('/:datasetId/rollback', async (req, res) => {
  try {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      throw notFound('Dataset version');
    }
    const changeSummary = typeof req.body?.changeSummary === 'string' ? req.body.changeSummary : undefined;
    const dataset = await rollbackDataset(req.params.datasetId, version, req.user, changeSummary);
    if (!dataset) {
      throw notFound('Dataset version');
    }
    res.json({ dataset });
  } catch (error) {
    sendError(res, error, 'Failed to rollback dataset');
  }
});

datasetRoutes.post('/', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'dataset');
    validateDatasetPayload(payload);
    const dataset = await saveDataset(payload as any, req.user.id);
    res.status(201).json({ dataset });
  } catch (error) {
    sendError(res, error, 'Failed to save dataset');
  }
});

datasetRoutes.put('/:datasetId', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'dataset');
    validateDatasetPayload(payload);
    const dataset = await saveDataset({ ...payload, id: req.params.datasetId } as any, req.user.id);
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
