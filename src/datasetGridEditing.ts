import Papa from 'papaparse';

import { buildDatasetCard, getDatasetColumnMappings, validateDatasetItems } from './datasetManifest.ts';
import { buildDatasetTableColumns } from './datasetTableColumns.ts';
import type { DatasetTableColumnDescriptor } from './datasetTableColumns.ts';
import {
  DATASET_ITEM_ID_KEY,
  ensureStableDatasetItemIds,
  getDatasetItemStableId,
} from './datasetSync.ts';
import type { EvalDataset } from './types.ts';

export const DATASET_BATCH_EDIT_MAX_CELLS = 50_000;
export const DATASET_BATCH_EDIT_MAX_APPENDED_ROWS = 10_000;

export interface DatasetGridPoint {
  rowIndex: number;
  columnIndex: number;
}

export interface DatasetGridSelection {
  anchor: DatasetGridPoint;
  focus: DatasetGridPoint;
}

export interface DatasetGridSelectionBounds {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface DatasetGridRowRef {
  row: Record<string, any>;
  sourceIndex: number;
  stableItemId: string;
}

export interface DatasetCellEdit {
  stableItemId: string;
  fieldKey: string;
  value: unknown;
}

export interface DatasetAppendedRow {
  tempItemId: string;
  values: Record<string, unknown>;
}

export interface DatasetEditIssue {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  stableItemId?: string;
  rowIndex?: number;
  fieldKey?: string;
}

export interface DatasetEditDraft {
  edits: DatasetCellEdit[];
  appendedRows: DatasetAppendedRow[];
}

export interface DatasetEditDraftHistory {
  past: DatasetEditDraft[];
  present: DatasetEditDraft;
  future: DatasetEditDraft[];
}

export interface DatasetBatchEditInput {
  edits: DatasetCellEdit[];
  appendedRows: DatasetAppendedRow[];
}

export interface DatasetBatchEditOutcome {
  items: Record<string, any>[];
  edits: DatasetCellEdit[];
  appendedRows: DatasetAppendedRow[];
  warnings: DatasetEditIssue[];
  errors: DatasetEditIssue[];
  changedCellCount: number;
  appendedRowCount: number;
}

export const EMPTY_DATASET_EDIT_DRAFT: DatasetEditDraft = { edits: [], appendedRows: [] };

const cloneDraft = (draft: DatasetEditDraft): DatasetEditDraft => ({
  edits: draft.edits.map(edit => ({ ...edit })),
  appendedRows: draft.appendedRows.map(row => ({ ...row, values: { ...row.values } })),
});

export const createDatasetDraftHistory = (): DatasetEditDraftHistory => ({
  past: [],
  present: cloneDraft(EMPTY_DATASET_EDIT_DRAFT),
  future: [],
});

export const pushDatasetDraft = (
  history: DatasetEditDraftHistory,
  next: DatasetEditDraft,
): DatasetEditDraftHistory => ({
  past: [...history.past, cloneDraft(history.present)],
  present: cloneDraft(next),
  future: [],
});

export const undoDatasetDraft = (history: DatasetEditDraftHistory): DatasetEditDraftHistory => {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: cloneDraft(previous),
    future: [cloneDraft(history.present), ...history.future],
  };
};

export const redoDatasetDraft = (history: DatasetEditDraftHistory): DatasetEditDraftHistory => {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, cloneDraft(history.present)],
    present: cloneDraft(next),
    future: history.future.slice(1),
  };
};

export const isDatasetDraftDirty = (draft: DatasetEditDraft) => (
  draft.edits.length > 0 || draft.appendedRows.length > 0
);

export const normalizeDatasetGridSelection = (
  selection: DatasetGridSelection,
): DatasetGridSelectionBounds => ({
  startRow: Math.min(selection.anchor.rowIndex, selection.focus.rowIndex),
  endRow: Math.max(selection.anchor.rowIndex, selection.focus.rowIndex),
  startColumn: Math.min(selection.anchor.columnIndex, selection.focus.columnIndex),
  endColumn: Math.max(selection.anchor.columnIndex, selection.focus.columnIndex),
});

export const isDatasetCellSelected = (
  selection: DatasetGridSelection | null,
  rowIndex: number,
  columnIndex: number,
) => {
  if (!selection) return false;
  const bounds = normalizeDatasetGridSelection(selection);
  return rowIndex >= bounds.startRow
    && rowIndex <= bounds.endRow
    && columnIndex >= bounds.startColumn
    && columnIndex <= bounds.endColumn;
};

export const serializeDatasetClipboardValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const escapeTsvCell = (value: unknown) => {
  const serialized = serializeDatasetClipboardValue(value);
  return /[\t\r\n"]/.test(serialized)
    ? `"${serialized.replace(/"/g, '""')}"`
    : serialized;
};

export const parseDatasetClipboardMatrix = (text: string): string[][] => {
  if (!text) return [['']];
  const parsed = Papa.parse<string[]>(text, {
    delimiter: '\t',
    skipEmptyLines: false,
  });
  const rows = (parsed.data || []).map(row => row.map(value => String(value ?? '')));
  if (/\r?\n$/.test(text) && rows.length > 1 && rows.at(-1)?.every(value => value === '')) rows.pop();
  return rows.length ? rows : [['']];
};

export const buildDatasetSelectionTsv = ({
  rows,
  columns,
  selection,
  getValue,
}: {
  rows: DatasetGridRowRef[];
  columns: DatasetTableColumnDescriptor[];
  selection: DatasetGridSelection;
  getValue?: (row: DatasetGridRowRef, column: DatasetTableColumnDescriptor) => unknown;
}) => {
  const bounds = normalizeDatasetGridSelection(selection);
  const selectedRows = rows.slice(bounds.startRow, bounds.endRow + 1);
  const selectedColumns = columns.slice(bounds.startColumn, bounds.endColumn + 1);
  return selectedRows.map(row => selectedColumns
    .map(column => escapeTsvCell(getValue ? getValue(row, column) : row.row[column.key]))
    .join('\t'))
    .join('\r\n');
};

export const isDatasetGridColumnEditable = (column: DatasetTableColumnDescriptor) => (
  Boolean(column.key.trim())
  && column.key !== '_originalData'
  && !column.key.startsWith('__')
  && column.role !== 'system'
  && column.displayCategory !== 'generation_companion'
);

const issue = (
  severity: DatasetEditIssue['severity'],
  code: string,
  message: string,
  details: Partial<DatasetEditIssue> = {},
): DatasetEditIssue => ({ severity, code, message, ...details });

const coercePastedValue = (rawValue: string, previousValue: unknown) => {
  if (typeof previousValue === 'number' && rawValue.trim() !== '') {
    const number = Number(rawValue);
    if (Number.isFinite(number)) return number;
  }
  if (typeof previousValue === 'boolean') {
    if (/^(true|false)$/i.test(rawValue.trim())) return rawValue.trim().toLowerCase() === 'true';
  }
  if (previousValue && typeof previousValue === 'object' && rawValue.trim()) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue;
    }
  }
  return rawValue;
};

export const planDatasetGridPaste = ({
  dataset,
  rows,
  columns,
  selection,
  matrix,
  allowAppendRows,
}: {
  dataset: EvalDataset;
  rows: DatasetGridRowRef[];
  columns: DatasetTableColumnDescriptor[];
  selection: DatasetGridSelection;
  matrix: string[][];
  allowAppendRows: boolean;
}) => {
  const edits: DatasetCellEdit[] = [];
  const appendedByRow = new Map<number, DatasetAppendedRow>();
  const issues: DatasetEditIssue[] = [];
  const bounds = normalizeDatasetGridSelection(selection);
  const isSingleValue = matrix.length === 1 && (matrix[0]?.length || 0) === 1;
  const targetHeight = isSingleValue ? bounds.endRow - bounds.startRow + 1 : matrix.length;
  const targetWidth = isSingleValue
    ? bounds.endColumn - bounds.startColumn + 1
    : Math.max(0, ...matrix.map(row => row.length));

  if (bounds.startColumn + targetWidth > columns.length) {
    issues.push(issue('error', 'COLUMN_OVERFLOW', '粘贴范围超出已有列；批量粘贴不会自动创建新列。'));
    return { edits, appendedRows: [], issues };
  }
  if (bounds.startRow + targetHeight > rows.length && !allowAppendRows) {
    issues.push(issue('error', 'APPEND_DISABLED', '当前存在筛选或排序，不能通过粘贴追加新行。请清除筛选和排序后重试。'));
    return { edits, appendedRows: [], issues };
  }

  for (let rowOffset = 0; rowOffset < targetHeight; rowOffset += 1) {
    const targetRowIndex = bounds.startRow + rowOffset;
    for (let columnOffset = 0; columnOffset < targetWidth; columnOffset += 1) {
      const targetColumnIndex = bounds.startColumn + columnOffset;
      const column = columns[targetColumnIndex];
      if (!column) continue;
      if (!isDatasetGridColumnEditable(column)) {
        issues.push(issue('error', 'READ_ONLY_FIELD', `“${column.label}”是只读记录列，不能批量修改。`, {
          rowIndex: targetRowIndex,
          fieldKey: column.key,
        }));
        continue;
      }
      const rawValue = isSingleValue ? matrix[0][0] : (matrix[rowOffset]?.[columnOffset] ?? '');
      const existing = rows[targetRowIndex];
      if (existing) {
        edits.push({
          stableItemId: existing.stableItemId,
          fieldKey: column.key,
          value: coercePastedValue(rawValue, existing.row[column.key]),
        });
      } else {
        const appended = appendedByRow.get(targetRowIndex) || {
          tempItemId: `draft-row-${targetRowIndex}`,
          values: {},
        };
        appended.values[column.key] = rawValue;
        appendedByRow.set(targetRowIndex, appended);
      }
    }
  }

  const appendedRows = [...appendedByRow.values()];
  if (appendedRows.length) {
    const mappings = getDatasetColumnMappings(dataset);
    const caseIdKey = columns.find(column => column.role === 'case_id')?.key
      || mappings.caseId
      || mappings.standard.case_id;
    const pastedColumnKeys = new Set(columns
      .slice(bounds.startColumn, bounds.startColumn + targetWidth)
      .map(column => column.key));
    if (!caseIdKey || !pastedColumnKeys.has(caseIdKey)) {
      issues.push(issue('error', 'APPEND_CASE_ID_REQUIRED', '追加新行时，粘贴范围必须包含评测集的用例 ID 列。', {
        fieldKey: caseIdKey,
      }));
    } else {
      appendedRows.forEach((row, index) => {
        if (!String(row.values[caseIdKey] ?? '').trim()) {
          issues.push(issue('error', 'APPEND_CASE_ID_REQUIRED', '新增行的用例 ID 不能为空。', {
            stableItemId: row.tempItemId,
            rowIndex: rows.length + index,
            fieldKey: caseIdKey,
          }));
        }
      });
    }
  }

  return { edits, appendedRows, issues };
};

const valuesEqual = (left: unknown, right: unknown) => {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

const isBlank = (value: unknown) => value == null || String(value).trim() === '';

const isValidHttpUrlValue = (value: unknown): boolean => {
  if (isBlank(value)) return true;
  if (Array.isArray(value)) return value.every(isValidHttpUrlValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return isValidHttpUrlValue(record.url ?? record.src ?? '');
  }
  const text = String(value).trim();
  if ((text.startsWith('[') || text.startsWith('{'))) {
    try {
      return isValidHttpUrlValue(JSON.parse(text));
    } catch {
      return false;
    }
  }
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const createOriginalData = (dataset: EvalDataset, values: Record<string, unknown>) => {
  const source: Record<string, unknown> = {};
  Object.entries(values).forEach(([fieldKey, value]) => {
    const schemaField = dataset.inputSchema.find(field => field.key === fieldKey);
    source[schemaField?.sourceKey || fieldKey] = value;
  });
  return source;
};

const validateAffectedRows = (
  dataset: EvalDataset,
  rows: Record<string, any>[],
  affectedStableIds: Set<string>,
) => {
  const warnings: DatasetEditIssue[] = [];
  const schemaByKey = new Map(dataset.inputSchema.map(field => [field.key, field]));
  const mappings = getDatasetColumnMappings(dataset);
  rows.forEach((row, rowIndex) => {
    const stableItemId = getDatasetItemStableId(row);
    if (!affectedStableIds.has(stableItemId)) return;
    dataset.inputSchema.forEach(field => {
      const value = row[field.key];
      if (field.required && isBlank(value)) {
        warnings.push(issue('warning', 'REQUIRED_VALUE_MISSING', `“${field.label}”为空。`, {
          stableItemId, rowIndex, fieldKey: field.key,
        }));
      }
      const isUrlField = field.type === 'url'
        || field.type === 'image_url'
        || field.type === 'video_url'
        || field.type === 'audio_url'
        || ['image', 'video', 'audio', 'link'].includes(field.previewType || '');
      if (isUrlField && !isBlank(value) && !isValidHttpUrlValue(value)) {
        warnings.push(issue('warning', 'INVALID_URL', `“${field.label}”不像可预览的 HTTP(S) 链接。`, {
          stableItemId, rowIndex, fieldKey: field.key,
        }));
      }
      if (field.type === 'chat_history' && typeof value === 'string' && value.trim()) {
        try {
          JSON.parse(value);
        } catch {
          warnings.push(issue('warning', 'SCHEMA_TYPE_MISMATCH', `“${field.label}”不是有效的 JSON 对话结构。`, {
            stableItemId, rowIndex, fieldKey: field.key,
          }));
        }
      }
    });
    if (mappings.inputColumns.length && mappings.inputColumns.every(column => isBlank(row[column]))) {
      const fieldKey = mappings.inputColumns[0];
      warnings.push(issue('warning', 'INPUT_VALUE_MISSING', '这一行没有任何输入内容。', {
        stableItemId, rowIndex, fieldKey: schemaByKey.get(fieldKey)?.key || fieldKey,
      }));
    }
  });
  return warnings;
};

export const applyDatasetBatchEdit = (
  dataset: EvalDataset,
  input: DatasetBatchEditInput,
): DatasetBatchEditOutcome => {
  const errors: DatasetEditIssue[] = [];
  const warnings: DatasetEditIssue[] = [];
  const requestedCellCount = input.edits.length
    + input.appendedRows.reduce((total, row) => total + Object.keys(row.values || {}).length, 0);
  if (requestedCellCount > DATASET_BATCH_EDIT_MAX_CELLS) {
    errors.push(issue('error', 'BATCH_CELL_LIMIT', `单次最多修改 ${DATASET_BATCH_EDIT_MAX_CELLS.toLocaleString()} 个单元格，请拆批保存。`));
  }
  if (input.appendedRows.length > DATASET_BATCH_EDIT_MAX_APPENDED_ROWS) {
    errors.push(issue('error', 'BATCH_ROW_LIMIT', `单次最多新增 ${DATASET_BATCH_EDIT_MAX_APPENDED_ROWS.toLocaleString()} 行，请拆批保存。`));
  }
  if (errors.length) {
    return {
      items: dataset.items.map(row => ({ ...row })),
      edits: [],
      appendedRows: [],
      warnings: [],
      errors,
      changedCellCount: 0,
      appendedRowCount: 0,
    };
  }

  const columns = buildDatasetTableColumns(dataset);
  const columnByKey = new Map(columns.map(column => [column.key, column]));
  const baseByStableId = new Map(dataset.items.map((row, rowIndex) => [
    getDatasetItemStableId(row),
    { row, rowIndex },
  ]).filter(([stableItemId]) => Boolean(stableItemId)) as Array<[string, { row: Record<string, any>; rowIndex: number }]>);
  const dedupedEdits = new Map<string, DatasetCellEdit>();
  input.edits.forEach(edit => dedupedEdits.set(`${edit.stableItemId}\u0000${edit.fieldKey}`, edit));
  const projectedItems = dataset.items.map(row => ({
    ...row,
    ...(row._originalData && typeof row._originalData === 'object' ? { _originalData: { ...row._originalData } } : {}),
  }));
  const changedEdits: DatasetCellEdit[] = [];
  const affectedStableIds = new Set<string>();

  for (const edit of dedupedEdits.values()) {
    const target = baseByStableId.get(edit.stableItemId);
    const column = columnByKey.get(edit.fieldKey);
    if (!target) {
      errors.push(issue('error', 'ITEM_NOT_FOUND', '目标 case 已不存在，请刷新后重新选择。', edit));
      continue;
    }
    if (!column) {
      errors.push(issue('error', 'COLUMN_NOT_FOUND', `字段“${edit.fieldKey}”已不存在；批量编辑不会创建新列。`, edit));
      continue;
    }
    if (!isDatasetGridColumnEditable(column)) {
      errors.push(issue('error', 'READ_ONLY_FIELD', `“${column.label}”是只读记录列，不能修改。`, edit));
      continue;
    }
    if (valuesEqual(target.row[edit.fieldKey], edit.value)) continue;
    const nextRow = projectedItems[target.rowIndex];
    nextRow[edit.fieldKey] = edit.value;
    const schemaField = dataset.inputSchema.find(field => field.key === edit.fieldKey);
    if (schemaField?.sourceKey) {
      if (!nextRow._originalData || typeof nextRow._originalData !== 'object' || Array.isArray(nextRow._originalData)) {
        nextRow._originalData = {};
      }
      nextRow._originalData[schemaField.sourceKey] = edit.value;
    }
    changedEdits.push({ ...edit });
    affectedStableIds.add(edit.stableItemId);
  }

  const mappings = getDatasetColumnMappings(dataset);
  const caseIdKey = columns.find(column => column.role === 'case_id')?.key
    || mappings.caseId
    || mappings.standard.case_id;
  const appendedRows: DatasetAppendedRow[] = [];
  for (const appended of input.appendedRows) {
    const values: Record<string, unknown> = {};
    Object.entries(appended.values || {}).forEach(([fieldKey, value]) => {
      const column = columnByKey.get(fieldKey);
      if (!column) {
        errors.push(issue('error', 'COLUMN_NOT_FOUND', `字段“${fieldKey}”不存在；批量粘贴不会创建新列。`, {
          stableItemId: appended.tempItemId,
          fieldKey,
        }));
        return;
      }
      if (!isDatasetGridColumnEditable(column)) {
        errors.push(issue('error', 'READ_ONLY_FIELD', `“${column.label}”是只读记录列，不能写入。`, {
          stableItemId: appended.tempItemId,
          fieldKey,
        }));
        return;
      }
      values[fieldKey] = value;
    });
    if (!caseIdKey || isBlank(values[caseIdKey])) {
      errors.push(issue('error', 'APPEND_CASE_ID_REQUIRED', '新增行必须包含非空的用例 ID。', {
        stableItemId: appended.tempItemId,
        fieldKey: caseIdKey,
      }));
    }
    appendedRows.push({ tempItemId: appended.tempItemId, values });
  }

  const appendedStartIndex = projectedItems.length;
  appendedRows.forEach(appended => {
    projectedItems.push({
      ...appended.values,
      _originalData: createOriginalData(dataset, appended.values),
    });
  });
  const withStableIds = ensureStableDatasetItemIds(dataset.id, projectedItems);
  const appendedStableToTemp = new Map<string, string>();
  for (let index = appendedStartIndex; index < withStableIds.length; index += 1) {
    const stableItemId = getDatasetItemStableId(withStableIds[index]);
    affectedStableIds.add(stableItemId);
    const appended = appendedRows[index - appendedStartIndex];
    if (stableItemId && appended) appendedStableToTemp.set(stableItemId, appended.tempItemId);
  }

  if (caseIdKey) {
    const seen = new Map<string, number>();
    withStableIds.forEach((row, rowIndex) => {
      const caseId = String(row[caseIdKey] ?? '').trim();
      if (!caseId) {
        errors.push(issue('error', 'CASE_ID_REQUIRED', '用例 ID 不能为空。', {
          stableItemId: getDatasetItemStableId(row), rowIndex, fieldKey: caseIdKey,
        }));
        return;
      }
      const firstRow = seen.get(caseId);
      if (firstRow !== undefined) {
        errors.push(issue('error', 'DUPLICATE_CASE_ID', `用例 ID“${caseId}”重复。`, {
          stableItemId: getDatasetItemStableId(row), rowIndex, fieldKey: caseIdKey,
        }));
      } else {
        seen.set(caseId, rowIndex);
      }
    });
  } else if (appendedRows.length) {
    errors.push(issue('error', 'APPEND_CASE_ID_REQUIRED', '该评测集没有业务用例 ID 列，不能通过粘贴追加新行。'));
  }

  if (errors.length) {
    return {
      items: dataset.items.map(row => ({ ...row })),
      edits: [],
      appendedRows: [],
      warnings: [],
      errors,
      changedCellCount: 0,
      appendedRowCount: 0,
    };
  }

  warnings.push(...validateAffectedRows(dataset, withStableIds, affectedStableIds).map(item => ({
    ...item,
    stableItemId: item.stableItemId ? appendedStableToTemp.get(item.stableItemId) || item.stableItemId : item.stableItemId,
  })));
  return {
    items: withStableIds,
    edits: changedEdits,
    appendedRows,
    warnings,
    errors,
    changedCellCount: changedEdits.length,
    appendedRowCount: appendedRows.length,
  };
};

export const buildBatchEditedDataset = (
  dataset: EvalDataset,
  outcome: DatasetBatchEditOutcome,
  options: { actorName: string; now?: number },
): EvalDataset => {
  if (outcome.errors.length) throw new Error('Cannot build a dataset from an invalid batch edit');
  if (!outcome.changedCellCount && !outcome.appendedRowCount) return dataset;
  const now = options.now ?? Date.now();
  const version = (dataset.version || 1) + 1;
  const changeSummary = `批量修改 ${outcome.changedCellCount} 个单元格${outcome.appendedRowCount ? `，新增 ${outcome.appendedRowCount} 个 case` : ''}`;
  const mappings = getDatasetColumnMappings(dataset);
  const nextBase: EvalDataset = {
    ...dataset,
    items: outcome.items,
    version,
    updatedAt: now,
    versionHistory: [
      ...(dataset.versionHistory || []),
      {
        version,
        changedAt: now,
        changedBy: options.actorName,
        changeSummary,
        itemCountBefore: dataset.items.length,
        itemCountAfter: outcome.items.length,
      },
    ],
  };
  return {
    ...nextBase,
    validationSummary: validateDatasetItems(outcome.items, mappings, dataset.inputSchema),
    datasetCard: dataset.datasetCard
      ? buildDatasetCard(nextBase, mappings, {
        ...dataset.datasetCard,
        latestChange: changeSummary,
        updatedAt: now,
      })
      : dataset.datasetCard,
  };
};

export const overlayDatasetEditDraft = (
  rows: Record<string, any>[],
  draft: DatasetEditDraft,
) => {
  const editsByItem = new Map<string, Map<string, unknown>>();
  draft.edits.forEach(edit => {
    const itemEdits = editsByItem.get(edit.stableItemId) || new Map<string, unknown>();
    itemEdits.set(edit.fieldKey, edit.value);
    editsByItem.set(edit.stableItemId, itemEdits);
  });
  const existingRows = rows.map(row => {
    const stableItemId = getDatasetItemStableId(row);
    const itemEdits = editsByItem.get(stableItemId);
    return itemEdits ? { ...row, ...Object.fromEntries(itemEdits) } : row;
  });
  return [
    ...existingRows,
    ...draft.appendedRows.map(appended => ({
      ...appended.values,
      [DATASET_ITEM_ID_KEY]: appended.tempItemId,
    })),
  ];
};
