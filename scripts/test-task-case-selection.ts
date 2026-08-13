import assert from 'node:assert/strict';

import { datasetFilterValue, applyDatasetColumnFilters, indexDatasetRows } from '../src/datasetRowFilters.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import {
  applyTaskCaseSelection,
  buildTaskCaseCandidates,
  defaultTaskCaseSelection,
  resolveSelectedTaskCases,
  resolveTaskCaseDisplayId,
} from '../src/taskCaseSelection.ts';

const rows = [
  {
    [DATASET_ITEM_ID_KEY]: 'item-1',
    case_id: 'case-1',
    scene: 'indoor',
    difficulty: 'easy',
    model_a: 'https://example.com/a-1.mp4',
    model_b: 'https://example.com/b-1.mp4',
  },
  {
    [DATASET_ITEM_ID_KEY]: 'item-2',
    case_id: 'case-2',
    scene: 'outdoor',
    difficulty: 'hard',
    model_a: 'https://example.com/a-2.mp4',
    model_b: '',
  },
  {
    [DATASET_ITEM_ID_KEY]: 'item-3',
    case_id: 'case-3',
    scene: 'indoor',
    difficulty: 'hard',
    model_a: 'https://example.com/a-3.mp4',
    model_b: 'https://example.com/b-3.mp4',
  },
];

const candidates = buildTaskCaseCandidates(indexDatasetRows(rows), {
  modelColumns: ['model_a', 'model_b'],
  outputType: 'video',
  minimumModelCount: 2,
});

assert.equal(
  buildTaskCaseCandidates(indexDatasetRows(rows), {
    modelColumns: ['model_a'],
    outputType: 'video',
    minimumModelCount: 2,
  })[0].invalidReason,
  'mapping_incomplete',
  'cases must not be described as broken while the evaluation method still needs more model columns',
);

assert.deepEqual(
  candidates.map(candidate => [candidate.key, candidate.eligible, candidate.invalidReason]),
  [
    ['item-1', true, undefined],
    ['item-2', false, 'missing_media'],
    ['item-3', true, undefined],
  ],
  'media candidates must preserve source order and exclude rows missing any selected model output',
);

const defaultSelection = defaultTaskCaseSelection(candidates);
assert.deepEqual(defaultSelection, ['item-1', 'item-3'], 'default selection must contain every valid case and no invalid case');

const indexed = indexDatasetRows(rows);
const indoorRows = applyDatasetColumnFilters(indexed, {
  scene: [datasetFilterValue('indoor').key],
});
const indoorCandidates = candidates.filter(candidate => indoorRows.some(row => row.sourceIndex === candidate.sourceIndex));
const hardRows = applyDatasetColumnFilters(indexed, {
  difficulty: [datasetFilterValue('hard').key],
});
const hardCandidates = candidates.filter(candidate => hardRows.some(row => row.sourceIndex === candidate.sourceIndex));

assert.deepEqual(
  applyTaskCaseSelection(defaultSelection, indoorCandidates, 'replace'),
  ['item-1', 'item-3'],
  'replace must select only valid cases in the current filter',
);
assert.deepEqual(
  applyTaskCaseSelection(['item-1'], hardCandidates, 'add'),
  ['item-1', 'item-3'],
  'add must retain hidden selections and ignore invalid visible cases',
);
assert.deepEqual(
  applyTaskCaseSelection(['item-1', 'item-2', 'item-3'], hardCandidates, 'remove'),
  ['item-1'],
  'remove must clear visible selection intent, including an invalid case that may later recover',
);

const modelBRecoveredRows = rows.map(row => row.case_id === 'case-2'
  ? { ...row, model_b: 'https://example.com/b-2.mp4' }
  : row);
const temporarilyInvalidSelection = ['item-1', 'item-2'];
assert.deepEqual(
  resolveSelectedTaskCases(candidates, temporarilyInvalidSelection).map(candidate => candidate.key),
  ['item-1'],
  'invalid cases must be excluded without deleting their stored selection intent',
);
assert.deepEqual(
  resolveSelectedTaskCases(
    buildTaskCaseCandidates(indexDatasetRows(modelBRecoveredRows), {
      modelColumns: ['model_a', 'model_b'],
      outputType: 'video',
    }),
    temporarilyInvalidSelection,
  ).map(candidate => candidate.key),
  ['item-1', 'item-2'],
  'a selected case must return automatically after its output becomes valid again',
);

const textCandidates = buildTaskCaseCandidates(indexDatasetRows([
  { case_id: 'text-1', model_a: 'answer a', model_b: 'answer b' },
  { case_id: 'text-2', model_a: 'answer a', model_b: '   ' },
]), {
  modelColumns: ['model_a', 'model_b'],
  outputType: 'text',
});
assert.deepEqual(
  textCandidates.map(candidate => candidate.eligible),
  [true, false],
  'text tasks must also reject empty selected model outputs',
);
assert.notEqual(textCandidates[0].key, textCandidates[1].key, 'uploaded rows without stable IDs need deterministic session keys');
assert.equal(
  resolveTaskCaseDisplayId({ row: { id: '' }, sourceIndex: 4, stableItemId: '' }),
  'case-5',
  'blank imported ID cells must fall back to a readable session case ID',
);

console.log('Task case selection tests passed.');
