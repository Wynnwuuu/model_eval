import Papa from 'papaparse';

import { buildDatasetTableColumns } from './datasetTableColumns.ts';
import type { EvalDataset } from './types.ts';

const serializeCsvValue = (value: unknown): string | number | boolean => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const buildDatasetCsvProjection = (dataset: EvalDataset) => {
  const fields = buildDatasetTableColumns(dataset).map(column => column.key);
  const data = (dataset.items || []).map(row => fields.map(field => serializeCsvValue(row[field])));
  return { fields, data };
};

export const buildDatasetCsv = (dataset: EvalDataset) => {
  const projection = buildDatasetCsvProjection(dataset);
  return Papa.unparse(projection, {
    header: true,
    newline: '\r\n',
  });
};
