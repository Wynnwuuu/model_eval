import assert from 'node:assert/strict';

import {
  buildDatasetSelectionTsv,
  normalizeDatasetGridSelection,
  parseDatasetClipboardMatrix,
  planDatasetGridPaste,
} from '../src/datasetGridEditing';
import { buildDatasetTableColumns } from '../src/datasetTableColumns';
import type { EvalDataset } from '../src/types';

const dataset: EvalDataset = {
  id: 'grid-editing',
  name: 'Grid editing',
  description: '',
  tags: [],
  inputSchema: [
    { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id', required: true },
    { key: 'prompt', label: 'prompt', type: 'text', role: 'input', required: true },
    { key: 'result', label: 'result', type: 'video_url', role: 'output', previewType: 'video' },
    { key: 'result_status', label: 'result_status', type: 'text', role: 'metadata' },
    { key: 'notes', label: 'notes', type: 'text', role: 'metadata' },
  ],
  items: [
    { case_id: 'one', prompt: 'first', result: 'https://example.com/1.mp4', result_status: 'succeeded', notes: 'a', __datasetItemId: 'item-1' },
    { case_id: 'two', prompt: 'second', result: 'https://example.com/2.mp4', result_status: 'succeeded', notes: 'b', __datasetItemId: 'item-2' },
  ],
  columnMappings: {
    caseId: 'case_id',
    inputColumns: ['prompt'],
    outputColumns: ['result'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: { case_id: 'case_id' },
  },
  createdAt: 1,
  updatedAt: 1,
};

assert.deepEqual(
  normalizeDatasetGridSelection({ anchor: { rowIndex: 1, columnIndex: 2 }, focus: { rowIndex: 0, columnIndex: 1 } }),
  { startRow: 0, endRow: 1, startColumn: 1, endColumn: 2 },
);

assert.deepEqual(
  parseDatasetClipboardMatrix('"line one\nline two"\tvalue\r\nnext\t"quoted ""value"""\r\n'),
  [['line one\nline two', 'value'], ['next', 'quoted "value"']],
  'TSV parsing must preserve quoted newlines and remove only the clipboard terminator row',
);

const columns = buildDatasetTableColumns(dataset);
const rows = dataset.items.map((row, sourceIndex) => ({ row, sourceIndex, stableItemId: String(row.__datasetItemId) }));
const tsv = buildDatasetSelectionTsv({
  rows,
  columns,
  selection: { anchor: { rowIndex: 0, columnIndex: 1 }, focus: { rowIndex: 1, columnIndex: 2 } },
});
assert.equal(tsv, 'first\thttps://example.com/1.mp4\r\nsecond\thttps://example.com/2.mp4');

const fillPlan = planDatasetGridPaste({
  dataset,
  rows,
  columns,
  selection: { anchor: { rowIndex: 0, columnIndex: 4 }, focus: { rowIndex: 1, columnIndex: 4 } },
  matrix: [['same note']],
  allowAppendRows: true,
});
assert.equal(fillPlan.edits.length, 2, 'one clipboard value must fill the selected range');
assert.ok(fillPlan.edits.every(edit => edit.fieldKey === 'notes' && edit.value === 'same note'));

const appendPlan = planDatasetGridPaste({
  dataset,
  rows,
  columns,
  selection: { anchor: { rowIndex: 1, columnIndex: 0 }, focus: { rowIndex: 1, columnIndex: 0 } },
  matrix: [['two', 'updated second'], ['three', 'third prompt']],
  allowAppendRows: true,
});
assert.equal(appendPlan.appendedRows.length, 1);
assert.deepEqual(appendPlan.appendedRows[0].values, { case_id: 'three', prompt: 'third prompt' });

const blockedAppend = planDatasetGridPaste({
  dataset,
  rows,
  columns,
  selection: { anchor: { rowIndex: 1, columnIndex: 1 }, focus: { rowIndex: 1, columnIndex: 1 } },
  matrix: [['updated'], ['new row without ID']],
  allowAppendRows: true,
});
assert.ok(blockedAppend.issues.some(issue => issue.code === 'APPEND_CASE_ID_REQUIRED' && issue.severity === 'error'));

const readonlyPlan = planDatasetGridPaste({
  dataset,
  rows,
  columns,
  selection: { anchor: { rowIndex: 0, columnIndex: 3 }, focus: { rowIndex: 0, columnIndex: 3 } },
  matrix: [['failed']],
  allowAppendRows: true,
});
assert.ok(readonlyPlan.issues.some(issue => issue.code === 'READ_ONLY_FIELD'));

console.log('Dataset grid editing tests passed.');
