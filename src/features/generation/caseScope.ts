import type { EvalDataset } from '../../types';
import { DATASET_ITEM_ID_KEY } from '../../datasetSync';
import {
  datasetFilterLabels,
  indexDatasetRows,
  type DatasetColumnFilterMap,
  type IndexedDatasetRow,
} from '../../datasetRowFilters';

export type GenerationCaseScopeMode = 'filtered' | 'all';

export interface GenerationCaseScopeSnapshot {
  datasetId: string;
  datasetVersion: number;
  filteredDatasetItemIds: string[];
  filteredSourceRowIndexes: number[];
  filters: Array<{
    columnKey: string;
    columnLabel: string;
    selectedLabels: string[];
  }>;
}

export interface GenerationCaseScopeEligibility {
  eligibleDatasetItemIds: string[];
  counts: {
    total: number;
    eligible: number;
    targetFilled: number;
    modalityMismatch: number;
    missingStableId: number;
  };
}

export const createGenerationCaseScopeSnapshot = ({
  dataset,
  filteredRows,
  filters,
  columnLabels,
}: {
  dataset: EvalDataset;
  filteredRows: IndexedDatasetRow[];
  filters: DatasetColumnFilterMap;
  columnLabels: Record<string, string>;
}): GenerationCaseScopeSnapshot => {
  const allRows = indexDatasetRows(dataset.items || []);
  return {
    datasetId: dataset.id,
    datasetVersion: dataset.version || 1,
    filteredDatasetItemIds: filteredRows.map(item => item.stableItemId).filter(Boolean),
    filteredSourceRowIndexes: filteredRows.map(item => item.sourceIndex),
    filters: Object.entries(filters)
      .filter(([, selectedKeys]) => selectedKeys.length > 0)
      .map(([columnKey, selectedKeys]) => ({
        columnKey,
        columnLabel: columnLabels[columnKey] || columnKey,
        selectedLabels: datasetFilterLabels(allRows, columnKey, selectedKeys),
      })),
  };
};

export const generationCaseScopeIsCurrent = (
  dataset: EvalDataset,
  snapshot?: GenerationCaseScopeSnapshot,
) => Boolean(snapshot
  && snapshot.datasetId === dataset.id
  && snapshot.datasetVersion === (dataset.version || 1));

export const resolveGenerationCaseScopeRows = (
  dataset: EvalDataset,
  mode: GenerationCaseScopeMode,
  snapshot?: GenerationCaseScopeSnapshot,
): IndexedDatasetRow[] => {
  const rows = indexDatasetRows(dataset.items || []);
  if (mode === 'all') return rows;
  if (!generationCaseScopeIsCurrent(dataset, snapshot)) return [];
  const stableItemIds = new Set(snapshot?.filteredDatasetItemIds || []);
  const sourceIndexes = new Set(snapshot?.filteredSourceRowIndexes || []);
  return rows.filter(item => item.stableItemId
    ? stableItemIds.has(item.stableItemId)
    : sourceIndexes.has(item.sourceIndex));
};

export const summarizeGenerationCaseScope = (
  rows: IndexedDatasetRow[],
  targetColumn: string,
  rowMatchesModality: (row: Record<string, any>) => boolean = () => true,
): GenerationCaseScopeEligibility => {
  const eligibleDatasetItemIds: string[] = [];
  const counts = {
    total: rows.length,
    eligible: 0,
    targetFilled: 0,
    modalityMismatch: 0,
    missingStableId: 0,
  };

  rows.forEach(item => {
    const datasetItemId = String(item.row[DATASET_ITEM_ID_KEY] || '').trim();
    if (!datasetItemId) counts.missingStableId += 1;
    else if (String(item.row[targetColumn] ?? '').trim()) counts.targetFilled += 1;
    else if (!rowMatchesModality(item.row)) counts.modalityMismatch += 1;
    else {
      counts.eligible += 1;
      eligibleDatasetItemIds.push(datasetItemId);
    }
  });

  return { eligibleDatasetItemIds, counts };
};
