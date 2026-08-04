import type {
  DatasetColumnMappings,
  DatasetFieldRole,
  DatasetSchemaField,
  EvalDataset,
  EvalTask,
} from './types';
import { DATASET_ITEM_ID_KEY } from './datasetSync';

export const RESERVED_DATASET_COLUMNS = new Set(['_originalData', DATASET_ITEM_ID_KEY]);

export interface DatasetColumnDeletionProjection {
  items: Record<string, any>[];
  inputSchema: DatasetSchemaField[];
  columnMappings: DatasetColumnMappings;
  removedSchemaFields: DatasetSchemaField[];
}

export const getDatasetActiveColumnKeys = (dataset?: EvalDataset) => {
  if (!dataset) return [];
  const schemaKeys = (dataset.inputSchema || []).map(field => field.key).filter(Boolean);
  const rowKeys = (dataset.items || []).flatMap(row => Object.keys(row));
  return Array.from(new Set([...schemaKeys, ...rowKeys])).filter(
    key => key && !RESERVED_DATASET_COLUMNS.has(key) && !key.startsWith('__')
  );
};

export const getDatasetColumnRole = (
  dataset: EvalDataset,
  column: string
): DatasetFieldRole | undefined => {
  const fieldRole = dataset.inputSchema?.find(field => field.key === column)?.role;
  if (fieldRole) return fieldRole;
  const mappings = dataset.columnMappings;
  if (mappings?.caseId === column) return 'case_id';
  if (mappings?.outputColumns?.includes(column)) return 'output';
  if (mappings?.dimensionColumns?.includes(column)) return 'dimension';
  if (mappings?.referenceColumns?.includes(column)) return 'reference';
  if (mappings?.inputColumns?.includes(column)) return 'input';
  return undefined;
};

export const getTaskColumnUsage = (task: EvalTask, column: string) => {
  const usage = new Set<'input' | 'output' | 'dimension' | 'reference'>();
  const binding = task.datasetBinding;
  if (binding?.inputColumns.includes(column)) usage.add('input');
  if (binding?.dimensionColumns.includes(column) || task.dimensionColumns?.includes(column)) usage.add('dimension');
  if (binding?.referenceColumns.includes(column)) usage.add('reference');
  if (binding && Object.values(binding.modelColumns).includes(column)) usage.add('output');
  if (!binding && task.models.some(model => model.name === column)) usage.add('output');
  return Array.from(usage);
};

export const removeDatasetColumn = (
  dataset: EvalDataset,
  column: string
): DatasetColumnDeletionProjection => {
  const normalizedColumn = column.trim();
  if (!normalizedColumn || RESERVED_DATASET_COLUMNS.has(normalizedColumn) || normalizedColumn.startsWith('__')) {
    throw new Error('This dataset column cannot be deleted.');
  }

  const mappings = dataset.columnMappings || {
    inputColumns: [],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
    standard: {},
  };
  const removeFromList = (values: string[] = []) => values.filter(value => value !== normalizedColumn);
  const standard = Object.fromEntries(
    Object.entries(mappings.standard || {}).filter(([, mappedColumn]) => mappedColumn !== normalizedColumn)
  );
  const removedSchemaFields = (dataset.inputSchema || []).filter(field => field.key === normalizedColumn);

  return {
    items: (dataset.items || []).map(row => {
      const next = { ...row };
      delete next[normalizedColumn];
      return next;
    }),
    inputSchema: (dataset.inputSchema || []).filter(field => field.key !== normalizedColumn),
    columnMappings: {
      ...mappings,
      caseId: mappings.caseId === normalizedColumn ? undefined : mappings.caseId,
      inputColumns: removeFromList(mappings.inputColumns),
      outputColumns: removeFromList(mappings.outputColumns),
      dimensionColumns: removeFromList(mappings.dimensionColumns),
      referenceColumns: removeFromList(mappings.referenceColumns),
      standard,
    },
    removedSchemaFields,
  };
};
