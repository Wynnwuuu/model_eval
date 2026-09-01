import { getDatasetActiveColumnKeys, getDatasetColumnRole } from './datasetColumnDeletion.ts';
import { inferPreviewType } from './datasetManifest.ts';
import { findGenerationOutputCompanion } from './datasetOutputColumns.ts';
import type { DatasetFieldRole, DatasetPreviewType, EvalDataset } from './types.ts';

export type DatasetTableColumnDisplayCategory =
  | 'business'
  | 'output'
  | 'generation_companion'
  | 'system';

export interface DatasetTableColumnDescriptor {
  key: string;
  label: string;
  role: DatasetFieldRole;
  previewType: DatasetPreviewType;
  displayCategory: DatasetTableColumnDisplayCategory;
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
  const mappedOutputKeys = new Set(dataset.columnMappings?.outputColumns || []);
  const rolesByKey = new Map(orderedKeys.map(key => {
    const schemaRole = schemaByKey.get(key)?.role;
    const role = mappedOutputKeys.has(key) || schemaRole === 'output'
      ? 'output'
      : schemaRole || getDatasetColumnRole(dataset, key) || 'metadata';
    return [key, role] as const;
  }));
  const outputKeys = orderedKeys.filter(key => rolesByKey.get(key) === 'output');

  const columns = orderedKeys.map(key => {
    const field = schemaByKey.get(key);
    const role = rolesByKey.get(key) || 'metadata';
    const previewType = field?.previewType || inferPreviewType(key, sampleColumnValues(dataset, key));
    const lockedVisible = role === 'case_id';
    const displayCategory: DatasetTableColumnDisplayCategory = role === 'output'
      ? 'output'
      : findGenerationOutputCompanion(key, outputKeys)
        ? 'generation_companion'
        : role === 'system'
          ? 'system'
          : 'business';

    return {
      key,
      label: field?.label || key,
      role,
      previewType,
      displayCategory,
      defaultVisible: displayCategory === 'business' || displayCategory === 'output',
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

export const getTaskBuilderDatasetColumns = (dataset?: EvalDataset): string[] => (
  buildDatasetTableColumns(dataset)
    .filter(column => column.displayCategory === 'business' || column.displayCategory === 'output')
    .map(column => column.key)
);
