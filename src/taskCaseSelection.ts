import { isGenerationFailureCell, partitionGenerationEvaluationRows } from './features/generation/generationFailureCell';
import type { IndexedDatasetRow } from './datasetRowFilters';

export type TaskCaseInvalidReason = 'mapping_incomplete' | 'missing_output' | 'missing_media' | 'generation_failed';

export interface TaskCaseCandidate extends IndexedDatasetRow {
  key: string;
  eligible: boolean;
  invalidReason?: TaskCaseInvalidReason;
  invalidColumns: string[];
}

export type TaskCaseSelectionAction = 'replace' | 'add' | 'remove';

export const getTaskCaseSelectionKey = (item: IndexedDatasetRow) =>
  item.stableItemId || `source-index:${item.sourceIndex}`;

const cellHasValue = (value: unknown) => {
  if (value === null || value === undefined) return false;
  return typeof value !== 'string' || value.trim().length > 0;
};

export const buildTaskCaseCandidates = (
  rows: IndexedDatasetRow[],
  {
    modelColumns,
    outputType,
    minimumModelCount = 1,
  }: {
    modelColumns: string[];
    outputType?: string;
    minimumModelCount?: number;
  },
): TaskCaseCandidate[] => {
  const mediaOutput = ['image', 'video', 'audio'].includes(String(outputType || ''));

  return rows.map(item => {
    const key = getTaskCaseSelectionKey(item);
    if (modelColumns.length < minimumModelCount) {
      return { ...item, key, eligible: false, invalidReason: 'mapping_incomplete', invalidColumns: [] };
    }

    if (mediaOutput) {
      const partition = partitionGenerationEvaluationRows([item.row], modelColumns);
      const excluded = partition.excluded[0];
      if (excluded) {
        return {
          ...item,
          key,
          eligible: false,
          invalidReason: excluded.reason,
          invalidColumns: excluded.columns,
        };
      }
      return { ...item, key, eligible: true, invalidColumns: [] };
    }

    const failedColumns = modelColumns.filter(column => isGenerationFailureCell(item.row[column]));
    if (failedColumns.length) {
      return {
        ...item,
        key,
        eligible: false,
        invalidReason: 'generation_failed',
        invalidColumns: failedColumns,
      };
    }

    const missingColumns = modelColumns.filter(column => !cellHasValue(item.row[column]));
    if (missingColumns.length) {
      return {
        ...item,
        key,
        eligible: false,
        invalidReason: 'missing_output',
        invalidColumns: missingColumns,
      };
    }

    return { ...item, key, eligible: true, invalidColumns: [] };
  });
};

export const defaultTaskCaseSelection = (candidates: TaskCaseCandidate[]) =>
  candidates.filter(candidate => candidate.eligible).map(candidate => candidate.key);

export const applyTaskCaseSelection = (
  currentKeys: string[],
  targetCandidates: TaskCaseCandidate[],
  action: TaskCaseSelectionAction,
) => {
  const current = new Set(currentKeys);
  if (action === 'replace') {
    return targetCandidates.filter(candidate => candidate.eligible).map(candidate => candidate.key);
  }
  if (action === 'remove') {
    targetCandidates.forEach(candidate => current.delete(candidate.key));
    return currentKeys.filter(key => current.has(key));
  }
  targetCandidates.forEach(candidate => {
    if (candidate.eligible) current.add(candidate.key);
  });
  return [...current];
};

export const resolveSelectedTaskCases = (
  candidates: TaskCaseCandidate[],
  selectedKeys: string[],
) => {
  const selected = new Set(selectedKeys);
  return candidates.filter(candidate => candidate.eligible && selected.has(candidate.key));
};

export const resolveTaskCaseDisplayId = (
  item: IndexedDatasetRow,
  caseIdColumn?: string,
) => {
  const row = item.row;
  const value = [
    caseIdColumn ? row[caseIdColumn] : undefined,
    row.case_id,
    row.Case_ID,
    row.ItemID,
    row.id,
    row['用例ID'],
    item.stableItemId,
  ].find(candidate => String(candidate ?? '').trim());
  return String(value ?? `case-${item.sourceIndex + 1}`);
};
