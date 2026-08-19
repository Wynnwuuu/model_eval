import assert from 'node:assert/strict';

import {
  DATASET_ITEM_ID_KEY,
  detectDatasetColumnRenames,
  ensureStableDatasetItemIds,
  inferTaskDatasetBinding,
  planDatasetTaskSync,
  remapTaskDatasetBinding,
  stripDatasetInternalFields,
  stripDatasetStorageOnlyFields,
  synchronizeVoteSnapshot,
} from '../src/datasetSync';
import type { EvalTask, EvaluationItem, VoteRecord } from '../src/types';
import { createVoteItemSnapshot } from '../src/taskItemSnapshot';

const originalRows = ensureStableDatasetItemIds('dataset-1', [
  {
    用例ID: 'case-1',
    完整Prompt: 'original prompt',
    难度: 'easy',
    model_a: 'https://example.com/a-old.mp4',
    model_b: 'https://example.com/b-old.mp4',
  },
  {
    用例ID: 'case-2',
    完整Prompt: 'removed case',
    难度: 'hard',
    model_a: 'https://example.com/a-2.mp4',
    model_b: 'https://example.com/b-2.mp4',
  },
]);

const internalRow = {
  case_id: 'case-internal',
  [DATASET_ITEM_ID_KEY]: 'stable-internal',
  __generationResultMeta: { model_a: { stale: true } },
};
assert.deepEqual(stripDatasetInternalFields(internalRow), { case_id: 'case-internal' });
assert.deepEqual(stripDatasetStorageOnlyFields(internalRow), {
  case_id: 'case-internal',
  __generationResultMeta: { model_a: { stale: true } },
});

const renamedCaseRows = ensureStableDatasetItemIds('dataset-1', [
  { ...originalRows[0], 用例ID: 'case-1-renamed' },
]);
assert.equal(
  renamedCaseRows[0][DATASET_ITEM_ID_KEY],
  originalRows[0][DATASET_ITEM_ID_KEY],
  'stored stable item identities must survive case ID edits'
);

const nextRows = ensureStableDatasetItemIds('dataset-1', [
  {
    ...originalRows[0],
    完整Prompt: 'updated prompt',
    难度: 'expert',
    model_a: 'https://example.com/a-new.mp4',
  },
  {
    用例ID: 'case-3',
    完整Prompt: 'new case',
    难度: 'medium',
    model_a: 'https://example.com/a-3.mp4',
    model_b: 'https://example.com/b-3.mp4',
  },
]);

const makeTask = (status: EvalTask['status']): EvalTask => ({
  id: `task-${status}`,
  name: status,
  datasetId: 'dataset-1',
  datasetBinding: {
    datasetId: 'dataset-1',
    datasetVersion: 1,
    inputColumns: ['完整Prompt'],
    dimensionColumns: ['难度'],
    referenceColumns: [],
    modelColumns: {
      'model-a': 'model_a',
      'model-b': 'model_b',
    },
  },
  templateId: '',
  models: [
    { id: 'model-a', name: 'model_a' },
    { id: 'model-b', name: 'model_b' },
  ],
  outputType: 'video',
  status,
  createdAt: 1,
  evaluationConfig: { method: 'ab_preference', blind: true },
});

const makeTaskItem = (taskId: string, row: Record<string, any>, index: number): EvaluationItem => ({
  id: `${taskId}:row-${index}`,
  sourceDatasetItemId: row[DATASET_ITEM_ID_KEY],
  sourceDatasetVersion: 1,
  originalItemId: row.用例ID,
  itemOrder: index,
  prompt: row.完整Prompt,
  inputs: { 完整Prompt: row.完整Prompt },
  dimensionValues: { 难度: row.难度 },
  modelA_Url: row.model_a,
  modelB_Url: row.model_b,
  modelOutputs: [
    { modelId: 'model-a', modelName: 'model_a', url: row.model_a },
    { modelId: 'model-b', modelName: 'model_b', url: row.model_b },
  ],
  type: 'video',
  isSwapped: true,
  originalData: row,
});

const activeTask = makeTask('active');
const activeItems = originalRows.map((row, index) => makeTaskItem(activeTask.id, row, index));
const activePlan = planDatasetTaskSync({
  task: activeTask,
  previousRows: originalRows,
  nextRows,
  taskItems: activeItems,
  nextVersion: 2,
});

assert.equal(activePlan.updates.length, 1, 'common active cases should update');
assert.equal(activePlan.additions.length, 1, 'active tasks should receive new cases');
assert.equal(activePlan.archives.length, 1, 'active tasks should archive removed cases');
assert.equal(activePlan.updates[0].item.prompt, 'updated prompt');
assert.equal(activePlan.updates[0].item.dimensionValues?.难度, 'expert');
assert.equal(activePlan.updates[0].item.modelA_Url, 'https://example.com/a-new.mp4');
assert.equal(activePlan.updates[0].item.isSwapped, true, 'task-owned blind placement must be preserved');
assert.equal(activePlan.updates[0].item.id, activeItems[0].id, 'task item identity must be preserved');

const excludedTask: EvalTask = {
  ...makeTask('active'),
  id: 'task-active-with-generation-exclusion',
  datasetBinding: {
    ...makeTask('active').datasetBinding!,
    excludedDatasetItemIds: [String(nextRows[1][DATASET_ITEM_ID_KEY])],
  },
};
const excludedPlan = planDatasetTaskSync({
  task: excludedTask,
  previousRows: originalRows,
  nextRows,
  taskItems: originalRows.map((row, index) => makeTaskItem(excludedTask.id, row, index)),
  nextVersion: 2,
});
assert.equal(excludedPlan.additions.length, 0,
  'generation failures excluded at task creation must not reappear during dataset sync');
assert.deepEqual(
  excludedPlan.binding.excludedDatasetItemIds,
  [String(nextRows[1][DATASET_ITEM_ID_KEY])],
);

const includedTask: EvalTask = {
  ...makeTask('active'),
  id: 'task-active-with-fixed-scope',
  datasetBinding: {
    ...makeTask('active').datasetBinding!,
    includedDatasetItemIds: [String(originalRows[0][DATASET_ITEM_ID_KEY])],
  },
};
const includedPlan = planDatasetTaskSync({
  task: includedTask,
  previousRows: originalRows,
  nextRows,
  taskItems: [makeTaskItem(includedTask.id, originalRows[0], 0)],
  nextVersion: 2,
});
assert.equal(includedPlan.updates.length, 1, 'selected cases must continue to receive content updates');
assert.equal(includedPlan.additions.length, 0, 'fixed-scope tasks must not receive later dataset cases');
assert.deepEqual(
  includedPlan.binding.includedDatasetItemIds,
  [String(originalRows[0][DATASET_ITEM_ID_KEY])],
  'the fixed inclusion scope must survive synchronization',
);

const restoredSelectedRow = ensureStableDatasetItemIds('dataset-1', [{ ...originalRows[0], 瀹屾暣Prompt: 'restored prompt' }]);
const restoredIncludedPlan = planDatasetTaskSync({
  task: includedTask,
  previousRows: [],
  nextRows: restoredSelectedRow,
  taskItems: [],
  nextVersion: 3,
});
assert.equal(restoredIncludedPlan.additions.length, 1, 'a selected case may return when the same stable ID is restored');

const includedAndExcludedTask: EvalTask = {
  ...makeTask('active'),
  id: 'task-active-with-inclusion-and-exclusion',
  datasetBinding: {
    ...makeTask('active').datasetBinding!,
    includedDatasetItemIds: [String(nextRows[1][DATASET_ITEM_ID_KEY])],
    excludedDatasetItemIds: [String(nextRows[1][DATASET_ITEM_ID_KEY])],
  },
};
const includedAndExcludedPlan = planDatasetTaskSync({
  task: includedAndExcludedTask,
  previousRows: [],
  nextRows,
  taskItems: [],
  nextVersion: 2,
});
assert.equal(
  includedAndExcludedPlan.additions.length,
  0,
  'explicit exclusions must still apply after the fixed inclusion scope',
);

const completedTask = makeTask('completed');
const completedPlan = planDatasetTaskSync({
  task: completedTask,
  previousRows: originalRows,
  nextRows,
  taskItems: originalRows.map((row, index) => makeTaskItem(completedTask.id, row, index)),
  nextVersion: 2,
});
assert.equal(completedPlan.updates.length, 1);
assert.equal(completedPlan.additions.length, 0, 'completed tasks must not receive new cases');
assert.equal(completedPlan.archives.length, 0, 'completed tasks must retain their original case set');

const vote: VoteRecord = {
  itemId: activeItems[0].id,
  vote: 'A',
  timestamp: 1,
  itemSnapshot: {
    itemId: activeItems[0].id,
    prompt: 'original prompt',
    modelA_Url: 'https://example.com/a-old.mp4',
    modelB_Url: 'https://example.com/b-old.mp4',
  },
};
const synchronizedVote = synchronizeVoteSnapshot(vote, activePlan.updates[0].item, 2);
assert.equal(synchronizedVote.itemSnapshot?.prompt, 'updated prompt', 'default result evidence should use latest content');
assert.equal(synchronizedVote.evaluatedItemSnapshot?.prompt, 'original prompt', 'vote-time evidence must remain immutable');
assert.equal(synchronizedVote.datasetVersionEvaluated, 1);
assert.equal(synchronizedVote.datasetVersionCurrent, 2);
assert.equal(synchronizedVote.contentUpdatedAfterVote, true);

const unchangedItem = { ...activeItems[0], sourceDatasetVersion: 2 };
const unchangedVote: VoteRecord = {
  itemId: activeItems[0].id,
  vote: 'A',
  timestamp: 1,
  itemSnapshot: createVoteItemSnapshot(activeItems[0]),
};
const unchangedSynchronizedVote = synchronizeVoteSnapshot(unchangedVote, unchangedItem, 2);
assert.equal(unchangedSynchronizedVote.evaluatedItemSnapshot?.itemOrder, 0);
assert.equal(unchangedSynchronizedVote.itemSnapshot?.itemOrder, 0);
assert.equal(
  unchangedSynchronizedVote.contentUpdatedAfterVote,
  false,
  'a dataset version change must not mark an unchanged case as content-updated'
);

const duplicateRows = ensureStableDatasetItemIds('dataset-duplicates', [
  { id: 'duplicate', prompt: 'first', model_a: 'a-1', model_b: 'b-1' },
  { id: 'duplicate', prompt: 'second', model_a: 'a-2', model_b: 'b-2' },
]);
const duplicateTask: EvalTask = {
  ...makeTask('active'),
  id: 'task-duplicates',
  datasetId: 'dataset-duplicates',
  datasetBinding: undefined,
};
const duplicateLegacyItems = duplicateRows.map((row, index) => ({
  ...makeTaskItem(duplicateTask.id, row, index),
  id: `${duplicateTask.id}:row-${index}`,
  sourceDatasetItemId: undefined,
}));
const duplicatePlan = planDatasetTaskSync({
  task: duplicateTask,
  previousRows: duplicateRows,
  nextRows: duplicateRows,
  taskItems: duplicateLegacyItems,
  nextVersion: 2,
});
assert.equal(duplicatePlan.updates.length, 2, 'legacy row markers must distinguish duplicate case ids');

const ambiguousPlan = planDatasetTaskSync({
  task: duplicateTask,
  previousRows: duplicateRows,
  nextRows: duplicateRows,
  taskItems: duplicateLegacyItems.map((item, index) => ({ ...item, id: `legacy-random-${index}` })),
  nextVersion: 2,
});
assert.equal(ambiguousPlan.updates.length, 0, 'ambiguous legacy rows must not be guessed');
assert.equal(ambiguousPlan.additions.length, 0, 'ambiguous legacy rows must not trigger duplicate additions');
assert.ok(ambiguousPlan.warnings.length > 0, 'ambiguous legacy rows must surface synchronization warnings');

const variantRows = ensureStableDatasetItemIds('dataset-variants', [
  { case_id: 'shared-case', variant_label: 'baseline', prompt: 'first' },
  { case_id: 'shared-case', variant_label: 'reference', prompt: 'second' },
  { case_id: 'shared-case', variant_label: 'reference', prompt: 'third' },
]);
assert.notEqual(variantRows[0][DATASET_ITEM_ID_KEY], variantRows[1][DATASET_ITEM_ID_KEY]);
assert.notEqual(variantRows[1][DATASET_ITEM_ID_KEY], variantRows[2][DATASET_ITEM_ID_KEY]);
assert.deepEqual(
  ensureStableDatasetItemIds('dataset-variants', [
    { case_id: 'shared-case', variant_label: 'baseline', prompt: 'changed' },
    { case_id: 'shared-case', variant_label: 'reference', prompt: 'changed' },
    { case_id: 'shared-case', variant_label: 'reference', prompt: 'changed again' },
  ]).map(row => row[DATASET_ITEM_ID_KEY]),
  variantRows.map(row => row[DATASET_ITEM_ID_KEY]),
  'case_id plus variant_label and deterministic occurrence must define new stable item IDs',
);

const legacyBinding = inferTaskDatasetBinding(
  { ...activeTask, datasetBinding: undefined },
  activeItems,
  {
    caseId: '用例ID',
    inputColumns: ['完整Prompt'],
    outputColumns: ['model_a', 'model_b'],
    dimensionColumns: ['难度'],
    referenceColumns: ['reference'],
    standard: {},
  }
);
assert.deepEqual(legacyBinding.referenceColumns, ['reference'], 'legacy tasks must recover reference columns from the source manifest');

const renamedRows: Record<string, any>[] = [{
  用例ID: originalRows[0].用例ID,
  [DATASET_ITEM_ID_KEY]: originalRows[0][DATASET_ITEM_ID_KEY],
  prompt_v2: originalRows[0].完整Prompt,
  difficulty_v2: originalRows[0].难度,
  model_alpha: originalRows[0].model_a,
  model_beta: originalRows[0].model_b,
}];
const previousRenameMappings = {
  inputColumns: ['完整Prompt'],
  outputColumns: ['model_a', 'model_b'],
  dimensionColumns: ['难度'],
  referenceColumns: [],
  standard: {},
};
const nextRenameMappings = {
  inputColumns: ['prompt_v2'],
  outputColumns: ['model_alpha', 'model_beta'],
  dimensionColumns: ['difficulty_v2'],
  referenceColumns: [],
  standard: {},
};
const renameMap = detectDatasetColumnRenames(originalRows, renamedRows, previousRenameMappings, nextRenameMappings);
assert.deepEqual(renameMap, {
  完整Prompt: 'prompt_v2',
  难度: 'difficulty_v2',
  model_a: 'model_alpha',
  model_b: 'model_beta',
});
const renamedBinding = remapTaskDatasetBinding(
  activeTask.datasetBinding!,
  previousRenameMappings,
  nextRenameMappings,
  ['prompt_v2', 'model_alpha', 'model_beta', 'difficulty_v2'],
  renameMap
);
assert.equal(renamedBinding.modelColumns['model-a'], 'model_alpha');
assert.equal(renamedBinding.modelColumns['model-b'], 'model_beta');

const missingColumnBinding = remapTaskDatasetBinding(
  activeTask.datasetBinding!,
  activeTask.datasetBinding ? {
    inputColumns: activeTask.datasetBinding.inputColumns,
    outputColumns: ['model_a', 'model_b'],
    dimensionColumns: activeTask.datasetBinding.dimensionColumns,
    referenceColumns: [],
    standard: {},
  } : undefined,
  {
    inputColumns: ['完整Prompt'],
    outputColumns: ['model_b'],
    dimensionColumns: ['难度'],
    referenceColumns: [],
    standard: {},
  },
  ['用例ID', '完整Prompt', '难度', 'model_b']
);
assert.equal(missingColumnBinding.modelColumns['model-a'], 'model_a', 'missing bound columns must not be guessed by position');
const missingOutputRow = { ...originalRows[0] };
delete missingOutputRow.model_a;
const missingOutputPlan = planDatasetTaskSync({
  task: { ...activeTask, datasetBinding: missingColumnBinding },
  previousRows: originalRows,
  nextRows: [missingOutputRow],
  taskItems: [activeItems[0]],
  nextVersion: 2,
});
assert.equal(missingOutputPlan.updates[0].item.modelOutputs?.[0]?.modelId, 'model-a');
assert.equal(missingOutputPlan.updates[0].item.modelOutputs?.[0]?.url, '');
assert.equal(missingOutputPlan.updates[0].item.modelOutputs?.[1]?.modelId, 'model-b');
assert.equal(missingOutputPlan.updates[0].item.modelB_Url, originalRows[0].model_b);
assert.ok(missingOutputPlan.warnings.some(warning => warning.includes('model_a')));

const removableBinding = {
  ...activeTask.datasetBinding!,
  referenceColumns: ['removed_reference'],
};
const retainedModelColumns = Object.values(removableBinding.modelColumns);
const prunedBinding = remapTaskDatasetBinding(
  removableBinding,
  undefined,
  {
    inputColumns: [],
    outputColumns: retainedModelColumns,
    dimensionColumns: [],
    referenceColumns: [],
    standard: {},
  },
  retainedModelColumns
);
assert.deepEqual(prunedBinding.inputColumns, [], 'deleted input columns must leave task bindings');
assert.deepEqual(prunedBinding.dimensionColumns, [], 'deleted dimension columns must leave task bindings');
assert.deepEqual(prunedBinding.referenceColumns, [], 'deleted reference columns must leave task bindings');
assert.deepEqual(
  prunedBinding.modelColumns,
  removableBinding.modelColumns,
  'missing output columns must retain model identity for transparent empty-output warnings'
);

const pairTask: EvalTask = {
  ...activeTask,
  id: 'task-pair-rename',
  datasetBinding: renamedBinding,
  models: [
    { id: 'model-a', name: 'model_alpha' },
    { id: 'model-b', name: 'model_beta' },
  ],
  evaluationConfig: { method: 'pairwise', pairwiseMode: 'all_pairs', blind: true },
};
const pairItem: EvaluationItem = {
  ...activeItems[0],
  id: 'task-pair-rename:row-0__model-a__model-b',
  pairContext: {
    pairId: 'model-a__model-b',
    originalItemId: 'case-1',
    modelAId: 'model-a',
    modelAName: 'model_a',
    modelBId: 'model-b',
    modelBName: 'model_b',
  },
};
const pairRenamePlan = planDatasetTaskSync({
  task: pairTask,
  previousRows: originalRows,
  nextRows: renamedRows,
  taskItems: [pairItem],
  nextVersion: 2,
});
assert.equal(pairRenamePlan.updates[0].item.pairContext?.modelAName, 'model_alpha');
assert.equal(pairRenamePlan.updates[0].item.pairContext?.modelBName, 'model_beta');
assert.equal(pairRenamePlan.updates[0].item.modelOutputs?.[0]?.modelName, 'model_alpha');
assert.equal(pairRenamePlan.updates[0].item.prompt, 'original prompt');
assert.equal(pairRenamePlan.updates[0].item.dimensionValues?.difficulty_v2, 'easy');

const sampledRows = [{
  ...originalRows[0],
  model_c: 'https://example.com/c-old.mp4',
}];
const sampledTask: EvalTask = {
  ...activeTask,
  id: 'task-arena-sampled',
  models: [...activeTask.models, { id: 'model-c', name: 'model_c' }],
  datasetBinding: {
    ...activeTask.datasetBinding!,
    modelColumns: {
      ...activeTask.datasetBinding!.modelColumns,
      'model-c': 'model_c',
    },
  },
  evaluationConfig: { method: 'pairwise', pairwiseMode: 'arena_sampled', blind: true },
};
const sampledItem: EvaluationItem = {
  ...makeTaskItem(sampledTask.id, sampledRows[0], 0),
  modelOutputs: sampledTask.models.map(model => ({
    modelId: model.id,
    modelName: model.name,
    url: sampledRows[0][sampledTask.datasetBinding!.modelColumns[model.id]],
  })),
  pairContext: {
    pairId: 'model-a__model-b',
    originalItemId: 'case-1',
    modelAId: 'model-a',
    modelAName: 'model_a',
    modelBId: 'model-b',
    modelBName: 'model_b',
    leftModelId: 'model-b',
    rightModelId: 'model-a',
  },
};
const sampledPlan = planDatasetTaskSync({
  task: sampledTask,
  previousRows: sampledRows,
  nextRows: [{ ...sampledRows[0], model_c: 'https://example.com/c-new.mp4' }],
  taskItems: [sampledItem],
  nextVersion: 2,
});
assert.equal(sampledPlan.updates[0].item.modelOutputs?.length, 3, 'sampled Arena sync must retain every model output');
assert.equal(sampledPlan.updates[0].item.modelOutputs?.[2]?.url, 'https://example.com/c-new.mp4');
assert.equal(sampledPlan.updates[0].item.pairContext?.leftModelId, 'model-b', 'sampled battle placement must remain task-owned');

console.log('Dataset synchronization tests passed.');
