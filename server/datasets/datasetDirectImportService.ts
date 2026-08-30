import { randomUUID } from 'node:crypto';

import {
  buildDatasetDirectImportPreview,
  compileDirectImportDataset,
  type DatasetDirectImportMetadata,
  type DatasetDirectImportPreview,
} from '../../src/datasetDirectImport.ts';
import type { RequestUser } from '../auth/context.ts';
import { ApiError, badRequest } from '../http/errors.ts';
import { saveDataset } from './datasetRepository.ts';
import {
  loadDatasetSourceSnapshot,
  type DatasetSourceRequest,
} from './datasetSourceSnapshot.ts';

const normalizeImportMetadata = (value: unknown): DatasetDirectImportMetadata => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('metadata must be an object');
  const metadata = value as Partial<DatasetDirectImportMetadata>;
  const datasetCard = metadata.datasetCard;
  if (typeof metadata.name !== 'string' || !metadata.name.trim()) throw badRequest('评测集名称不能为空。');
  if (typeof metadata.description !== 'string') throw badRequest('评测集描述必须是字符串。');
  if (!Array.isArray(metadata.tags) || metadata.tags.some(tag => typeof tag !== 'string')) throw badRequest('标签必须是字符串数组。');
  if (!['image', 'video', 'audio', 'text', 'multimodal', 'other'].includes(metadata.modality || '')) {
    throw badRequest('评测集模态无效。');
  }
  if (!Array.isArray(metadata.categoryPath) || metadata.categoryPath.some(item => typeof item !== 'string')) {
    throw badRequest('分类路径必须是字符串数组。');
  }
  if (!datasetCard || typeof datasetCard !== 'object' || Array.isArray(datasetCard)) {
    throw badRequest('datasetCard must be an object');
  }
  for (const key of ['applicableTasks', 'applicableStages', 'coverageGaps'] as const) {
    if (!Array.isArray(datasetCard[key]) || datasetCard[key].some(item => typeof item !== 'string')) {
      throw badRequest(`datasetCard.${key} must be a string array`);
    }
  }
  if (typeof datasetCard.source !== 'string' || typeof datasetCard.rubricBinding !== 'string') {
    throw badRequest('datasetCard source and rubricBinding must be strings');
  }
  return {
    name: metadata.name.trim(),
    description: metadata.description,
    tags: metadata.tags,
    modality: metadata.modality!,
    categoryPath: metadata.categoryPath,
    datasetCard: {
      applicableTasks: datasetCard.applicableTasks,
      applicableStages: datasetCard.applicableStages,
      source: datasetCard.source,
      rubricBinding: datasetCard.rubricBinding,
      coverageGaps: datasetCard.coverageGaps,
    },
  };
};

export const createDatasetDirectImportPreview = async (
  source: DatasetSourceRequest,
): Promise<DatasetDirectImportPreview> => {
  const snapshot = await loadDatasetSourceSnapshot(source);
  return buildDatasetDirectImportPreview({
    headers: snapshot.headers,
    rows: snapshot.rows,
    snapshotHash: snapshot.binding.snapshotHash,
  });
};

export const applyDatasetDirectImport = async (input: {
  source: DatasetSourceRequest;
  expectedSnapshotHash: string;
  outputColumns: string[];
  metadata: unknown;
}, user: RequestUser) => {
  if (typeof input.expectedSnapshotHash !== 'string' || !input.expectedSnapshotHash) {
    throw badRequest('expectedSnapshotHash is required');
  }
  if (!Array.isArray(input.outputColumns) || input.outputColumns.some(column => typeof column !== 'string')) {
    throw badRequest('outputColumns must be a string array');
  }
  const snapshot = await loadDatasetSourceSnapshot(input.source);
  if (snapshot.binding.snapshotHash !== input.expectedSnapshotHash) {
    throw new ApiError(
      409,
      'DATASET_IMPORT_SOURCE_CHANGED',
      '数据源已在预览后发生变化，请重新预览。',
      {
        expectedSnapshotHash: input.expectedSnapshotHash,
        currentSnapshotHash: snapshot.binding.snapshotHash,
      },
    );
  }
  const preview = buildDatasetDirectImportPreview({
    headers: snapshot.headers,
    rows: snapshot.rows,
    snapshotHash: snapshot.binding.snapshotHash,
  });
  if (!preview.valid) {
    throw new ApiError(422, 'DATASET_DIRECT_IMPORT_INVALID_SOURCE', '直接导入源校验失败。', preview.issues);
  }
  const metadata = normalizeImportMetadata(input.metadata);
  const id = `ds-${randomUUID()}`;
  const actorName = user.displayName || user.email || user.id;
  const dataset = compileDirectImportDataset({
    id,
    preview,
    outputColumns: input.outputColumns,
    metadata,
    actor: { id: user.id, name: actorName },
  });
  return saveDataset(dataset, user.id);
};

