import assert from 'node:assert/strict';

import { auditDatasetAgainstModels } from '../server/generation/generationDatasetAudit.ts';
import { normalizeAionModelConfig } from '../server/generation/generationPlanning.ts';
import { ensureStableDatasetItemIds } from '../src/datasetSync.ts';
import { VIDMUSE_STRUCTURED_EVALUATION_COLUMNS } from '../src/features/datasets/preservedSourceImport.ts';
import type { EvalDataset } from '../src/types.ts';

const rows = [
  {
    case_id: 'ready', modality: 'video', prompt: 'A text-only shot.', duration: 5,
    aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
  },
  {
    case_id: 'override', modality: 'video', prompt: 'A text-only shot with an unsupported authored duration.', duration: 7,
    aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
  },
  {
    case_id: 'dataset-error', modality: 'video', prompt: 'Three keyframes are not MCP keyframe input.', duration: 5,
    aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
    image_urls: JSON.stringify([
      'https://cdn.example.com/a.png',
      'https://cdn.example.com/b.png',
      'https://cdn.example.com/c.png',
    ]),
  },
  {
    case_id: 'manual-review', modality: 'video', prompt: 'Ambiguous mixed channels.', duration: 5,
    aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
    image_urls: JSON.stringify(['https://cdn.example.com/start.png']),
    elements: JSON.stringify([{ frontal_image_url: 'https://cdn.example.com/reference.png' }]),
  },
  {
    case_id: 'unsupported', modality: 'video', prompt: 'Use @Element1.', duration: 5,
    aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
    elements: JSON.stringify([{ frontal_image_url: 'https://cdn.example.com/reference.png' }]),
  },
].map(row => Object.fromEntries(VIDMUSE_STRUCTURED_EVALUATION_COLUMNS.map(key => [key, row[key as keyof typeof row] ?? null])));

const dataset: EvalDataset = {
  id: 'ds-audit-test',
  name: 'Compatibility audit test',
  description: '',
  tags: [],
  inputSchema: VIDMUSE_STRUCTURED_EVALUATION_COLUMNS.map(key => ({
    key,
    label: key,
    type: 'text',
    role: key === 'case_id' ? 'case_id' : key === 'prompt' ? 'input' : 'metadata',
    sourceKey: key,
  })),
  items: ensureStableDatasetItemIds('ds-audit-test', rows),
  modality: 'multimodal',
  inputType: 'other',
  columnMappings: {
    caseId: 'case_id',
    inputColumns: ['prompt'],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: ['audio_url', 'image_urls', 'elements'],
    standard: { case_id: 'case_id', full_prompt: 'prompt', audio_url: 'audio_url' },
  },
  createdAt: 1,
  updatedAt: 1,
};

const model = normalizeAionModelConfig({
  id: 'model-config-audit',
  name: 'provider/audit-video',
  display_name: 'Audit Video',
  description: 'Synthetic audit model',
  model_type: 'video',
  provider: 'provider',
  capabilities: {
    text_to_video: true,
    image_to_video: true,
    images_to_video: true,
    reference_to_video: false,
  },
  options: {
    supported_params: [
      'prompt', 'image_urls', 'elements', 'generation_type', 'duration',
      'aspect_ratio', 'resolution', 'generate_audio',
    ],
    duration_options: [5],
    aspect_ratio_options: ['16:9'],
    resolution_options: ['720p'],
    input_schema: {
      supported_inputs: ['prompt', 'image_urls', 'elements'],
      required_inputs: { text_to_video: ['prompt'] },
      required_one_of_inputs: {},
    },
  },
  input_schema: {
    supported_inputs: ['prompt', 'image_urls', 'elements'],
    required_inputs: { text_to_video: ['prompt'] },
    required_one_of_inputs: {},
  },
  price_items: [],
  cost_items: [],
});

const audit = auditDatasetAgainstModels(dataset, [model]);
assert.equal(audit.generationPostRequests, 0);
assert.equal(audit.configFingerprints[model.modelName], model.configFingerprint);
assert.deepEqual(
  Object.fromEntries(audit.cases.map(item => [item.caseId, item.status])),
  {
    ready: 'ready_as_authored',
    override: 'ready_with_explicit_batch_override',
    'dataset-error': 'dataset_error',
    'manual-review': 'manual_contract_review',
    unsupported: 'unsupported_by_model',
  },
);
assert.equal(audit.cases.find(item => item.caseId === 'ready')?.projectionDiff.length, 0);
assert.equal(audit.cases.find(item => item.caseId === 'ready')?.mcpToolInput?.model_name, model.modelName);
assert.equal(audit.cases.find(item => item.caseId === 'ready')?.finalAionRequest?.generation_type, 'text_to_video');
assert.equal(audit.summary.totalEvaluations, 5);

const promptLengthAudit = auditDatasetAgainstModels({
  ...dataset,
  id: 'ds-audit-prompt-length',
  items: ensureStableDatasetItemIds('ds-audit-prompt-length', [rows[0]]).map(item => ({
    ...item,
    prompt: '123456',
  })),
}, [model], {
  [model.modelName]: { promptMaxLength: 5 },
});
const promptLengthCase = promptLengthAudit.cases[0];
assert.equal(promptLengthCase.status, 'unsupported_by_model');
assert.ok(promptLengthCase.errors.some(item => (
  item.code === 'PROMPT_TOO_LONG'
  && item.promptLength?.measuredLength === 6
  && item.promptLength?.maximumLength === 5
)));

console.log('Dataset compatibility audit tests passed.');
