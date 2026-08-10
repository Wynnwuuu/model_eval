import assert from 'node:assert/strict';

import {
  applyDatasetColumnFilters,
  buildDatasetFilterValueOptions,
  datasetFilterValue,
  indexDatasetRows,
  partitionDatasetFilterValueOptions,
  type DatasetColumnFilterMap,
} from '../src/datasetRowFilters.ts';
import {
  createGenerationCaseScopeSnapshot,
  generationCaseScopeIsCurrent,
  resolveGenerationCaseScopeRows,
  summarizeGenerationCaseScope,
} from '../src/features/generation/caseScope.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import type { EvalDataset } from '../src/types.ts';
import { resolveDatasetFilterPopoverPosition } from '../src/components/DatasetColumnFilterMenu.tsx';

const rows: Record<string, unknown>[] = [
  { [DATASET_ITEM_ID_KEY]: 'item-0', case_id: 'case-0', CELL_ID: 'AI', modality: 'video', group: 'one', typed: 1, note: '' },
  { [DATASET_ITEM_ID_KEY]: 'item-1', case_id: 'case-1', CELL_ID: 'AIM', modality: 'video', group: 'one', typed: '1', note: 'ready', structured: { b: 2, a: 1 } },
  { case_id: 'case-2', CELL_ID: 'AI', modality: 'image', group: 'two', typed: false, note: null, structured: { a: 1, b: 2 } },
  { [DATASET_ITEM_ID_KEY]: 'item-3', case_id: 'case-3', CELL_ID: 'ai', modality: 'video', group: 'two', typed: true, note: 'ready', structured: ['a', 'b'] },
  { [DATASET_ITEM_ID_KEY]: 'item-4', case_id: 'case-4', CELL_ID: 'OTHER', modality: 'video', group: 'three', typed: 0, note: '   ', structured: ['b', 'a'] },
];

const indexed = indexDatasetRows(rows);
const aiKey = datasetFilterValue('AI').key;
const aimKey = datasetFilterValue('AIM').key;
const videoKey = datasetFilterValue('video').key;
const blankKey = datasetFilterValue('').key;
const groupThreeKey = datasetFilterValue('three').key;

const cellFilter: DatasetColumnFilterMap = { CELL_ID: [aiKey, aimKey] };
assert.deepEqual(
  applyDatasetColumnFilters(indexed, cellFilter).map(item => item.sourceIndex),
  [0, 1, 2],
  'multiple selected values in one column must use OR and preserve source order',
);

assert.deepEqual(
  applyDatasetColumnFilters(indexed, { ...cellFilter, modality: [videoKey] }).map(item => item.sourceIndex),
  [0, 1],
  'filters across columns must use AND',
);

assert.deepEqual(
  applyDatasetColumnFilters(indexed, { note: [blankKey] }).map(item => item.sourceIndex),
  [0, 2, 4],
  'empty strings, null and whitespace-only values must share one blank option',
);

assert.notEqual(datasetFilterValue(1).key, datasetFilterValue('1').key, 'number and string values must not collide');
assert.notEqual(datasetFilterValue(true).key, datasetFilterValue('true').key, 'boolean and string values must not collide');
assert.equal(datasetFilterValue(1).kind, 'number', 'filter values must expose their type for an unambiguous UI');
assert.equal(datasetFilterValue('1').kind, 'string', 'string and number labels may match but their visible types must differ');
assert.equal(
  datasetFilterValue({ b: 2, a: 1 }).key,
  datasetFilterValue({ a: 1, b: 2 }).key,
  'object key order must not create duplicate filter values',
);
assert.notEqual(
  datasetFilterValue(['a', 'b']).key,
  datasetFilterValue(['b', 'a']).key,
  'array order remains meaningful',
);

const groupOptions = buildDatasetFilterValueOptions(indexed, 'group', cellFilter);
assert.deepEqual(
  Object.fromEntries(groupOptions.map(option => [option.label, option.count])),
  { one: 2, two: 1 },
  'cascading options must hide unselected values that have no rows under the other filters',
);
const groupOptionsWithUnavailableSelection = buildDatasetFilterValueOptions(indexed, 'group', {
  ...cellFilter,
  group: [groupThreeKey],
});
assert.deepEqual(
  Object.fromEntries(groupOptionsWithUnavailableSelection.map(option => [option.label, option.count])),
  { one: 2, three: 0, two: 1 },
  'a selected value that becomes unavailable must remain visible so its active condition is not hidden',
);
const groupedOptions = partitionDatasetFilterValueOptions(
  groupOptionsWithUnavailableSelection,
  [groupThreeKey],
);
assert.deepEqual(
  groupedOptions.available.map(option => option.label),
  ['one', 'two'],
  'only positive-count values belong to the selectable cascading candidate list',
);
assert.deepEqual(
  groupedOptions.unavailableSelected.map(option => option.label),
  ['three'],
  'selected zero-count values must render in a separate unavailable section',
);
assert.deepEqual(
  buildDatasetFilterValueOptions(indexed, 'case_id', cellFilter).map(option => option.label),
  ['case-0', 'case-1', 'case-2'],
  'a later ID filter must only offer IDs from rows visible under the earlier CELL_ID filter',
);
assert.deepEqual(
  buildDatasetFilterValueOptions(indexed, 'CELL_ID', { ...cellFilter, modality: [videoKey] })
    .map(option => [option.label, option.count]),
  [['AI', 1], ['ai', 1], ['AIM', 1], ['OTHER', 1]],
  'the current column filter must be ignored while its candidate list is calculated',
);
assert.equal(
  applyDatasetColumnFilters(indexed, { CELL_ID: [datasetFilterValue('ai').key] }).length,
  1,
  'exact value identity remains case-sensitive',
);

const selectedCaseIdKeys = [datasetFilterValue('case-0').key, datasetFilterValue('case-2').key];
assert.deepEqual(
  applyDatasetColumnFilters(indexed, { case_id: selectedCaseIdKeys }).map(item => item.row.case_id),
  ['case-0', 'case-2'],
  'clearing an earlier filter must not expand a later exact ID selection',
);

const dataset: EvalDataset = {
  id: 'dataset-filter-test',
  name: 'Dataset filter test',
  description: '',
  tags: [],
  inputSchema: [],
  items: rows,
  version: 7,
  createdAt: 1,
  updatedAt: 1,
};
const filteredRows = applyDatasetColumnFilters(indexed, cellFilter);
const snapshot = createGenerationCaseScopeSnapshot({
  dataset,
  filteredRows,
  filters: cellFilter,
  columnLabels: { CELL_ID: 'CELL_ID' },
});

assert.deepEqual(snapshot.filteredDatasetItemIds, ['item-0', 'item-1'], 'scope snapshot must contain only real stable IDs');
assert.deepEqual(snapshot.filteredSourceRowIndexes, [0, 1, 2], 'scope snapshot must retain filtered rows without stable IDs for display');
assert.deepEqual(snapshot.filters, [{ columnKey: 'CELL_ID', columnLabel: 'CELL_ID', selectedLabels: ['AI', 'AIM'] }]);
assert.equal(generationCaseScopeIsCurrent(dataset, snapshot), true);
assert.equal(generationCaseScopeIsCurrent({ ...dataset, version: 8 }, snapshot), false, 'version changes invalidate a filtered scope');
assert.deepEqual(
  resolveGenerationCaseScopeRows(dataset, 'filtered', snapshot).map(item => item.sourceIndex),
  [0, 1, 2],
  'filtered scope must preserve every filtered source row in source order',
);
const reorderedWithoutVersionChange = { ...dataset, items: [rows[1], rows[0], ...rows.slice(2)] };
assert.deepEqual(
  resolveGenerationCaseScopeRows(reorderedWithoutVersionChange, 'filtered', snapshot).map(item => item.stableItemId || item.row.case_id),
  ['item-1', 'item-0', 'case-2'],
  'stable IDs must remain authoritative while source indexes only retain rows that lack an ID',
);
assert.deepEqual(
  resolveGenerationCaseScopeRows(dataset, 'all', snapshot).map(item => item.sourceIndex),
  [0, 1, 2, 3, 4],
  'all scope must include the complete dataset',
);

const emptySnapshot = createGenerationCaseScopeSnapshot({
  dataset,
  filteredRows: [],
  filters: { CELL_ID: [datasetFilterValue('missing').key] },
  columnLabels: { CELL_ID: 'CELL_ID' },
});
assert.deepEqual(resolveGenerationCaseScopeRows(dataset, 'filtered', emptySnapshot), [], 'an empty filtered scope must never fall back to all rows');

const eligibilityRows = indexDatasetRows([
  { [DATASET_ITEM_ID_KEY]: 'eligible-a', modality: 'video', result: '' },
  { [DATASET_ITEM_ID_KEY]: 'filled', modality: 'video', result: 'https://example.com/result.mp4' },
  { [DATASET_ITEM_ID_KEY]: 'wrong-modality', modality: 'image', result: '' },
  { modality: 'video', result: '' },
  { [DATASET_ITEM_ID_KEY]: 'eligible-b', modality: 'video', result: '' },
]);
const eligibility = summarizeGenerationCaseScope(
  eligibilityRows,
  'result',
  row => row.modality === 'video',
);
assert.deepEqual(eligibility.eligibleDatasetItemIds, ['eligible-a', 'eligible-b'], 'eligible IDs must preserve dataset order');
assert.deepEqual(eligibility.counts, {
  total: 5,
  eligible: 2,
  targetFilled: 1,
  modalityMismatch: 1,
  missingStableId: 1,
}, 'scope counts must classify each row once using the same rules as selection');

assert.deepEqual(
  resolveDatasetFilterPopoverPosition({ left: 900, right: 928, top: 120, bottom: 148 }, 1024, 768),
  { left: 568, top: 154, maxHeight: 460 },
  'desktop popovers must stay inside the viewport and open below when space allows',
);
assert.deepEqual(
  resolveDatasetFilterPopoverPosition({ left: 340, right: 368, top: 720, bottom: 748 }, 390, 844),
  { left: 8, top: 254, maxHeight: 460 },
  'mobile popovers must open above a low trigger without horizontal overflow',
);

console.log('Dataset row filtering and generation scope tests passed.');
