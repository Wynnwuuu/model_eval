import { Router } from 'express';

import {
  cloneDataset,
  deleteDataset,
  getDataset,
  getDatasetVersion,
  listDatasets,
  rollbackDataset,
  saveDataset,
  updateDatasetItem,
  updateDatasetManifest,
} from './datasetRepository.ts';
import { updateDatasetItemsBatch } from './datasetBatchEditService.ts';
import { badRequest, notFound, sendError } from '../http/errors.ts';
import { requireBodyObject, requireNonEmptyString, validateDatasetPayload } from '../http/validation.ts';
import {
  applyDatasetSyncPreview,
  createDatasetSyncPreview,
  updateDatasetSyncPreview,
} from './datasetSyncService.ts';
import {
  applyDatasetDirectImport,
  createDatasetDirectImportPreview,
} from './datasetDirectImportService.ts';

export const datasetRoutes = Router();

datasetRoutes.post('/import-previews', async (req, res) => {
  try {
    if (!req.body?.source || typeof req.body.source !== 'object') throw badRequest('source is required');
    const preview = await createDatasetDirectImportPreview(req.body.source);
    res.status(201).json({ preview });
  } catch (error) {
    sendError(res, error, 'Failed to create dataset import preview');
  }
});

datasetRoutes.post('/imports', async (req, res) => {
  try {
    if (!req.body?.source || typeof req.body.source !== 'object') throw badRequest('source is required');
    const dataset = await applyDatasetDirectImport({
      source: req.body.source,
      expectedSnapshotHash: req.body.expectedSnapshotHash,
      outputColumns: req.body.outputColumns,
      metadata: req.body.metadata,
    }, req.user);
    res.status(201).json({ dataset, syncSummary: dataset.syncSummary });
  } catch (error) {
    sendError(res, error, 'Failed to import dataset');
  }
});

datasetRoutes.post('/:datasetId/sync-previews', async (req, res) => {
  try {
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion) || !req.body?.source || typeof req.body.source !== 'object') {
      throw badRequest('expectedVersion and source are required');
    }
    const preview = await createDatasetSyncPreview(
      req.params.datasetId,
      expectedVersion,
      req.body.source,
      req.user,
    );
    res.status(201).json({ preview });
  } catch (error) {
    sendError(res, error, 'Failed to create dataset sync preview');
  }
});

datasetRoutes.patch('/sync-previews/:previewId', async (req, res) => {
  try {
    const preview = await updateDatasetSyncPreview(req.params.previewId, {
      outputPolicies: req.body?.outputPolicies,
      newColumnRoles: req.body?.newColumnRoles,
    }, req.user);
    res.json({ preview });
  } catch (error) {
    sendError(res, error, 'Failed to update dataset sync preview');
  }
});

datasetRoutes.post('/sync-previews/:previewId/apply', async (req, res) => {
  try {
    const dataset = await applyDatasetSyncPreview(req.params.previewId, {
      confirmSourceOverwrite: req.body?.confirmSourceOverwrite === true,
    }, req.user);
    res.json({ dataset, syncSummary: dataset.syncSummary });
  } catch (error) {
    sendError(res, error, 'Failed to apply dataset sync preview');
  }
});

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

datasetRoutes.post('/:datasetId/clone', async (req, res) => {
  try {
    const sourceVersion = Number(req.body?.sourceVersion);
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
      throw badRequest('sourceVersion must be a positive integer');
    }
    const name = requireNonEmptyString(req.body?.name, 'name');
    const dataset = await cloneDataset(
      req.params.datasetId,
      sourceVersion,
      name,
      req.user
    );
    if (!dataset) {
      throw notFound('Dataset version');
    }
    res.status(201).json({ dataset });
  } catch (error) {
    sendError(res, error, 'Failed to clone dataset');
  }
});


datasetRoutes.post('/:datasetId/rollback', async (req, res) => {
  try {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      throw notFound('Dataset version');
    }
    const changeSummary = typeof req.body?.changeSummary === 'string' ? req.body.changeSummary : undefined;
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion)) {
      throw badRequest('expectedVersion is required');
    }
    const dataset = await rollbackDataset(
      req.params.datasetId,
      version,
      req.user,
      changeSummary,
      expectedVersion
    );
    if (!dataset) {
      throw notFound('Dataset version');
    }
    res.json({ dataset, syncSummary: dataset.syncSummary });
  } catch (error) {
    sendError(res, error, 'Failed to rollback dataset');
  }
});

datasetRoutes.patch('/:datasetId/items/batch', async (req, res) => {
  try {
    const expectedVersion = Number(req.body?.expectedVersion);
    const edits = req.body?.edits;
    const appendedRows = req.body?.appendedRows;
    if (!Number.isInteger(expectedVersion) || !Array.isArray(edits) || !Array.isArray(appendedRows)) {
      throw badRequest('expectedVersion, edits and appendedRows are required');
    }
    const result = await updateDatasetItemsBatch(req.params.datasetId, {
      expectedVersion,
      edits,
      appendedRows,
      acceptWarnings: req.body?.acceptWarnings === true,
    }, req.user);
    if (!result) throw notFound('Dataset');
    res.json({
      dataset: result.dataset,
      syncSummary: result.dataset.syncSummary,
      warnings: result.warnings,
      summary: {
        changedCellCount: result.outcome.changedCellCount,
        appendedRowCount: result.outcome.appendedRowCount,
      },
    });
  } catch (error) {
    sendError(res, error, 'Failed to batch update dataset items');
  }
});

datasetRoutes.patch('/:datasetId/items/:stableItemId', async (req, res) => {
  try {
    const fieldKey = typeof req.body?.fieldKey === 'string' ? req.body.fieldKey : '';
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!fieldKey || fieldKey === '_originalData' || fieldKey.startsWith('__') || !Number.isInteger(expectedVersion)) {
      throw badRequest('fieldKey and expectedVersion are required');
    }
    const dataset = await updateDatasetItem(
      req.params.datasetId,
      req.params.stableItemId,
      fieldKey,
      req.body?.value,
      expectedVersion,
      req.user
    );
    if (!dataset) throw notFound('Dataset item');
    res.json({ dataset, syncSummary: dataset.syncSummary });
  } catch (error) {
    sendError(res, error, 'Failed to update dataset item');
  }
});

datasetRoutes.patch('/:datasetId/manifest', async (req, res) => {
  try {
    const patch = requireBodyObject(req.body, 'patch');
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isInteger(expectedVersion)) {
      throw badRequest('expectedVersion is required');
    }
    const isStringArray = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
    if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) throw badRequest('name must be a non-empty string');
    if (patch.description !== undefined && typeof patch.description !== 'string') throw badRequest('description must be a string');
    if (patch.tags !== undefined && !isStringArray(patch.tags)) throw badRequest('tags must be a string array');
    if (patch.categoryPath !== undefined && !isStringArray(patch.categoryPath)) throw badRequest('categoryPath must be a string array');
    if (patch.modality !== undefined && !['image', 'video', 'audio', 'text', 'multimodal', 'other'].includes(patch.modality)) {
      throw badRequest('modality is invalid');
    }
    if (patch.datasetCard !== undefined) {
      if (!patch.datasetCard || typeof patch.datasetCard !== 'object' || Array.isArray(patch.datasetCard)) throw badRequest('datasetCard must be an object');
      if (patch.datasetCard.source !== undefined && typeof patch.datasetCard.source !== 'string') throw badRequest('datasetCard.source must be a string');
      if (patch.datasetCard.rubricBinding !== undefined && typeof patch.datasetCard.rubricBinding !== 'string') throw badRequest('datasetCard.rubricBinding must be a string');
      for (const key of ['applicableTasks', 'applicableStages', 'coverageGaps']) {
        if (patch.datasetCard[key] !== undefined && !isStringArray(patch.datasetCard[key])) throw badRequest(`datasetCard.${key} must be a string array`);
      }
    }
    const dataset = await updateDatasetManifest(
      req.params.datasetId,
      patch,
      expectedVersion,
      req.user
    );
    if (!dataset) throw notFound('Dataset');
    res.json({ dataset, syncSummary: dataset.syncSummary });
  } catch (error) {
    sendError(res, error, 'Failed to update dataset manifest');
  }
});

datasetRoutes.post('/', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'dataset');
    validateDatasetPayload(payload);
    const dataset = await saveDataset(payload as any, req.user.id);
    res.status(201).json({ dataset, syncSummary: dataset.syncSummary });
  } catch (error) {
    sendError(res, error, 'Failed to save dataset');
  }
});

datasetRoutes.put('/:datasetId', async (req, res) => {
  try {
    const payload = requireBodyObject(req.body, 'dataset');
    validateDatasetPayload(payload);
    const expectedVersion = Number(req.body?.expectedVersion);
    const dataset = await saveDataset(
      { ...payload, id: req.params.datasetId } as any,
      req.user.id,
      {
        expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : undefined,
        forcePropagation: req.body?.forcePropagation === true,
        deferPropagation: req.body?.deferPropagation === true,
      }
    );
    res.json({ dataset, syncSummary: dataset.syncSummary });
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
