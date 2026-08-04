import assert from 'node:assert/strict';

import {
  getDatasetActiveColumnKeys,
  getDatasetColumnRole,
  getTaskColumnUsage,
  removeDatasetColumn,
} from '../src/datasetColumnDeletion.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import type { EvalDataset, EvalTask } from '../src/types.ts';

const dataset: EvalDataset = {
  id: 'dataset-delete-column',
  name: 'Column deletion fixture',
  description: '',
  tags: [],
  inputSchema: [
    { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id', sourceKey: 'Case_ID' },
    { key: 'prompt', label: 'prompt', type: 'text', role: 'input', sourceKey: 'Prompt' },
    { key: 'difficulty', label: 'difficulty', type: 'text', role: 'dimension', sourceKey: 'Difficulty' },
    { key: 'generated_video', label: 'generated_video', type: 'video_url', role: 'output', sourceKey: 'generated_video', previewType: 'video' },
    { key: 'generated_video_status', label: 'generated_video_status', type: 'text', role: 'metadata', sourceKey: 'generated_video_status' },
    { key: 'generated_video_seed', label: 'generated_video_seed', type: 'text', role: 'metadata', sourceKey: 'generated_video_seed' },
    { key: 'generated_video_request_id', label: 'generated_video_request_id', type: 'text', role: 'metadata', sourceKey: 'generated_video_request_id' },
    { key: 'generated_video_error', label: 'generated_video_error', type: 'text', role: 'metadata', sourceKey: 'generated_video_error' },
    { key: 'generated_video_params_json', label: 'generated_video_params_json', type: 'text', role: 'system', sourceKey: 'generated_video_params_json' },
  ],
  items: [{
    case_id: 'case-1',
    prompt: 'A test prompt',
    difficulty: 'hard',
    generated_video: 'https://example.com/generated.mp4',
    generated_video_status: 'succeeded',
    generated_video_seed: 42,
    generated_video_request_id: 'request-1',
    generated_video_error: '',
    generated_video_params_json: '{}',
    _originalData: {
      Case_ID: 'case-1',
      Prompt: 'A test prompt',
      generated_video: 'https://example.com/generated.mp4',
    },
    [DATASET_ITEM_ID_KEY]: 'stable-item-1',
  }],
  columnMappings: {
    caseId: 'case_id',
    inputColumns: ['prompt'],
    outputColumns: ['generated_video'],
    dimensionColumns: ['difficulty'],
    referenceColumns: [],
    standard: { case_id: 'case_id', full_prompt: 'prompt' },
  },
  version: 2,
  versionHistory: [],
  createdAt: 1,
  updatedAt: 1,
};

assert.deepEqual(
  getDatasetActiveColumnKeys(dataset),
  [
    'case_id',
    'prompt',
    'difficulty',
    'generated_video',
    'generated_video_status',
    'generated_video_seed',
    'generated_video_request_id',
    'generated_video_error',
    'generated_video_params_json',
  ],
  'active columns must exclude provenance and stable-id fields'
);
assert.equal(getDatasetColumnRole(dataset, 'generated_video'), 'output');

const outputDeletion = removeDatasetColumn(dataset, 'generated_video');
assert.equal(outputDeletion.items[0].generated_video, undefined);
assert.equal(outputDeletion.items[0].generated_video_status, 'succeeded', 'companion metadata must remain');
assert.equal(outputDeletion.items[0].generated_video_seed, 42, 'seed metadata must remain');
assert.equal(outputDeletion.items[0]._originalData.generated_video, 'https://example.com/generated.mp4', 'raw provenance must remain');
assert.equal(outputDeletion.items[0][DATASET_ITEM_ID_KEY], 'stable-item-1', 'stable item id must remain');
assert.equal(outputDeletion.inputSchema.some(field => field.key === 'generated_video'), false);
assert.deepEqual(outputDeletion.columnMappings.outputColumns, []);
assert.equal(dataset.items[0].generated_video, 'https://example.com/generated.mp4', 'source dataset must not be mutated');

const inputDeletion = removeDatasetColumn(dataset, 'prompt');
assert.equal(inputDeletion.items[0].prompt, undefined);
assert.deepEqual(inputDeletion.columnMappings.inputColumns, []);
assert.equal(inputDeletion.columnMappings.standard.full_prompt, undefined);
assert.equal(inputDeletion.items[0]._originalData.Prompt, 'A test prompt');

const caseIdDeletion = removeDatasetColumn(dataset, 'case_id');
assert.equal(caseIdDeletion.columnMappings.caseId, undefined);
assert.equal(caseIdDeletion.columnMappings.standard.case_id, undefined);
assert.equal(caseIdDeletion.items[0][DATASET_ITEM_ID_KEY], 'stable-item-1');

assert.throws(() => removeDatasetColumn(dataset, '_originalData'));
assert.throws(() => removeDatasetColumn(dataset, DATASET_ITEM_ID_KEY));

const task: EvalTask = {
  id: 'task-1',
  name: 'Bound task',
  datasetId: dataset.id,
  datasetBinding: {
    datasetId: dataset.id,
    datasetVersion: 2,
    inputColumns: ['prompt'],
    dimensionColumns: ['difficulty'],
    referenceColumns: [],
    modelColumns: { modelA: 'generated_video' },
  },
  templateId: 'template-1',
  models: [{ id: 'modelA', name: 'generated_video' }],
  dimensionColumns: ['difficulty'],
  outputType: 'video',
  status: 'completed',
  createdAt: 1,
};
assert.deepEqual(getTaskColumnUsage(task, 'prompt'), ['input']);
assert.deepEqual(getTaskColumnUsage(task, 'difficulty'), ['dimension']);
assert.deepEqual(getTaskColumnUsage(task, 'generated_video'), ['output']);

console.log('Dataset column deletion tests passed.');
