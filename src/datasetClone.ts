import {
  ensureStableDatasetItemIds,
  stripDatasetInternalFields,
} from './datasetSync.ts';
import type { EvalDataset } from './types.ts';

export interface BuildDatasetCloneOptions {
  id: string;
  name: string;
  actorId: string;
  actorName: string;
  now?: number;
}

const cloneValue = <T>(value: T): T => structuredClone(value);

export const buildDatasetClone = (
  source: EvalDataset,
  options: BuildDatasetCloneOptions
): EvalDataset => {
  const now = options.now ?? Date.now();
  const sourceVersion = source.version || 1;
  const changeSummary = `复制自「${source.name}」v${sourceVersion}`;
  const items = ensureStableDatasetItemIds(
    options.id,
    cloneValue(source.items || []).map(stripDatasetInternalFields)
  );
  const datasetCard = source.datasetCard
    ? {
      ...cloneValue(source.datasetCard),
      sampleSize: items.length,
      latestChange: changeSummary,
      updatedAt: now,
    }
    : undefined;

  return {
    id: options.id,
    name: options.name.trim(),
    description: source.description,
    tags: cloneValue(source.tags || []),
    inputSchema: cloneValue(source.inputSchema || []),
    items,
    inputType: source.inputType,
    modality: source.modality,
    categoryPath: cloneValue(source.categoryPath || []),
    standardFields: source.standardFields ? cloneValue(source.standardFields) : undefined,
    columnMappings: source.columnMappings ? cloneValue(source.columnMappings) : undefined,
    datasetCard,
    validationSummary: source.validationSummary ? cloneValue(source.validationSummary) : undefined,
    copiedFrom: {
      datasetId: source.id,
      datasetName: source.name,
      datasetVersion: sourceVersion,
      copiedAt: now,
    },
    version: 1,
    versionHistory: [{
      version: 1,
      changedAt: now,
      changedBy: options.actorName,
      changeSummary,
      itemCountBefore: 0,
      itemCountAfter: items.length,
    }],
    creatorUid: options.actorId,
    creatorName: options.actorName,
    createdAt: now,
    updatedAt: now,
  };
};
