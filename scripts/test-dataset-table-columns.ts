import assert from 'node:assert/strict';

import {
  buildDatasetTableColumns,
  getVisibleDatasetTableColumns,
} from '../src/datasetTableColumns';
import type { DatasetSchemaField, EvalDataset } from '../src/types';

const CASE_ID = '\u7528\u4f8bID';
const FULL_PROMPT = '\u5b8c\u6574Prompt';
const EXTRA_INPUT = '\u989d\u5916\u8f93\u5165';
const DIMENSION = '\u573a\u666f';
const REFERENCE_IMAGE = '\u53c2\u8003\u56fe\u7247';
const REFERENCE_VIDEO = '\u53c2\u8003\u89c6\u9891';
const REFERENCE_AUDIO = '\u53c2\u8003\u97f3\u9891';
const OBSERVATION_FOCUS = '\u89c2\u5bdf\u91cd\u70b9';
const PARAMS_JSON = `MiniMax-H3_\u53c2\u6570JSON`;

const referenceImageColumns = Array.from({ length: 6 }, (_, index) => `${REFERENCE_IMAGE}_${index + 1}_URL`);
const referenceVideoColumns = Array.from({ length: 3 }, (_, index) => `${REFERENCE_VIDEO}_${index + 1}_URL`);
const referenceAudioColumn = `${REFERENCE_AUDIO}_1_URL`;

const schema: DatasetSchemaField[] = [
  { key: CASE_ID, label: CASE_ID, type: 'text', role: 'case_id', sourceKey: 'Case_ID' },
  { key: FULL_PROMPT, label: FULL_PROMPT, type: 'text', role: 'input', sourceKey: 'Prompt' },
  { key: EXTRA_INPUT, label: EXTRA_INPUT, type: 'text', role: 'input', sourceKey: 'Extra_Input' },
  { key: 'MiniMax-H3', label: 'MiniMax-H3', type: 'video_url', role: 'output', previewType: 'video' },
  { key: 'Seedance 2.0 Pro', label: 'Seedance 2.0 Pro', type: 'video_url', role: 'output', previewType: 'video' },
  { key: DIMENSION, label: DIMENSION, type: 'text', role: 'dimension' },
  ...referenceImageColumns.map((key): DatasetSchemaField => ({
    key,
    label: key,
    type: 'image_url',
    role: 'reference',
    previewType: 'image',
  })),
  ...referenceVideoColumns.map((key): DatasetSchemaField => ({
    key,
    label: key,
    type: 'video_url',
    role: 'reference',
    previewType: 'video',
  })),
  { key: referenceAudioColumn, label: referenceAudioColumn, type: 'audio_url', role: 'reference', previewType: 'audio' },
  { key: OBSERVATION_FOCUS, label: OBSERVATION_FOCUS, type: 'text', role: 'metadata' },
  { key: PARAMS_JSON, label: PARAMS_JSON, type: 'text', role: 'system', previewType: 'none' },
];

const row = Object.fromEntries(schema.map(field => [field.key, `${field.key}-value`])) as Record<string, any>;
row._originalData = { untouched: true };
row.__datasetItemId = 'dataset-item-1';

const dataset: EvalDataset = {
  id: 'wide-dataset',
  name: 'Wide dataset',
  description: '',
  tags: [],
  inputSchema: schema,
  items: [row],
  createdAt: 1,
  updatedAt: 1,
  columnMappings: {
    caseId: CASE_ID,
    inputColumns: [FULL_PROMPT, EXTRA_INPUT],
    outputColumns: ['MiniMax-H3', 'Seedance 2.0 Pro'],
    dimensionColumns: [DIMENSION],
    referenceColumns: [...referenceImageColumns, ...referenceVideoColumns, referenceAudioColumn],
    standard: { case_id: CASE_ID, full_prompt: FULL_PROMPT },
  },
};

const columns = buildDatasetTableColumns(dataset);
assert.deepEqual(columns.map(column => column.key), schema.map(field => field.key), 'schema order must be preserved');
assert.equal(new Set(columns.map(column => column.key)).size, columns.length, 'columns must not be duplicated');
assert.ok(!columns.some(column => column.key === '_originalData'), 'raw trace data must stay hidden');
assert.ok(!columns.some(column => column.key.startsWith('__')), 'internal columns must stay hidden');
assert.equal(columns.filter(column => column.role === 'reference').length, 10, 'all reference media columns must be projected');
assert.equal(columns.find(column => column.key === PARAMS_JSON)?.defaultVisible, false, 'system fields default to hidden');
assert.equal(columns.find(column => column.key === CASE_ID)?.lockedVisible, true, 'case ID must remain visible');

const defaultVisible = getVisibleDatasetTableColumns(columns);
assert.ok(defaultVisible.some(column => column.key === EXTRA_INPUT), 'additional inputs must be visible');
assert.ok(defaultVisible.some(column => column.key === referenceImageColumns[5]), 'references after the second column must be visible');
assert.ok(defaultVisible.some(column => column.key === referenceVideoColumns[2]), 'later reference videos must be visible');
assert.ok(defaultVisible.some(column => column.key === referenceAudioColumn), 'reference audio must be visible');
assert.ok(defaultVisible.some(column => column.key === OBSERVATION_FOCUS), 'ordinary metadata must be visible');
assert.ok(!defaultVisible.some(column => column.key === PARAMS_JSON), 'system fields must be hidden by default');

const systemVisible = getVisibleDatasetTableColumns(columns, { [PARAMS_JSON]: true });
assert.ok(systemVisible.some(column => column.key === PARAMS_JSON), 'visibility overrides must reveal system fields');

const legacyDataset: EvalDataset = {
  id: 'legacy-dataset',
  name: 'Legacy dataset',
  description: '',
  tags: [],
  inputSchema: [],
  items: [{
    Case_ID: 'legacy-1',
    Prompt: 'Legacy prompt',
    ref_1: 'https://example.com/1.jpg',
    ref_2: 'https://example.com/2.jpg',
    ref_3: 'https://example.com/3.jpg',
    _originalData: { source: 'legacy' },
  }],
  createdAt: 1,
  updatedAt: 1,
  columnMappings: {
    caseId: 'Case_ID',
    inputColumns: ['Prompt'],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: ['ref_1', 'ref_2', 'ref_3'],
    standard: {},
  },
};

const legacyColumns = buildDatasetTableColumns(legacyDataset);
assert.deepEqual(
  legacyColumns.map(column => column.key),
  ['Case_ID', 'Prompt', 'ref_1', 'ref_2', 'ref_3'],
  'legacy row fields must remain available without a two-reference cap'
);

console.log('Dataset table column projection tests passed.');
