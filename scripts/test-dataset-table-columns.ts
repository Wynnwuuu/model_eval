import assert from 'node:assert/strict';

import {
  buildDatasetTableColumns,
  getTaskBuilderDatasetColumns,
  getVisibleDatasetTableColumns,
} from '../src/datasetTableColumns';
import { inferOutputTypeFromDataset } from '../src/datasetManifest';
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
const GENERATED_OUTPUT = 'MiniMax-H3';
const MAPPED_OUTPUT = 'Seedance 2.0 Pro';
const GENERATION_COMPANION_COLUMNS = [
  `${GENERATED_OUTPUT}_status`,
  `${GENERATED_OUTPUT}_seed`,
  `${GENERATED_OUTPUT}_request_id`,
  `${GENERATED_OUTPUT}_error`,
  `${GENERATED_OUTPUT}_params_json`,
];

const referenceImageColumns = Array.from({ length: 6 }, (_, index) => `${REFERENCE_IMAGE}_${index + 1}_URL`);
const referenceVideoColumns = Array.from({ length: 3 }, (_, index) => `${REFERENCE_VIDEO}_${index + 1}_URL`);
const referenceAudioColumn = `${REFERENCE_AUDIO}_1_URL`;

const schema: DatasetSchemaField[] = [
  { key: CASE_ID, label: CASE_ID, type: 'text', role: 'case_id', sourceKey: 'Case_ID' },
  { key: FULL_PROMPT, label: FULL_PROMPT, type: 'text', role: 'input', sourceKey: 'Prompt' },
  { key: EXTRA_INPUT, label: EXTRA_INPUT, type: 'text', role: 'input', sourceKey: 'Extra_Input' },
  { key: GENERATED_OUTPUT, label: GENERATED_OUTPUT, type: 'video_url', role: 'output', previewType: 'video' },
  { key: MAPPED_OUTPUT, label: MAPPED_OUTPUT, type: 'video_url', role: 'metadata', previewType: 'video' },
  ...GENERATION_COMPANION_COLUMNS.map((key): DatasetSchemaField => ({
    key,
    label: key,
    type: 'text',
    role: key.endsWith('_params_json') ? 'system' : 'metadata',
    previewType: 'text',
  })),
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
  { key: 'status', label: 'status', type: 'text', role: 'metadata', previewType: 'text' },
  { key: `${GENERATED_OUTPUT}_status_note`, label: `${GENERATED_OUTPUT}_status_note`, type: 'text', role: 'metadata', previewType: 'text' },
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
    outputColumns: [GENERATED_OUTPUT, MAPPED_OUTPUT],
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
assert.equal(columns.find(column => column.key === GENERATED_OUTPUT)?.displayCategory, 'output');
assert.equal(columns.find(column => column.key === MAPPED_OUTPUT)?.role, 'output', 'output mappings must override a stale schema role');
assert.equal(columns.find(column => column.key === MAPPED_OUTPUT)?.displayCategory, 'output');
for (const key of GENERATION_COMPANION_COLUMNS) {
  assert.equal(columns.find(column => column.key === key)?.displayCategory, 'generation_companion', `${key} must be grouped as a generation record`);
}
assert.equal(columns.find(column => column.key === 'status')?.displayCategory, 'business', 'ordinary status metadata must not be hidden');
assert.equal(columns.find(column => column.key === `${GENERATED_OUTPUT}_status_note`)?.displayCategory, 'business', 'similar suffixes must not be misclassified');

const defaultVisible = getVisibleDatasetTableColumns(columns);
assert.ok(defaultVisible.some(column => column.key === EXTRA_INPUT), 'additional inputs must be visible');
assert.ok(defaultVisible.some(column => column.key === referenceImageColumns[5]), 'references after the second column must be visible');
assert.ok(defaultVisible.some(column => column.key === referenceVideoColumns[2]), 'later reference videos must be visible');
assert.ok(defaultVisible.some(column => column.key === referenceAudioColumn), 'reference audio must be visible');
assert.ok(defaultVisible.some(column => column.key === OBSERVATION_FOCUS), 'ordinary metadata must be visible');
assert.ok(defaultVisible.some(column => column.key === 'status'), 'ordinary status metadata must remain visible');
assert.ok(defaultVisible.some(column => column.key === `${GENERATED_OUTPUT}_status_note`), 'non-exact companion suffixes must remain visible');
assert.ok(!defaultVisible.some(column => column.key === PARAMS_JSON), 'system fields must be hidden by default');
assert.ok(defaultVisible.some(column => column.key === GENERATED_OUTPUT), 'schema output fields must be visible by default');
assert.ok(defaultVisible.some(column => column.key === MAPPED_OUTPUT), 'mapped output fields must be visible by default');
for (const key of GENERATION_COMPANION_COLUMNS) {
  assert.ok(!defaultVisible.some(column => column.key === key), `${key} must be hidden by default`);
}

const systemVisible = getVisibleDatasetTableColumns(columns, { [PARAMS_JSON]: true });
assert.ok(systemVisible.some(column => column.key === PARAMS_JSON), 'visibility overrides must reveal system fields');

const outputHidden = getVisibleDatasetTableColumns(columns, { [GENERATED_OUTPUT]: false });
assert.ok(!outputHidden.some(column => column.key === GENERATED_OUTPUT), 'an explicit user override must still hide an output');
assert.ok(outputHidden.some(column => column.key === MAPPED_OUTPUT), 'hiding one output must not hide other default-visible outputs');

const companionVisible = getVisibleDatasetTableColumns(columns, { [GENERATION_COMPANION_COLUMNS[0]]: true });
assert.ok(companionVisible.some(column => column.key === GENERATION_COMPANION_COLUMNS[0]), 'an explicit user override must reveal a generation record');
assert.ok(!companionVisible.some(column => column.key === GENERATION_COMPANION_COLUMNS[1]), 'revealing one generation record must not reveal all records');

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

const SPARSE_OUTPUT = 'generated_result';
const sparseGeneratedDataset: EvalDataset = {
  id: 'sparse-generated-dataset',
  name: 'Sparse generated dataset',
  description: '',
  tags: [],
  inputSchema: [
    { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id' },
    { key: 'prompt', label: 'prompt', type: 'text', role: 'input' },
    { key: SPARSE_OUTPUT, label: SPARSE_OUTPUT, type: 'video_url', role: 'output', previewType: 'video' },
    { key: `${SPARSE_OUTPUT}_status`, label: `${SPARSE_OUTPUT}_status`, type: 'text', role: 'metadata' },
    { key: `${SPARSE_OUTPUT}_seed`, label: `${SPARSE_OUTPUT}_seed`, type: 'text', role: 'metadata' },
    { key: `${SPARSE_OUTPUT}_request_id`, label: `${SPARSE_OUTPUT}_request_id`, type: 'text', role: 'metadata' },
    { key: `${SPARSE_OUTPUT}_error`, label: `${SPARSE_OUTPUT}_error`, type: 'text', role: 'metadata' },
    { key: `${SPARSE_OUTPUT}_params_json`, label: `${SPARSE_OUTPUT}_params_json`, type: 'text', role: 'system' },
    { key: `${SPARSE_OUTPUT}_status_note`, label: `${SPARSE_OUTPUT}_status_note`, type: 'text', role: 'metadata' },
    { key: 'system_trace', label: 'system_trace', type: 'text', role: 'system' },
  ],
  items: [
    {
      case_id: 'sparse-1',
      prompt: 'The first selected generation failed.',
      [`${SPARSE_OUTPUT}_status`]: 'failed',
      [`${SPARSE_OUTPUT}_error`]: 'provider rejected the case',
      __datasetItemId: 'sparse-item-1',
    },
    {
      case_id: 'sparse-2',
      prompt: 'The later case succeeded.',
      [SPARSE_OUTPUT]: 'https://example.com/generated-2.mp4',
      [`${SPARSE_OUTPUT}_status`]: 'succeeded',
      [`${SPARSE_OUTPUT}_status_note`]: 'ordinary business note',
      late_business_column: 'present only after row zero',
      __datasetItemId: 'sparse-item-2',
    },
  ],
  createdAt: 1,
  updatedAt: 2,
  version: 2,
  columnMappings: {
    caseId: 'case_id',
    inputColumns: ['prompt'],
    outputColumns: [SPARSE_OUTPUT],
    dimensionColumns: [],
    referenceColumns: [],
    standard: { case_id: 'case_id', full_prompt: 'prompt' },
  },
};

const taskBuilderColumns = getTaskBuilderDatasetColumns(sparseGeneratedDataset);
assert.deepEqual(
  taskBuilderColumns,
  ['case_id', 'prompt', SPARSE_OUTPUT, `${SPARSE_OUTPUT}_status_note`, 'late_business_column'],
  'material mapping must combine schema and every sparse row while hiding generation audit and system fields',
);
assert.ok(taskBuilderColumns.includes(SPARSE_OUTPUT), 'a schema output must remain selectable when row zero has no result cell');
assert.ok(!taskBuilderColumns.some(column => column.startsWith('__')), 'internal dataset fields must never enter material mapping');

const mixedOutputDataset: EvalDataset = {
  ...sparseGeneratedDataset,
  id: 'mixed-output-dataset',
  inputSchema: [
    ...sparseGeneratedDataset.inputSchema,
    { key: 'old_image_result', label: 'old_image_result', type: 'image_url', role: 'output', previewType: 'image' },
    { key: 'audio_result', label: 'audio_result', type: 'audio_url', role: 'output', previewType: 'audio' },
  ],
  columnMappings: {
    ...sparseGeneratedDataset.columnMappings!,
    outputColumns: ['old_image_result', SPARSE_OUTPUT, 'audio_result'],
  },
};
assert.equal(
  inferOutputTypeFromDataset(mixedOutputDataset, [SPARSE_OUTPUT]),
  'video',
  'generation prefill must infer output type from the requested result instead of the oldest output',
);
assert.equal(
  inferOutputTypeFromDataset(mixedOutputDataset, ['audio_result']),
  'audio',
  'audio result columns must default to the audio renderer',
);

console.log('Dataset table column projection tests passed.');
