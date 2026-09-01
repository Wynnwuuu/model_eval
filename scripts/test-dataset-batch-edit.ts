import assert from 'node:assert/strict';

import {
  applyDatasetBatchEdit,
  buildBatchEditedDataset,
  DATASET_BATCH_EDIT_MAX_APPENDED_ROWS,
} from '../src/datasetGridEditing';
import type { EvalDataset } from '../src/types';

const baseDataset = (): EvalDataset => ({
  id: 'batch-edit',
  name: 'Batch edit',
  description: '',
  tags: [],
  inputSchema: [
    { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id', required: true, sourceKey: 'Case_ID' },
    { key: 'prompt', label: 'prompt', type: 'text', role: 'input', required: true, sourceKey: 'Prompt' },
    { key: 'result', label: 'result', type: 'video_url', role: 'output', previewType: 'video', sourceKey: 'Result' },
    { key: 'result_status', label: 'result_status', type: 'text', role: 'metadata' },
    { key: 'note_1', label: 'note_1', type: 'text', role: 'metadata' },
    { key: 'note_2', label: 'note_2', type: 'text', role: 'metadata' },
    { key: 'note_3', label: 'note_3', type: 'text', role: 'metadata' },
  ],
  items: [
    { case_id: 'one', prompt: 'first', result: 'https://example.com/1.mp4', result_status: 'succeeded', _originalData: { Case_ID: 'one', Prompt: 'first', Result: 'https://example.com/1.mp4' }, __datasetItemId: 'item-1' },
    { case_id: 'two', prompt: 'second', result: 'https://example.com/2.mp4', result_status: 'succeeded', _originalData: { Case_ID: 'two', Prompt: 'second', Result: 'https://example.com/2.mp4' }, __datasetItemId: 'item-2' },
  ],
  columnMappings: {
    caseId: 'case_id',
    inputColumns: ['prompt'],
    outputColumns: ['result'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: { case_id: 'case_id', full_prompt: 'prompt' },
  },
  datasetCard: {
    applicableTasks: [], applicableStages: [], source: '', sampleSize: 2, modality: 'video',
    tagDistribution: {}, dimensionDistribution: {}, rubricBinding: '', coverageGaps: [], latestChange: 'initial', updatedAt: 1,
  },
  modality: 'video',
  inputType: 'text',
  version: 3,
  versionHistory: [],
  createdAt: 1,
  updatedAt: 2,
});

const outcome = applyDatasetBatchEdit(baseDataset(), {
  edits: [
    { stableItemId: 'item-1', fieldKey: 'prompt', value: 'updated' },
    { stableItemId: 'item-2', fieldKey: 'result', value: 'not a URL' },
  ],
  appendedRows: [{ tempItemId: 'new-1', values: { case_id: 'three', prompt: 'third', result: 'https://example.com/3.mp4' } }],
});
assert.equal(outcome.errors.length, 0);
assert.ok(outcome.warnings.some(issue => issue.code === 'INVALID_URL'));
assert.equal(outcome.items.length, 3);
assert.equal(outcome.items[0]._originalData.Prompt, 'updated', 'source trace must follow edited schema sourceKey');
assert.equal(outcome.items[2]._originalData.Case_ID, 'three', 'new rows must build source trace data');
assert.ok(outcome.items[2].__datasetItemId, 'new rows must receive stable internal IDs');

const saved = buildBatchEditedDataset(baseDataset(), outcome, { actorName: 'Tester', now: 100 });
assert.equal(saved.version, 4);
assert.equal(saved.versionHistory?.length, 1, 'one batch must create exactly one version entry');
assert.equal(saved.datasetCard?.sampleSize, 3);
assert.equal(saved.validationSummary?.invalidUrlCount, 1);

const readonly = applyDatasetBatchEdit(baseDataset(), {
  edits: [{ stableItemId: 'item-1', fieldKey: 'result_status', value: 'failed' }],
  appendedRows: [],
});
assert.ok(readonly.errors.some(issue => issue.code === 'READ_ONLY_FIELD'));
assert.equal(readonly.items[0].result_status, 'succeeded', 'hard errors must not mutate the projected result');

const duplicate = applyDatasetBatchEdit(baseDataset(), {
  edits: [{ stableItemId: 'item-2', fieldKey: 'case_id', value: 'one' }],
  appendedRows: [],
});
assert.ok(duplicate.errors.some(issue => issue.code === 'DUPLICATE_CASE_ID'));

const missingSourceTrace = baseDataset();
delete missingSourceTrace.items[0]._originalData;
const sourceTraceOutcome = applyDatasetBatchEdit(missingSourceTrace, {
  edits: [{ stableItemId: 'item-1', fieldKey: 'prompt', value: 'trace restored' }],
  appendedRows: [],
});
assert.equal(sourceTraceOutcome.errors.length, 0);
assert.equal(sourceTraceOutcome.items[0]._originalData.Prompt, 'trace restored', 'editing must restore a missing source trace object');

const oversizedAppendedRows = Array.from({ length: DATASET_BATCH_EDIT_MAX_APPENDED_ROWS }, (_, index) => ({
  tempItemId: `large-${index}`,
  values: {
    case_id: `large-case-${index}`,
    prompt: 'prompt',
    result: '',
    note_1: 'a',
    note_2: 'b',
    note_3: 'c',
  },
}));
const oversizedCells = applyDatasetBatchEdit(baseDataset(), {
  edits: [],
  appendedRows: oversizedAppendedRows,
});
assert.ok(oversizedCells.errors.some(issue => issue.code === 'BATCH_CELL_LIMIT'), 'new-row cells must count toward the 50,000-cell limit');

console.log('Dataset batch edit tests passed.');
