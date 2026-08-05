import { getDatasetActiveColumnKeys, getDatasetColumnRole } from './datasetColumnDeletion';
import { inferPreviewType } from './datasetManifest';
import type { DatasetFieldRole, DatasetPreviewType, EvalDataset } from './types';

export interface DatasetTableColumnDescriptor {
  key: string;
  label: string;
  role: DatasetFieldRole;
  previewType: DatasetPreviewType;
  defaultVisible: boolean;
  lockedVisible: boolean;
}

export type DatasetColumnVisibilityOverrides = Record<string, boolean>;

const sampleColumnValues = (dataset: EvalDataset, key: string) =>
  (dataset.items || []).slice(0, 5).map(row => row[key]);

export const buildDatasetTableColumns = (dataset?: EvalDataset): DatasetTableColumnDescriptor[] => {
  if (!dataset) return [];

  const schemaByKey = new Map((dataset.inputSchema || []).map(field => [field.key, field]));
  const orderedKeys = Array.from(new Set([
    ...(dataset.inputSchema || []).map(field => field.key),
    ...getDatasetActiveColumnKeys(dataset),
  ].filter(Boolean)));

  const columns = orderedKeys.map(key => {
    const field = schemaByKey.get(key);
    const role = field?.role || getDatasetColumnRole(dataset, key) || 'metadata';
    const previewType = field?.previewType || inferPreviewType(key, sampleColumnValues(dataset, key));
    const lockedVisible = role === 'case_id';

    return {
      key,
      label: field?.label || key,
      role,
      previewType,
      defaultVisible: lockedVisible || role !== 'system',
      lockedVisible,
    };
  });

  return [
    ...columns.filter(column => column.lockedVisible),
    ...columns.filter(column => !column.lockedVisible),
  ];
};

export const isDatasetTableColumnVisible = (
  column: DatasetTableColumnDescriptor,
  overrides: DatasetColumnVisibilityOverrides = {}
) => {
  if (column.lockedVisible) return true;
  if (Object.prototype.hasOwnProperty.call(overrides, column.key)) return overrides[column.key];
  return column.defaultVisible;
};

export const getVisibleDatasetTableColumns = (
  columns: DatasetTableColumnDescriptor[],
  overrides: DatasetColumnVisibilityOverrides = {}
) => columns.filter(column => isDatasetTableColumnVisible(column, overrides));
