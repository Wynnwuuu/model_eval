import { getDatasetItemStableId } from './datasetSync';

export type DatasetColumnFilterMap = Record<string, string[]>;

export interface IndexedDatasetRow {
  row: Record<string, any>;
  sourceIndex: number;
  stableItemId: string;
}

export interface DatasetFilterValue {
  key: string;
  label: string;
  blank: boolean;
  kind: 'blank' | 'string' | 'number' | 'boolean' | 'json';
}

export interface DatasetFilterValueOption extends DatasetFilterValue {
  count: number;
  totalCount: number;
}

export interface DatasetFilterValueOptionGroups {
  available: DatasetFilterValueOption[];
  unavailableSelected: DatasetFilterValueOption[];
}

const BLANK_FILTER_KEY = 'blank:';
const BLANK_FILTER_LABEL = '\uff08\u7a7a\u767d\uff09';

const stableJson = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
};

export const datasetFilterValue = (value: unknown): DatasetFilterValue => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return { key: BLANK_FILTER_KEY, label: BLANK_FILTER_LABEL, blank: true, kind: 'blank' };
  }
  if (typeof value === 'string') {
    return { key: `string:${JSON.stringify(value)}`, label: value, blank: false, kind: 'string' };
  }
  if (typeof value === 'number') {
    const normalized = Number.isNaN(value) ? 'NaN' : Object.is(value, -0) ? '-0' : String(value);
    return { key: `number:${normalized}`, label: normalized, blank: false, kind: 'number' };
  }
  if (typeof value === 'boolean') {
    return { key: `boolean:${value}`, label: String(value), blank: false, kind: 'boolean' };
  }
  if (typeof value === 'bigint') {
    return { key: `bigint:${value}`, label: String(value), blank: false, kind: 'number' };
  }
  const serialized = stableJson(value);
  return { key: `json:${serialized}`, label: serialized, blank: false, kind: 'json' };
};

export const indexDatasetRows = (rows: Record<string, any>[] = []): IndexedDatasetRow[] =>
  rows.map((row, sourceIndex) => ({
    row,
    sourceIndex,
    stableItemId: getDatasetItemStableId(row),
  }));

export const hasDatasetColumnFilters = (filters: DatasetColumnFilterMap = {}) =>
  Object.values(filters).some(values => Array.isArray(values) && values.length > 0);

export const datasetRowMatchesColumnFilters = (
  item: IndexedDatasetRow,
  filters: DatasetColumnFilterMap,
  ignoredColumn?: string,
) => Object.entries(filters).every(([columnKey, selectedKeys]) => {
  if (columnKey === ignoredColumn || !selectedKeys?.length) return true;
  return selectedKeys.includes(datasetFilterValue(item.row[columnKey]).key);
});

export const applyDatasetColumnFilters = (
  rows: IndexedDatasetRow[],
  filters: DatasetColumnFilterMap,
  ignoredColumn?: string,
) => rows.filter(item => datasetRowMatchesColumnFilters(item, filters, ignoredColumn));

export const buildDatasetFilterValueOptions = (
  rows: IndexedDatasetRow[],
  columnKey: string,
  filters: DatasetColumnFilterMap,
): DatasetFilterValueOption[] => {
  const selectedKeys = new Set(filters[columnKey] || []);
  const descriptors = new Map<string, DatasetFilterValue>();
  const totals = new Map<string, number>();
  rows.forEach(item => {
    const descriptor = datasetFilterValue(item.row[columnKey]);
    descriptors.set(descriptor.key, descriptor);
    totals.set(descriptor.key, (totals.get(descriptor.key) || 0) + 1);
  });

  const counts = new Map<string, number>();
  applyDatasetColumnFilters(rows, filters, columnKey).forEach(item => {
    const key = datasetFilterValue(item.row[columnKey]).key;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...descriptors.values()]
    .map(descriptor => ({
      ...descriptor,
      count: counts.get(descriptor.key) || 0,
      totalCount: totals.get(descriptor.key) || 0,
    }))
    .filter(option => option.count > 0 || selectedKeys.has(option.key))
    .sort((left, right) => {
      if (left.blank !== right.blank) return left.blank ? 1 : -1;
      return left.label.localeCompare(right.label, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });
};

export const partitionDatasetFilterValueOptions = (
  options: DatasetFilterValueOption[],
  selectedKeys: string[],
): DatasetFilterValueOptionGroups => {
  const selected = new Set(selectedKeys);
  return {
    available: options.filter(option => option.count > 0),
    unavailableSelected: options.filter(option => option.count === 0 && selected.has(option.key)),
  };
};

export const datasetFilterLabels = (
  rows: IndexedDatasetRow[],
  columnKey: string,
  selectedKeys: string[],
) => {
  const selected = new Set(selectedKeys);
  return buildDatasetFilterValueOptions(rows, columnKey, {})
    .filter(option => selected.has(option.key))
    .map(option => option.label);
};
