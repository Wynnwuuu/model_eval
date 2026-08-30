import assert from 'node:assert/strict';

import {
  buildDatasetDirectImportPreview,
  compileDirectImportDataset,
  hashDirectImportSnapshot,
} from '../src/datasetDirectImport.ts';
import { parseDatasetSyncManualSource } from '../src/datasetSyncSourceParser.ts';
import { loadDatasetSourceSnapshot } from '../server/datasets/datasetSourceSnapshot.ts';
import { buildDatasetClone } from '../src/datasetClone.ts';

const sourceHeaders = [
  'case_id',
  'variant_label',
  'prompt',
  'elements',
  'duration',
  'model_result',
  'quality_note',
];
const sourceRows = [{
  case_id: 'case-1',
  variant_label: 'reference',
  prompt: 'Create a short reference-driven video.',
  elements: [{ frontal_image_url: 'https://example.com/person.png' }],
  duration: 5,
  model_result: 'https://example.com/result.mp4',
  quality_note: 'keep this column',
}];

const preview = buildDatasetDirectImportPreview({
  headers: sourceHeaders,
  rows: sourceRows,
  snapshotHash: 'snapshot-1',
});

assert.equal(preview.valid, true);
assert.equal(preview.identityMode, 'case_variant');
assert.deepEqual(preview.headers, sourceHeaders);
assert.deepEqual(preview.rows, sourceRows);
assert.equal(preview.columns.length, sourceHeaders.length);
assert.equal(preview.columns.find(column => column.key === 'case_id')?.role, 'case_id');
assert.equal(preview.columns.find(column => column.key === 'prompt')?.role, 'input');
assert.equal(preview.columns.find(column => column.key === 'elements')?.role, 'reference');
assert.equal(preview.columns.find(column => column.key === 'duration')?.usage, 'parameter');
assert.equal(preview.columns.find(column => column.key === 'quality_note')?.role, 'metadata');
assert.equal(preview.columns.find(column => column.key === 'model_result')?.role, 'metadata');
assert.equal(preview.columns.find(column => column.key === 'variant_label')?.outputEligible, false);

const dataset = compileDirectImportDataset({
  id: 'dataset-direct-1',
  preview,
  outputColumns: ['model_result'],
  metadata: {
    name: 'Direct import fixture',
    description: 'Preserves every source column.',
    tags: ['direct-import'],
    modality: 'video',
    categoryPath: ['测试'],
    datasetCard: {
      applicableTasks: [],
      applicableStages: [],
      source: '',
      rubricBinding: '',
      coverageGaps: [],
    },
  },
  actor: { id: 'user-1', name: 'Tester' },
  now: 1_780_000_000_000,
});

assert.deepEqual(dataset.inputSchema.map(field => field.key), sourceHeaders);
assert.deepEqual(dataset.items.map(row => Object.fromEntries(
  Object.entries(row).filter(([key]) => !key.startsWith('__')),
)), sourceRows);
assert.equal(dataset.inputSchema.find(field => field.key === 'model_result')?.role, 'output');
assert.equal(dataset.inputSchema.find(field => field.key === 'model_result')?.previewType, 'video');
assert.deepEqual(dataset.columnMappings?.outputColumns, ['model_result']);
assert.equal(dataset.columnMappings?.standard.prompt, 'prompt');
assert.equal(dataset.columnMappings?.standard.elements, 'elements');
assert.equal(dataset.columnMappings?.standard.duration, 'duration');
assert.deepEqual(dataset.columnMappings?.referenceColumns, ['elements']);
assert.equal(dataset.syncSource, undefined);
assert.deepEqual(dataset.importMetadata, {
  version: 1,
  mode: 'direct',
  identityMode: 'case_variant',
});
assert.ok(dataset.items[0].__datasetItemId, 'direct import must create a hidden stable item ID');

const noCaseIdPreview = buildDatasetDirectImportPreview({
  headers: ['prompt', 'custom'],
  rows: [{ prompt: 'No business ID.', custom: 'preserved' }],
  snapshotHash: 'snapshot-2',
});
assert.equal(noCaseIdPreview.valid, true);
assert.equal(noCaseIdPreview.identityMode, 'internal');
assert.ok(noCaseIdPreview.warnings.some(warning => warning.code === 'MISSING_CASE_ID_COLUMN'));
const noCaseIdDataset = compileDirectImportDataset({
  id: 'dataset-direct-2',
  preview: noCaseIdPreview,
  outputColumns: [],
  metadata: {
    name: 'Static direct import',
    description: '',
    tags: [],
    modality: 'text',
    categoryPath: [],
    datasetCard: {
      applicableTasks: [],
      applicableStages: [],
      source: '',
      rubricBinding: '',
      coverageGaps: [],
    },
  },
  actor: { id: 'user-1', name: 'Tester' },
  now: 1_780_000_000_001,
});
assert.deepEqual(noCaseIdDataset.inputSchema.map(field => field.key), ['prompt', 'custom']);
assert.equal(noCaseIdDataset.items[0].case_id, undefined);
assert.equal(noCaseIdDataset.importMetadata?.identityMode, 'internal');
assert.ok(noCaseIdDataset.items[0].__datasetItemId);
assert.equal(buildDatasetClone(noCaseIdDataset, {
  id: 'dataset-direct-2-copy',
  name: 'Static direct import copy',
  actorId: 'user-2',
  actorName: 'Copy Tester',
}).importMetadata?.identityMode, 'internal');
assert.equal(
  hashDirectImportSnapshot(sourceHeaders, sourceRows),
  hashDirectImportSnapshot([...sourceHeaders], sourceRows.map(row => ({ ...row }))),
);

const duplicateIdentity = buildDatasetDirectImportPreview({
  headers: ['case_id', 'variant_label', 'prompt'],
  rows: [
    { case_id: 'same', variant_label: '', prompt: 'A' },
    { case_id: 'same', variant_label: '', prompt: 'B' },
  ],
  snapshotHash: 'snapshot-3',
});
assert.equal(duplicateIdentity.valid, false);
assert.ok(duplicateIdentity.issues.some(issue => issue.code === 'DUPLICATE_CASE_IDENTITY'));

const missingIdentity = buildDatasetDirectImportPreview({
  headers: ['case_id', 'prompt'],
  rows: [{ case_id: '', prompt: 'Missing ID.' }],
  snapshotHash: 'snapshot-4',
});
assert.equal(missingIdentity.valid, false);
assert.ok(missingIdentity.issues.some(issue => issue.code === 'MISSING_CASE_ID'));

assert.throws(() => buildDatasetDirectImportPreview({
  headers: ['prompt', 'prompt'],
  rows: [{ prompt: 'duplicate header' }],
  snapshotHash: 'snapshot-5',
}), /重复列名/);
assert.throws(() => buildDatasetDirectImportPreview({
  headers: ['prompt', '__datasetItemId'],
  rows: [{ prompt: 'reserved', __datasetItemId: 'forged' }],
  snapshotHash: 'snapshot-6',
}), /保留/);
assert.throws(() => compileDirectImportDataset({
  id: 'dataset-direct-invalid-output',
  preview,
  outputColumns: ['case_id'],
  metadata: {
    name: 'Invalid output',
    description: '',
    tags: [],
    modality: 'video',
    categoryPath: [],
    datasetCard: {
      applicableTasks: [],
      applicableStages: [],
      source: '',
      rubricBinding: '',
      coverageGaps: [],
    },
  },
  actor: { id: 'user-1', name: 'Tester' },
  now: 1_780_000_000_002,
}), /身份列/);
assert.throws(() => compileDirectImportDataset({
  id: 'dataset-direct-invalid-variant-output',
  preview,
  outputColumns: ['variant_label'],
  metadata: {
    name: 'Invalid variant output', description: '', tags: [], modality: 'video', categoryPath: [],
    datasetCard: { applicableTasks: [], applicableStages: [], source: '', rubricBinding: '', coverageGaps: [] },
  },
  actor: { id: 'user-1', name: 'Tester' },
}), /身份列/);

const preservedCsv = parseDatasetSyncManualSource(
  'case_id,prompt,custom\r\n" id-1 "," keep surrounding spaces ",value\r\n',
  'fixture.csv',
);
assert.deepEqual(preservedCsv.headers, ['case_id', 'prompt', 'custom']);
assert.equal(preservedCsv.rows[0].case_id, ' id-1 ');
assert.equal(preservedCsv.rows[0].prompt, ' keep surrounding spaces ');
assert.throws(
  () => parseDatasetSyncManualSource('case_id,prompt,prompt\ncase-1,A,B', 'duplicate.csv'),
  /重复列名/,
);
assert.throws(
  () => parseDatasetSyncManualSource('case_id,,prompt\ncase-1,x,A', 'blank.csv'),
  /空列名/,
);

const manualSnapshot = await loadDatasetSourceSnapshot({
  kind: 'manual',
  headers: sourceHeaders,
  rows: sourceRows,
  label: 'manual fixture',
});
assert.deepEqual(manualSnapshot.headers, sourceHeaders);
assert.deepEqual(manualSnapshot.rows, sourceRows);
assert.equal(manualSnapshot.binding.kind, 'manual');

let receivedBaseUrl = '';
const baseSnapshot = await loadDatasetSourceSnapshot({
  kind: 'feishu_base',
  url: 'https://example.feishu.cn/base/appABC?table=tblXYZ&view=vewIgnored',
}, {
  getTenantAccessToken: async () => 'tenant-token',
  readFeishuSnapshot: async input => {
    receivedBaseUrl = input.sourceUrl;
    assert.equal(input.tenantAccessToken, 'tenant-token');
    return {
      appToken: 'appABC',
      tableId: 'tblXYZ',
      headers: ['case_id', 'prompt'],
      rows: [{ case_id: 'base-1', prompt: 'from Base' }],
    };
  },
});
assert.match(receivedBaseUrl, /view=vewIgnored/);
assert.deepEqual(baseSnapshot.rows, [{ case_id: 'base-1', prompt: 'from Base' }]);
assert.equal(baseSnapshot.binding.kind, 'feishu_base');

console.log('Dataset direct import tests passed.');
