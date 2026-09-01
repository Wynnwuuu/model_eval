import assert from 'node:assert/strict';

import {
  DATASET_RESULT_META_KEY,
  buildDatasetVersionedSyncPlan,
  datasetSyncIdentity,
  validateDatasetSyncSource,
} from '../src/datasetVersionedSync.ts';
import {
  createDatasetItemStableId,
  DATASET_HISTORICAL_CASE_ID_KEY,
  DATASET_ITEM_ID_KEY,
} from '../src/datasetSync.ts';
import { parseDatasetSyncManualSource } from '../src/datasetSyncSourceParser.ts';
import type { EvalDataset } from '../src/types.ts';

const current: EvalDataset = {
  id: 'dataset-sync-v2',
  name: 'Structured evaluation',
  description: '',
  tags: [],
  version: 4,
  createdAt: 1,
  updatedAt: 1,
  inputSchema: [
    { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id' },
    { key: 'variant_label', label: 'variant_label', type: 'text', role: 'metadata' },
    { key: 'prompt', label: 'prompt', type: 'text', role: 'input' },
    { key: 'category', label: 'category', type: 'text', role: 'metadata' },
    { key: 'model_result', label: 'model_result', type: 'video_url', role: 'output', previewType: 'video' },
    { key: 'model_result_notes', label: 'model_result_notes', type: 'text', role: 'metadata' },
  ],
  columnMappings: {
    caseId: 'case_id',
    inputColumns: ['prompt'],
    outputColumns: ['model_result'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: { case_id: 'case_id', prompt: 'prompt' },
  },
  items: [
    {
      case_id: 'case-1',
      variant_label: '',
      prompt: 'old prompt',
      category: 'identity',
      model_result: 'https://cdn.example.com/case-1.mp4',
      model_result_status: 'succeeded',
      model_result_notes: 'source-owned note',
      [DATASET_ITEM_ID_KEY]: 'stable-case-1',
      __futureAuditField: { source: 'platform' },
      [DATASET_RESULT_META_KEY]: {
        model_result: {
          source: 'generation',
          stale: false,
          dependencyColumns: ['prompt'],
        },
      },
    },
    {
      case_id: 'case-delete',
      variant_label: 'baseline',
      prompt: 'delete me',
      model_result: 'https://cdn.example.com/delete.mp4',
      [DATASET_ITEM_ID_KEY]: 'stable-delete',
    },
  ],
};

const historicalRows = [
  {
    case_id: 'case-restored',
    variant_label: 'reference',
    prompt: 'historical prompt',
    model_result: 'https://cdn.example.com/restored.mp4',
    model_result_status: 'succeeded',
    [DATASET_ITEM_ID_KEY]: 'stable-restored',
  },
];

assert.equal(datasetSyncIdentity({ case_id: ' x ', variant_label: ' y ' }), '["x","y"]');
assert.notEqual(
  createDatasetItemStableId('dataset-1', 'a|b', 'c'),
  createDatasetItemStableId('dataset-1', 'a', 'b|c'),
  'identity parts containing separators must remain distinct',
);
const missingIdentityColumnPlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['prompt'],
  sourceRows: [],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'preserve_platform' },
});
assert.equal(missingIdentityColumnPlan.valid, false);
assert.equal(missingIdentityColumnPlan.issues[0]?.code, 'MISSING_CASE_ID_COLUMN');
assert.deepEqual(validateDatasetSyncSource([
  { case_id: 'same', variant_label: '', prompt: 'one' },
  { case_id: 'same', variant_label: '', prompt: 'two' },
]), {
  valid: false,
  issues: [{ code: 'DUPLICATE_CASE_IDENTITY', rowIndexes: [0, 1], identity: 'same / (blank)' }],
});

const pastedTsv = parseDatasetSyncManualSource(
  'case_id\tvariant_label\tprompt\ncase-comma\t\tA subject moves, then stops',
  'clipboard',
);
assert.deepEqual(pastedTsv.headers, ['case_id', 'variant_label', 'prompt']);
assert.equal(pastedTsv.rows[0].prompt, 'A subject moves, then stops', 'commas inside pasted TSV values must not split columns');

const duplicateCurrentPlan = buildDatasetVersionedSyncPlan({
  dataset: {
    ...current,
    items: [current.items[0], { ...current.items[0], [DATASET_ITEM_ID_KEY]: 'duplicate-stable-id' }],
  },
  sourceHeaders: ['case_id', 'variant_label', 'prompt'],
  sourceRows: [{ case_id: 'case-1', variant_label: '', prompt: 'updated' }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'preserve_platform' },
});
assert.equal(duplicateCurrentPlan.valid, false);
assert.equal(duplicateCurrentPlan.issues[0]?.code, 'DUPLICATE_CURRENT_CASE_IDENTITY');

const legacyMappedDataset: EvalDataset = {
  ...current,
  inputSchema: [
    { key: '用例ID', label: '用例ID', canonicalKey: 'case_id', type: 'text', role: 'case_id' },
    ...current.inputSchema.filter(field => field.key !== 'case_id'),
  ],
  columnMappings: {
    ...current.columnMappings,
    caseId: '用例ID',
    standard: { ...current.columnMappings?.standard, case_id: '用例ID' },
  },
  items: [
    { 用例ID: 'legacy-1', variant_label: '', prompt: 'old one', [DATASET_ITEM_ID_KEY]: 'stable-legacy-1' },
    { 用例ID: 'legacy-2', variant_label: '', prompt: 'old two', [DATASET_ITEM_ID_KEY]: 'stable-legacy-2' },
  ],
};
const legacyMappedPlan = buildDatasetVersionedSyncPlan({
  dataset: legacyMappedDataset,
  sourceHeaders: ['case_id', 'variant_label', 'prompt'],
  sourceRows: [
    { case_id: 'legacy-1', variant_label: '', prompt: 'new one' },
    { case_id: 'legacy-2', variant_label: '', prompt: 'old two' },
    { case_id: 'legacy-restored', variant_label: '', prompt: 'restored' },
  ],
  historicalRows: [{
    prompt: 'old restored',
    variant_label: '',
    [DATASET_HISTORICAL_CASE_ID_KEY]: 'legacy-restored',
    [DATASET_ITEM_ID_KEY]: 'stable-legacy-restored',
  }],
  outputColumns: [],
  outputPolicies: {},
});
assert.equal(legacyMappedPlan.valid, true, 'mapped legacy case-ID columns must not collapse to blank identities');
assert.deepEqual(legacyMappedPlan.summary, {
  added: 0,
  updated: 2,
  deleted: 0,
  restored: 1,
  unchanged: 0,
  staleResults: 0,
  sourceResultOverwrites: 0,
  sourceResultFills: 0,
  sourceResultReplacements: 0,
  sourceResultClears: 0,
  outputColumnsPromoted: 0,
  outputColumnsDemoted: 1,
});
assert.deepEqual(
  legacyMappedPlan.rows.map(row => row[DATASET_ITEM_ID_KEY]),
  ['stable-legacy-1', 'stable-legacy-2', 'stable-legacy-restored'],
  'current and historical stable IDs must survive migration to the exact case_id source column',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(legacyMappedPlan.rows[2], DATASET_HISTORICAL_CASE_ID_KEY),
  false,
  'historical lookup metadata must not leak into synchronized rows',
);

const legacyRestoredResultPlan = buildDatasetVersionedSyncPlan({
  dataset: {
    ...current,
    version: 2,
    inputSchema: [
      { key: 'case_id', label: 'case_id', sourceKey: 'case_id', canonicalKey: 'case_id', type: 'text', role: 'case_id' },
      { key: 'variant_label', label: 'variant_label', sourceKey: 'variant_label', canonicalKey: 'variant_label', type: 'text', role: 'metadata' },
      { key: 'prompt', label: 'prompt', sourceKey: 'prompt', canonicalKey: 'prompt', type: 'text', role: 'input' },
      { key: 'duration', label: 'duration', sourceKey: 'duration', canonicalKey: 'duration', type: 'text', role: 'input' },
      { key: 'model_result', label: 'model_result', type: 'video_url', role: 'output', previewType: 'video' },
    ],
    columnMappings: {
      caseId: 'case_id',
      inputColumns: ['prompt', 'duration'],
      outputColumns: ['model_result'],
      dimensionColumns: [],
      referenceColumns: [],
      standard: { case_id: 'case_id', prompt: 'prompt', duration: 'duration' },
    },
    items: [],
  },
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'duration'],
  sourceRows: [{ case_id: 'legacy-restored-result', variant_label: '', prompt: 'same prompt', duration: '5' }],
  historicalRows: [{
    '用例ID': 'legacy-restored-result',
    '完整Prompt': 'same prompt',
    duration: '5',
    _originalData: {
      case_id: 'legacy-restored-result',
      variant_label: '',
      prompt: 'same prompt',
      duration: '5',
      model_result: 'https://cdn.example.com/legacy-restored.mp4',
    },
    model_result: 'https://cdn.example.com/legacy-restored.mp4',
    [DATASET_HISTORICAL_CASE_ID_KEY]: 'legacy-restored-result',
    [DATASET_ITEM_ID_KEY]: 'stable-legacy-restored-result',
  }],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'preserve_platform' },
});
assert.equal(legacyRestoredResultPlan.summary.restored, 1);
assert.equal(
  legacyRestoredResultPlan.rows[0][DATASET_RESULT_META_KEY].model_result.stale,
  false,
  'restoring an unchanged case must not mark its result stale only because mapped column names became source headers',
);
assert.equal(
  legacyRestoredResultPlan.cases[0].fieldChanges.some(change => change.field === '_originalData'),
  false,
  'source audit payloads must not appear as user-facing field changes',
);

const sourceRows = [
  { case_id: 'case-restored', variant_label: 'reference', prompt: 'historical prompt', category: 'restored', model_result: '' },
  { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'identity', model_result: 'https://source.example.com/case-1.mp4' },
  { case_id: 'case-new', variant_label: '', prompt: 'new case', category: 'new', model_result: 'https://source.example.com/new.mp4' },
];

const preservePlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'category', 'model_result'],
  sourceRows,
  historicalRows,
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'preserve_platform' },
});

assert.equal(preservePlan.valid, true);
assert.deepEqual(preservePlan.summary, {
  added: 1,
  updated: 1,
  deleted: 1,
  restored: 1,
  unchanged: 0,
  staleResults: 1,
  sourceResultOverwrites: 0,
  sourceResultFills: 0,
  sourceResultReplacements: 0,
  sourceResultClears: 0,
  outputColumnsPromoted: 0,
  outputColumnsDemoted: 0,
});
assert.deepEqual(preservePlan.rows.map(row => row.case_id), ['case-restored', 'case-1', 'case-new'], 'source order is authoritative');
assert.equal(preservePlan.rows[0][DATASET_ITEM_ID_KEY], 'stable-restored', 're-added identity must restore historical stable ID');
assert.equal(preservePlan.rows[0].model_result, 'https://cdn.example.com/restored.mp4', 'restored platform result must survive');
assert.equal(preservePlan.rows[1][DATASET_ITEM_ID_KEY], 'stable-case-1', 'current identity must retain stable ID');
assert.equal(preservePlan.rows[1].model_result, 'https://cdn.example.com/case-1.mp4', 'default policy must retain platform result');
assert.equal(preservePlan.rows[1].model_result_notes, undefined, 'source-owned columns that only share an output prefix must not be retained');
assert.equal(preservePlan.schema.some(field => field.key === 'model_result_notes'), false);
assert.deepEqual(preservePlan.rows[1].__futureAuditField, { source: 'platform' }, 'platform internal fields must survive sync');
assert.equal(preservePlan.rows[1][DATASET_RESULT_META_KEY].model_result.stale, true, 'generation-input edits must mark retained results stale');
assert.equal(preservePlan.rows[2].model_result, 'https://source.example.com/new.mp4', 'new cases may import a supplied result');
assert.equal(preservePlan.rows[2][DATASET_RESULT_META_KEY].model_result.stale, false);

const nullValuePlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'nullable_metadata'],
  sourceRows: [{ case_id: 'case-1', variant_label: '', prompt: 'old prompt', nullable_metadata: null }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'preserve_platform' },
});
assert.equal(nullValuePlan.rows[0].nullable_metadata, null, 'explicit JSON null values must remain distinct from missing cells');

const metadataOnlyPlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'category', 'model_result'],
  sourceRows: [{ case_id: 'case-1', variant_label: '', prompt: 'old prompt', category: 'changed metadata', model_result: '' }],
  historicalRows,
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'preserve_platform' },
});
assert.equal(metadataOnlyPlan.rows[0][DATASET_RESULT_META_KEY].model_result.stale, false, 'metadata-only edits must not mark output stale');

const fillPlan = buildDatasetVersionedSyncPlan({
  dataset: {
    ...current,
    items: [{ ...current.items[0], model_result: '' }],
  },
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'model_result'],
  sourceRows: [{ case_id: 'case-1', variant_label: '', prompt: 'old prompt', model_result: 'https://source.example.com/fill.mp4' }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'fill_platform_blanks' },
});
assert.equal(fillPlan.rows[0].model_result, 'https://source.example.com/fill.mp4');
assert.equal(fillPlan.summary.sourceResultFills, 1);
assert.equal(fillPlan.summary.sourceResultReplacements, 0);
assert.equal(fillPlan.summary.sourceResultOverwrites, 0, 'filling an empty platform result must not require destructive overwrite confirmation');

const blankFillPlan = buildDatasetVersionedSyncPlan({
  dataset: {
    ...current,
    items: [{
      case_id: 'case-1',
      variant_label: '',
      prompt: 'old prompt',
      category: 'identity',
      model_result: undefined,
      [DATASET_ITEM_ID_KEY]: 'stable-case-1',
    }],
  },
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'category', 'model_result'],
  sourceRows: [{ case_id: 'case-1', variant_label: '', prompt: 'old prompt', category: 'identity', model_result: '' }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'fill_platform_blanks' },
});
assert.equal(blankFillPlan.summary.updated, 0, 'missing and blank output cells must not create false case updates');
assert.equal(blankFillPlan.summary.unchanged, 1);

const overwritePlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'model_result'],
  sourceRows: [{ case_id: 'case-1', variant_label: '', prompt: 'old prompt', model_result: '' }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'source_overwrite' },
});
assert.equal(overwritePlan.rows[0].model_result, '', 'source overwrite must include blank cells');
assert.equal(overwritePlan.summary.sourceResultOverwrites, 1);

const mergePlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'model_result'],
  sourceRows: [
    { case_id: 'case-1', variant_label: '', prompt: 'merged prompt', model_result: 'https://source.example.com/merged.mp4' },
    { case_id: 'case-new', variant_label: '', prompt: 'new case', model_result: '' },
  ],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'source_overwrite' },
  syncMode: 'merge',
});
assert.deepEqual(
  mergePlan.rows.map(row => row.case_id),
  ['case-1', 'case-delete', 'case-new'],
  'merge synchronization must preserve existing order and append new cases in source order',
);
assert.equal(mergePlan.summary.deleted, 0, 'merge synchronization must retain cases omitted from the source');
assert.equal(mergePlan.rows[0].category, 'identity', 'merge synchronization must retain existing columns omitted from the source');

const overwrittenRow = mergePlan.rows[0];
assert.equal(overwrittenRow.model_result, 'https://source.example.com/merged.mp4');
assert.equal(
  Object.prototype.hasOwnProperty.call(overwrittenRow, 'model_result_status'),
  false,
  'replacing a result from the source must clear generation records that describe the previous result',
);
assert.equal(overwrittenRow[DATASET_RESULT_META_KEY].model_result.source, 'source');
assert.equal(overwrittenRow[DATASET_RESULT_META_KEY].model_result.stale, false);

const unchangedResultWithChangedInputPlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'model_result'],
  sourceRows: [{
    case_id: 'case-1',
    variant_label: '',
    prompt: 'changed prompt',
    model_result: 'https://cdn.example.com/case-1.mp4',
  }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'source_overwrite' },
  syncMode: 'merge',
});
assert.equal(
  unchangedResultWithChangedInputPlan.rows[0][DATASET_RESULT_META_KEY].model_result.stale,
  true,
  'selecting source authority must not mark an unchanged result fresh after its inputs change',
);
assert.equal(
  unchangedResultWithChangedInputPlan.rows[0].model_result_status,
  'succeeded',
  'an unchanged result must retain its matching generation record',
);

const demotedOutputPlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'model_result'],
  sourceRows: [{
    case_id: 'case-1',
    variant_label: '',
    prompt: 'old prompt',
    model_result: 'https://cdn.example.com/case-1.mp4',
  }],
  historicalRows: [],
  outputColumns: [],
  outputPolicies: {},
  syncMode: 'merge',
});
assert.equal(demotedOutputPlan.rows[0].model_result, 'https://cdn.example.com/case-1.mp4');
assert.equal(
  Object.prototype.hasOwnProperty.call(demotedOutputPlan.rows[0], 'model_result_status'),
  false,
  'demoting an output to a data column must remove its current generation records',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(demotedOutputPlan.rows[0], DATASET_RESULT_META_KEY),
  false,
  'demoting an output to a data column must remove its current result freshness metadata',
);

const ignoredCompanionPlan = buildDatasetVersionedSyncPlan({
  dataset: current,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'model_result', 'model_result_status'],
  sourceRows: [{
    case_id: 'case-1',
    variant_label: '',
    prompt: 'old prompt',
    model_result: 'https://source.example.com/replacement.mp4',
    model_result_status: 'forged-source-status',
  }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'source_overwrite' },
  syncMode: 'merge',
});
assert.deepEqual(ignoredCompanionPlan.ignoredSourceColumns, ['model_result_status']);
assert.equal(
  Object.prototype.hasOwnProperty.call(ignoredCompanionPlan.rows[0], 'model_result_status'),
  false,
  'source generation-record columns must not be imported as trusted platform audit data',
);

const noChangeDataset: EvalDataset = {
  ...current,
  inputSchema: current.inputSchema.filter(field => field.key !== 'model_result_notes'),
  items: [current.items[0]],
};
const noChangePlan = buildDatasetVersionedSyncPlan({
  dataset: noChangeDataset,
  sourceHeaders: ['case_id', 'variant_label', 'prompt', 'category', 'model_result'],
  sourceRows: [{
    case_id: 'case-1',
    variant_label: '',
    prompt: 'old prompt',
    category: 'identity',
    model_result: 'https://cdn.example.com/case-1.mp4',
  }],
  historicalRows: [],
  outputColumns: ['model_result'],
  outputPolicies: { model_result: 'preserve_platform' },
  syncMode: 'merge',
});
assert.equal(noChangePlan.hasChanges, false, 'an identical merge must not create an empty dataset version');

console.log('Versioned dataset synchronization tests passed.');
