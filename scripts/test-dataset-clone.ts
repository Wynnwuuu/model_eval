import assert from 'node:assert/strict';

import { buildDatasetClone } from '../src/datasetClone';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync';
import type { EvalDataset } from '../src/types';

const source: EvalDataset = {
  id: 'dataset-source',
  name: '视频生成评测集',
  description: '用于验证评测集副本',
  tags: ['video', 'regression'],
  inputType: 'text_image',
  modality: 'video',
  categoryPath: ['视频', '文生视频'],
  inputSchema: [
    { key: '用例ID', label: '用例ID', type: 'text', role: 'case_id' },
    { key: '完整Prompt', label: '完整Prompt', type: 'text', role: 'input' },
    { key: 'model_a', label: 'model_a', type: 'video_url', role: 'output', previewType: 'video' },
  ],
  standardFields: [
    { canonicalKey: 'case_id', label: '用例ID', role: 'case_id', type: 'text' },
  ],
  columnMappings: {
    caseId: '用例ID',
    inputColumns: ['完整Prompt'],
    outputColumns: ['model_a'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: { case_id: '用例ID', prompt: '完整Prompt' },
  },
  items: [{
    [DATASET_ITEM_ID_KEY]: 'dataset-source:item:case-1',
    用例ID: 'case-1',
    完整Prompt: 'A paper boat crossing a river',
    model_a: 'https://example.com/model-a.mp4',
    _originalData: { Case_ID: 'case-1', Prompt: 'A paper boat crossing a river' },
    nested: { controls: { duration: 5 } },
  }],
  datasetCard: {
    applicableTasks: ['视频生成'],
    applicableStages: ['回归'],
    source: '人工整理',
    sampleSize: 1,
    modality: 'video',
    tagDistribution: { video: 1 },
    dimensionDistribution: {},
    rubricBinding: 'video-quality-v1',
    coverageGaps: ['长视频'],
    latestChange: '源评测集最新变更',
    updatedAt: 1_700_000_000_000,
  },
  validationSummary: {
    status: 'ok',
    missingCaseIdCount: 0,
    duplicateCaseIdCount: 0,
    invalidUrlCount: 0,
    missingInputCount: 0,
    emptyOutputCells: 0,
    dimensionDistribution: {},
    warnings: [],
  },
  syncSummary: {
    projects: 1,
    tasks: 2,
    taskItemsUpdated: 3,
    taskItemsAdded: 0,
    taskItemsArchived: 0,
    votesUpdated: 4,
    votesArchived: 0,
    warnings: [],
  },
  version: 7,
  versionHistory: [
    { version: 1, changedAt: 1, changedBy: 'Alice', changeSummary: '创建', itemCountBefore: 0, itemCountAfter: 1 },
    { version: 7, changedAt: 7, changedBy: 'Bob', changeSummary: '修改', itemCountBefore: 1, itemCountAfter: 1 },
  ],
  versionSnapshots: {
    '1': { version: 1, inputSchema: [], items: [], updatedAt: 1 },
  },
  creatorUid: 'source-owner',
  creatorName: 'Source Owner',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
};

const sourceBefore = structuredClone(source);
const copiedAt = 1_800_000_000_000;
const clone = buildDatasetClone(source, {
  id: 'dataset-clone',
  name: '视频生成评测集 - 副本',
  actorId: 'copy-user',
  actorName: 'Copy User',
  now: copiedAt,
});

assert.deepEqual(source, sourceBefore, 'building a clone must not mutate the source snapshot');
assert.equal(clone.id, 'dataset-clone');
assert.equal(clone.name, '视频生成评测集 - 副本');
assert.deepEqual(clone.tags, source.tags);
assert.deepEqual(clone.inputSchema, source.inputSchema);
assert.deepEqual(clone.standardFields, source.standardFields);
assert.deepEqual(clone.columnMappings, source.columnMappings);
assert.deepEqual(clone.validationSummary, source.validationSummary);
assert.equal(clone.items[0].用例ID, source.items[0].用例ID, 'visible case IDs must be preserved');
assert.equal(clone.items[0].model_a, source.items[0].model_a, 'media URLs must be copied by value');
assert.notEqual(clone.items[0][DATASET_ITEM_ID_KEY], source.items[0][DATASET_ITEM_ID_KEY]);
assert.match(clone.items[0][DATASET_ITEM_ID_KEY], /^dataset-clone:item:/);
assert.equal(clone.version, 1);
assert.equal(clone.versionHistory?.length, 1);
assert.equal(clone.versionHistory?.[0].changedBy, 'Copy User');
assert.equal(clone.versionHistory?.[0].itemCountBefore, 0);
assert.equal(clone.versionHistory?.[0].itemCountAfter, 1);
assert.equal(clone.syncSummary, undefined);
assert.equal(clone.versionSnapshots, undefined);
assert.deepEqual(clone.copiedFrom, {
  datasetId: source.id,
  datasetName: source.name,
  datasetVersion: 7,
  copiedAt,
});
assert.equal(clone.datasetCard?.source, source.datasetCard?.source);
assert.equal(clone.datasetCard?.sampleSize, 1);
assert.equal(clone.datasetCard?.updatedAt, copiedAt);
assert.match(clone.datasetCard?.latestChange || '', /复制自「视频生成评测集」v7/);
assert.equal(clone.createdAt, copiedAt);
assert.equal(clone.updatedAt, copiedAt);
assert.equal(clone.creatorUid, 'copy-user');
assert.equal(clone.creatorName, 'Copy User');

clone.items[0].nested.controls.duration = 10;
clone.items[0]._originalData.Prompt = 'changed in clone';
clone.inputSchema[0].label = 'Changed label';
clone.datasetCard!.coverageGaps.push('new gap');
assert.equal(source.items[0].nested.controls.duration, 5, 'nested case data must be independent');
assert.equal(source.items[0]._originalData.Prompt, 'A paper boat crossing a river');
assert.equal(source.inputSchema[0].label, '用例ID');
assert.deepEqual(source.datasetCard?.coverageGaps, ['长视频']);

console.log('Dataset clone tests passed.');
