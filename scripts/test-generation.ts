import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  buildAionGenerationRequest,
  compileGenerationReferenceVideoInputs,
  estimateGenerationCost,
  fingerprintConfig,
  matchUploadedAsset,
  normalizeAionModelConfig,
  preflightGenerationCase,
  resolveGenerationImageInputs,
} from '../server/generation/generationPlanning.ts';
import {
  AionGenerationClient,
  aionUserAssetPathToUrl,
  buildTaskWorkerSubmission,
  normalizeTaskWorkerTask,
  taskWorkerFilePathToUrl,
} from '../server/generation/aionGenerationClient.ts';
import {
  generationPollPhase,
  generationSubmissionErrorDiagnostics,
  archivedGenerationResult,
  normalizeProviderPayload,
  providerResult,
  unarchivedGenerationResult,
} from '../server/generation/generationWorker.ts';
import { createByteLimitStream, generationAssetService } from '../server/generation/generationAssetService.ts';
import {
  buildGenerationCasesForPreflight,
  validateDurationSourceConfiguration,
} from '../server/generation/generationPreflightService.ts';
import { inferDatasetMappings } from '../src/datasetManifest.ts';
import {
  defaultGenerationInputMapping,
  getGenerationImageRole,
  inferGenerationImageRole,
  setGenerationImageRole,
} from '../src/features/generation/inputMapping.ts';
import {
  getGenerationReferenceVideoSupport,
  getSupportedGenerationImageRoles,
} from '../src/features/generation/modelCapabilities.ts';
import {
  probeAudioDurations,
  resolveReferenceAudioDuration,
} from '../src/features/generation/audioDuration.ts';
import {
  inspectGenerationTargetColumn,
  resolveGenerationCaseSelection,
} from '../src/features/generation/caseSelection.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import { uniqueGenerationReferences } from '../src/features/generation/mediaReferences.ts';
import {
  computeGenerationConcurrencyPolicy,
  parseGenerationVideoModelLimits,
  resolveGenerationVideoModelLimit,
} from '../server/generation/generationConcurrencyPolicy.ts';
import {
  generationValidationForModel,
  parseGenerationModelValidationOverrides,
} from '../server/generation/generationValidationPolicy.ts';

const capacityFailure = (code: string, message: string, httpStatus?: number) => ({
  status: 'failed',
  error: { code, message, httpStatus },
});
const successfulOutcome = () => ({ status: 'succeeded', error: {} });
const concurrencyLimit = { min: 1, initial: 1, max: 6 };

assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, []).effectiveLimit, 1,
  'a model without recent capacity evidence must use its initial limit');
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, [successfulOutcome()]).effectiveLimit, 1);
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, Array.from({ length: 3 }, successfulOutcome)).effectiveLimit, 2);
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, Array.from({ length: 6 }, successfulOutcome)).effectiveLimit, 3);
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, [
  capacityFailure('GENERATION_TIMEOUT', 'Generation timed out.'),
  ...Array.from({ length: 12 }, successfulOutcome),
]).effectiveLimit, 1, 'the newest capacity failure must immediately reset capacity to the minimum');
assert.equal(computeGenerationConcurrencyPolicy(concurrencyLimit, [
  ...Array.from({ length: 3 }, successfulOutcome),
  capacityFailure('PROVIDER_FAILED', 'Provider overloaded.'),
]).effectiveLimit, 2, 'three successes after the latest capacity failure may restore one slot');

const deterministicFailures = [
  capacityFailure('AION_SUBMIT_REJECTED', 'Wan3 seed must be an integer between 0 and 2147483647', 400),
  capacityFailure('AION_SUBMIT_REJECTED', 'Prompt is too long', 400),
  capacityFailure('PROVIDER_FAILED', 'Content policy rejection'),
];
const ignoredDeterministic = computeGenerationConcurrencyPolicy(concurrencyLimit, [
  ...deterministicFailures,
  ...Array.from({ length: 6 }, successfulOutcome),
]);
assert.equal(ignoredDeterministic.sampleSize, 6);
assert.equal(ignoredDeterministic.capacityFailures, 0);
assert.equal(ignoredDeterministic.effectiveLimit, 3);

const configuredModelLimits = parseGenerationVideoModelLimits(JSON.stringify({
  default: { min: 1, initial: 1, max: 4 },
  models: { 'wan/wan3.0-video': { min: 1, initial: 1, max: 6 } },
}), 8);
assert.deepEqual(resolveGenerationVideoModelLimit(configuredModelLimits, 'wan/wan3.0-video'), { min: 1, initial: 1, max: 6 });
assert.deepEqual(resolveGenerationVideoModelLimit(configuredModelLimits, 'future/video-model'), { min: 1, initial: 1, max: 4 });
assert.throws(() => parseGenerationVideoModelLimits('{broken', 8), /valid JSON/);
assert.throws(() => parseGenerationVideoModelLimits(JSON.stringify({
  default: { min: 1, initial: 5, max: 4 }, models: {},
}), 8), /minimum/);

const validationOverrides = parseGenerationModelValidationOverrides(JSON.stringify({
  'wan/wan3.0-video': { promptMaxLength: 5000 },
}));
assert.deepEqual(validationOverrides['wan/wan3.0-video'], { promptMaxLength: 5000 });
assert.throws(() => parseGenerationModelValidationOverrides(JSON.stringify({
  'wan/wan3.0-video': { promptMaxLength: 0 },
})), /positive integer/);

const selectionRows = [
  { [DATASET_ITEM_ID_KEY]: 'item-1', case_id: 'case-1', prompt: 'One' },
  { [DATASET_ITEM_ID_KEY]: 'item-2', case_id: 'case-2', prompt: 'Two' },
  { [DATASET_ITEM_ID_KEY]: 'item-3', case_id: 'case-3', prompt: 'Three' },
];
assert.equal(generationPollPhase({
  status: 'processing',
  now: 1_500,
  timeoutAt: 1_000,
}), 'start_reconciling');
assert.equal(generationPollPhase({
  status: 'reconciling',
  now: 1_500,
  timeoutAt: 1_000,
  reconciliationDeadlineAt: 2_000,
}), 'reconciling');
assert.equal(generationPollPhase({
  status: 'reconciling',
  now: 2_000,
  timeoutAt: 1_000,
  reconciliationDeadlineAt: 2_000,
}), 'expired');

assert.deepEqual(generationSubmissionErrorDiagnostics(Object.assign(new Error('service unavailable'), {
  status: 503,
})), {
  httpStatus: 503,
  errorName: 'Error',
  definitelyRejected: false,
});
assert.equal(generationSubmissionErrorDiagnostics(Object.assign(new Error('bad request'), {
  status: 400,
})).definitelyRejected, true);
assert.deepEqual(generationSubmissionErrorDiagnostics(Object.assign(new Error('connection refused'), {
  cause: { code: 'ECONNREFUSED' },
})), {
  errorName: 'Error',
  transportCode: 'ECONNREFUSED',
  definitelyRejected: false,
});
assert.equal(generationSubmissionErrorDiagnostics(Object.assign(new Error('unsafe code'), {
  code: 'https://internal.example/path with spaces',
})).transportCode, undefined, 'diagnostics must not expose arbitrary error text as a transport code');



const legacyFullSelection = resolveGenerationCaseSelection(selectionRows);
assert.deepEqual(legacyFullSelection.rows.map(item => item.datasetItemId), ['item-1', 'item-2', 'item-3']);
assert.deepEqual(legacyFullSelection.errors, []);

const subsetSelection = resolveGenerationCaseSelection(selectionRows, ['item-3', 'item-1']);
assert.deepEqual(subsetSelection.rows.map(item => item.datasetItemId), ['item-1', 'item-3']);
assert.deepEqual(subsetSelection.normalizedIds, ['item-1', 'item-3']);
assert.deepEqual(subsetSelection.errors, []);

const reorderedSubset = resolveGenerationCaseSelection(selectionRows, ['item-1', 'item-3']);
assert.deepEqual(reorderedSubset.normalizedIds, subsetSelection.normalizedIds);
assert.equal(
  fingerprintConfig({ selectedDatasetItemIds: reorderedSubset.normalizedIds }),
  fingerprintConfig({ selectedDatasetItemIds: subsetSelection.normalizedIds }),
);
assert.notEqual(
  fingerprintConfig({ selectedDatasetItemIds: subsetSelection.normalizedIds }),
  fingerprintConfig({ selectedDatasetItemIds: ['item-2'] }),
);
assert.deepEqual(uniqueGenerationReferences([
  'https://assets.example.com/first.mp4;https://assets.example.com/second.mp4',
  '["https://assets.example.com/third.mp4", "https://assets.example.com/first.mp4"]',
]), [
  'https://assets.example.com/first.mp4',
  'https://assets.example.com/second.mp4',
  'https://assets.example.com/third.mp4',
]);


assert.ok(resolveGenerationCaseSelection(selectionRows, []).errors.some(issue => issue.code === 'EMPTY_SELECTION'));
assert.ok(resolveGenerationCaseSelection(selectionRows, ['missing']).errors.some(issue => issue.code === 'UNKNOWN_SELECTED_ITEM_ID'));
assert.ok(resolveGenerationCaseSelection(selectionRows, ['item-1', 'item-1']).errors.some(issue => issue.code === 'DUPLICATE_SELECTED_ITEM_ID'));

const generatedDataset = {
  inputSchema: [
    { key: 'generated_video', label: 'generated_video', type: 'video_url', role: 'output', previewType: 'video' },
  ],
  columnMappings: {
    inputColumns: ['prompt'],
    outputColumns: ['generated_video'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: {},
  },
  items: [
    {
      [DATASET_ITEM_ID_KEY]: 'item-1',
      generated_video: 'https://assets.example.com/one.mp4',
      generated_video_params_json: JSON.stringify({ modelName: 'provider/video-pro', configFingerprint: 'old-fingerprint' }),
    },
    { [DATASET_ITEM_ID_KEY]: 'item-2', generated_video: '' },
  ],
} as any;

assert.ok(inspectGenerationTargetColumn(generatedDataset, {
  mode: 'new',
  targetColumn: 'generated_video',
  modelName: 'provider/video-pro',
  outputModality: 'video',
}).errors.some(issue => issue.code === 'TARGET_COLUMN_EXISTS'));

const fillTarget = inspectGenerationTargetColumn(generatedDataset, {
  mode: 'fill_existing',
  targetColumn: 'generated_video',
  modelName: 'provider/video-pro',
  outputModality: 'video',
  configFingerprint: 'new-fingerprint',
});
assert.equal(fillTarget.completedCount, 1);
assert.equal(fillTarget.emptyCount, 1);
assert.deepEqual(fillTarget.errors, []);
assert.ok(fillTarget.warnings.some(issue => issue.code === 'TARGET_CONFIG_CHANGED'));

assert.ok(inspectGenerationTargetColumn(generatedDataset, {
  mode: 'fill_existing',
  targetColumn: 'generated_video',
  modelName: 'provider/other-video',
  outputModality: 'video',
}).errors.some(issue => issue.code === 'TARGET_MODEL_MISMATCH'));

assert.ok(inspectGenerationTargetColumn(generatedDataset, {
  mode: 'fill_existing',
  targetColumn: 'generated_video',
  modelName: 'provider/video-pro',
  outputModality: 'image',
}).errors.some(issue => issue.code === 'TARGET_MODALITY_MISMATCH'));

const generatedMetadataMappings = inferDatasetMappings(
  ['case_id', 'model_output_request_id'],
  [{ case_id: 'case-1', model_output_request_id: 'request-1' }],
);
assert.equal(generatedMetadataMappings.caseId, 'case_id');
assert.equal(generatedMetadataMappings.standard.case_id, 'case_id');

const mappingDataset = {
  inputSchema: [
    { key: '完整Prompt', label: '完整Prompt', type: 'text', canonicalKey: 'full_prompt' },
    { key: '参考图_URLs', label: '参考图_URLs', type: 'image_url', previewType: 'image', canonicalKey: 'reference_image_urls' },
    { key: '首帧图_URL', label: '首帧图_URL', type: 'image_url', previewType: 'image', canonicalKey: 'start_image_url' },
    { key: '尾帧图_URL', label: '尾帧图_URL', type: 'image_url', previewType: 'image', canonicalKey: 'end_image_url' },
    { key: '音频_URL', label: '音频_URL', type: 'audio_url', previewType: 'audio', canonicalKey: 'audio_url' },
  ],
  items: [],
} as any;
const mappingHeaders = mappingDataset.inputSchema.map((field: { key: string }) => field.key);
const emptyMediaMapping = defaultGenerationInputMapping(
  mappingDataset,
  mappingHeaders,
  { standard: { full_prompt: '完整Prompt' }, inputColumns: [], outputColumns: [], dimensionColumns: [], referenceColumns: [] },
);
assert.equal(emptyMediaMapping.promptColumn, '完整Prompt');
assert.deepEqual(emptyMediaMapping.referenceImageColumns, []);
assert.deepEqual(emptyMediaMapping.referenceAudioColumns, []);
assert.deepEqual(emptyMediaMapping.referenceVideoColumns, []);
assert.equal(emptyMediaMapping.startImageColumn, '');
assert.equal(emptyMediaMapping.endImageColumn, '');
assert.equal(emptyMediaMapping.mappingMode, 'mcp');
assert.equal(emptyMediaMapping.compatibilityMode, 'strict');
assert.equal(emptyMediaMapping.canonicalFieldMappings?.prompt, emptyMediaMapping.promptColumn);
assert.equal(inferGenerationImageRole('参考图_URLs', mappingDataset.inputSchema), 'reference');
assert.equal(inferGenerationImageRole('首帧图_URL', mappingDataset.inputSchema), 'start');
assert.equal(inferGenerationImageRole('尾帧图_URL', mappingDataset.inputSchema), 'end');
assert.equal(inferGenerationImageRole('\u9996\u5e27\u56fe_URL', []), 'start');
assert.equal(inferGenerationImageRole('\u5c3e\u5e27\u56fe_URL', []), 'end');
const canonicalDefaultMapping = defaultGenerationInputMapping(
  { inputSchema: [], items: [] } as any,
  ['prompt', 'image_urls', 'elements', 'audios'],
  {
    standard: {},
    inputColumns: ['prompt'],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
  },
);
assert.deepEqual(canonicalDefaultMapping.canonicalFieldMappings, {
  prompt: 'prompt', image_urls: 'image_urls', elements: 'elements', audios: 'audios',
});
const exactPromptDefaultMapping = defaultGenerationInputMapping(
  { inputSchema: [], items: [] } as any,
  ['other_input', 'prompt'],
  {
    standard: {},
    inputColumns: ['other_input'],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
  },
);
assert.equal(exactPromptDefaultMapping.promptColumn, 'prompt');
assert.equal(exactPromptDefaultMapping.canonicalFieldMappings?.prompt, 'prompt');



const withReference = setGenerationImageRole(emptyMediaMapping, '参考图_URLs', 'reference');
const withStart = setGenerationImageRole(withReference, '首帧图_URL', 'start');
const withEnd = setGenerationImageRole(withStart, '尾帧图_URL', 'end');
assert.equal(getGenerationImageRole(withEnd, '参考图_URLs'), 'reference');
assert.equal(getGenerationImageRole(withEnd, '首帧图_URL'), 'start');
assert.equal(getGenerationImageRole(withEnd, '尾帧图_URL'), 'end');
assert.equal(getGenerationImageRole(setGenerationImageRole(withEnd, '首帧图_URL'), '首帧图_URL'), undefined);

const textImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: [],
  endUrls: [],
});
assert.equal(textImageInputs.generationType, undefined);
assert.deepEqual(textImageInputs.imageUrls, []);

const referenceImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: ['https://assets.example.com/ref-a.png', 'https://assets.example.com/ref-b.png'],
  startUrls: [],
  endUrls: [],
});
assert.equal(referenceImageInputs.generationType, 'reference_to_video');
assert.deepEqual(referenceImageInputs.imageUrls, [
  'https://assets.example.com/ref-a.png',
  'https://assets.example.com/ref-b.png',
]);

const startImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: ['https://assets.example.com/start.png'],
  endUrls: [],
});
assert.equal(startImageInputs.generationType, 'image_to_video');

const keyframeImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: ['https://assets.example.com/start.png'],
  endUrls: ['https://assets.example.com/end.png'],
});
assert.equal(keyframeImageInputs.generationType, 'images_to_video');
assert.deepEqual(keyframeImageInputs.imageUrls, [
  'https://assets.example.com/start.png',
  'https://assets.example.com/end.png',
]);
assert.deepEqual(keyframeImageInputs.issues, []);

const endOnlyImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: [],
  startUrls: [],
  endUrls: ['https://assets.example.com/end.png'],
});
assert.ok(endOnlyImageInputs.issues.some(issue => issue.code === 'MISSING_START_IMAGE'));

const conflictingImageInputs = resolveGenerationImageInputs('video', {
  referenceUrls: ['https://assets.example.com/reference.png'],
  startUrls: ['https://assets.example.com/start.png'],
  endUrls: [],
});
assert.ok(conflictingImageInputs.issues.some(issue => issue.code === 'CONFLICTING_IMAGE_ROLES'));

const rawVideoModel = {
  id: 'model-config-1',
  name: 'provider/video-pro',
  display_name: 'Video Pro',
  description: 'Video model',
  model_type: 'video',
  provider: 'provider',
  capabilities: {
    text_to_video: true,
    image_to_video: true,
    images_to_video: true,
  },
  options: {
    supported_params: [
      'prompt',
      'image_urls',
      'generation_type',
      'aspect_ratio',
      'resolution',
      'camera_motion',
      'custom_strength',
      'duration',
      'generate_audio',
    ],
    aspect_ratio_options: ['16:9', '9:16'],
    resolution_options: ['720p', '1080p'],
    duration_options: [5, 10],
    default_duration: 5,
    default_resolution: '720p',
    parameter_schema: {
      properties: {
        custom_strength: {
          type: 'number',
          title: 'Custom strength',
          default: 0.5,
        },
      },
    },
    input_schema: {
      version: '1',
      unsupported_inputs: ['audio_url'],
      required_inputs: {
        text_to_video: ['prompt'],
        image_to_video: ['image_urls'],
      },
      required_one_of_inputs: {},
    },
  },
  input_schema: {
    version: '1',
    unsupported_inputs: ['audio_url'],
    required_inputs: {
      text_to_video: ['prompt'],
      image_to_video: ['image_urls'],
    },
    required_one_of_inputs: {},
  },
  price_items: [{ unit: 'generation', credits: 12 }],
  cost_items: [],
  update_time: '2026-08-01T00:00:00Z',
};

const camelCaseVideoModel = {
  name: 'seedance-2.0-pro',
  displayName: 'Seedance 2.0 Pro',
  description: 'CLI-shaped model config',
  type: 'video',
  subType: 'video',
  provider: 'provider',
  capabilities: {
    image2video: true,
    ref2video: true,
  },
  options: {
    duration_options: [5, 10, 15],
    resolution_options: ['720p', '1080p', '2160p'],
    resolution: '1080p',
    audios_count_range: [0, 1],
    required_params: {
      image_to_video: ['prompt'],
      reference_to_video: ['prompt'],
    },
    required_one_of_params: {
      image_to_video: [['image_urls', 'elements']],
      reference_to_video: [['image_urls', 'elements']],
    },
    supportedParams: ['prompt', 'image_urls', 'elements', 'audios', 'audio_url', 'duration', 'resolution'],
  },
  priceItems: [
    { unit_type: 'seconds', price: { input: 0, output: 20 } },
    { unit_type: 'seconds', properties: { resolution: '2160p' }, price: { input: 0, output: 80 } },
  ],
};

const videoModel = normalizeAionModelConfig(rawVideoModel);
assert.equal(videoModel.id, rawVideoModel.name);
assert.equal(videoModel.outputModality, 'video');
assert.deepEqual(getSupportedGenerationImageRoles(videoModel), ['start', 'end']);
assert.deepEqual(videoModel.supportedDurations, [5, 10]);
assert.equal(videoModel.controls.find(item => item.key === 'duration')?.defaultValue, 5);
assert.ok(videoModel.configFingerprint);

assert.equal(videoModel.controls.find(item => item.key === 'camera_motion')?.type, 'text');
assert.equal(videoModel.controls.find(item => item.key === 'custom_strength')?.type, 'number');
assert.equal(videoModel.controls.find(item => item.key === 'custom_strength')?.defaultValue, 0.5);

const cliShapeModel = normalizeAionModelConfig(camelCaseVideoModel);
assert.equal(cliShapeModel.displayName, camelCaseVideoModel.displayName);
assert.equal(cliShapeModel.outputModality, 'video');
assert.deepEqual(getSupportedGenerationImageRoles(cliShapeModel), ['reference', 'start']);
assert.equal(cliShapeModel.controls.find(item => item.key === 'resolution')?.defaultValue, '1080p');
assert.deepEqual(cliShapeModel.inputSchema?.required_inputs, camelCaseVideoModel.options.required_params);
const hailuoH3Model = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'minimax/hailuo-h3',
  options: {
    ...camelCaseVideoModel.options,
    duration_options: Array.from({ length: 12 }, (_, index) => index + 4),
    supported_params: ['prompt', 'duration', 'elements', 'audios'],
  },
});
assert.deepEqual(getGenerationReferenceVideoSupport(hailuoH3Model), {
  supported: true,
  strategy: 'elements',
  field: 'elements',
  min: 0,
  max: 3,
  source: 'hailuo_h3_contract',
});
const h3VideoInputs = compileGenerationReferenceVideoInputs(hailuoH3Model, [
  'https://assets.example.com/reference-a.mp4',
  'https://assets.example.com/reference-b.mp4',
]);
assert.equal(h3VideoInputs.generationType, 'reference_to_video');
assert.deepEqual(h3VideoInputs.extraInputs.elements, [
  { video_url: 'https://assets.example.com/reference-a.mp4' },
  { video_url: 'https://assets.example.com/reference-b.mp4' },
]);
assert.deepEqual(h3VideoInputs.issues, []);
const h3ReferenceCase = preflightGenerationCase(hailuoH3Model, {
  caseId: 'case-h3-reference-video',
  datasetItemId: 'item-h3-reference-video',
  rowIndex: 8,
  prompt: 'Follow the reference video.',
  imageUrls: [],
  audioUrls: [],
  videoUrls: h3VideoInputs.videoUrls,
  controls: { duration: 9, resolution: '1080p' },
  extraInputs: h3VideoInputs.extraInputs,
  generationType: h3VideoInputs.generationType,
});
assert.equal(h3ReferenceCase.valid, true);
const h3ReferenceRequest = buildAionGenerationRequest(hailuoH3Model, h3ReferenceCase.resolvedCase);
assert.equal(h3ReferenceRequest.body.generation_type, 'reference_to_video');
assert.deepEqual(h3ReferenceRequest.body.elements, h3VideoInputs.extraInputs.elements);
assert.equal(h3ReferenceRequest.body.duration, 9);
const h3RequiredControlModel = {
  ...hailuoH3Model,
  inputSchema: {
    ...(hailuoH3Model.inputSchema || {}),
    required_inputs: {
      reference_to_video: ['prompt', 'elements', 'duration', 'resolution'],
    },
  },
};
assert.equal(preflightGenerationCase(
  h3RequiredControlModel,
  h3ReferenceCase.resolvedCase,
).valid, true, 'required model inputs must include resolved standard controls');

const keyframeVideoConflict = preflightGenerationCase(hailuoH3Model, {
  ...h3ReferenceCase.resolvedCase,
  caseId: 'case-keyframe-video-conflict',
  imageUrls: ['https://assets.example.com/start.png'],
  generationType: 'image_to_video',
});
assert.ok(keyframeVideoConflict.errors.some(issue => issue.code === 'CONFLICTING_VIDEO_AND_KEYFRAMES'));
assert.ok(compileGenerationReferenceVideoInputs(hailuoH3Model, [
  'https://assets.example.com/1.mp4',
  'https://assets.example.com/2.mp4',
  'https://assets.example.com/3.mp4',
  'https://assets.example.com/4.mp4',
]).issues.some(issue => issue.code === 'REFERENCE_VIDEO_COUNT_OUT_OF_RANGE'));

const wanVideoModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'wan2.7-video',
  options: {
    ...camelCaseVideoModel.options,
    duration_options: Array.from({ length: 14 }, (_, index) => index + 2),
    ref2video_duration_options: Array.from({ length: 9 }, (_, index) => index + 2),
    supported_params: ['prompt', 'duration', 'video_url', 'reference_video_urls', 'elements'],
  },
});
assert.equal(getGenerationReferenceVideoSupport(wanVideoModel).strategy, 'array_field');
assert.equal(getGenerationReferenceVideoSupport(wanVideoModel).field, 'reference_video_urls');
const wanReferenceInputs = compileGenerationReferenceVideoInputs(
  wanVideoModel,
  ['https://assets.example.com/reference.mp4'],
);
assert.deepEqual(wanReferenceInputs.extraInputs, {
  reference_video_urls: ['https://assets.example.com/reference.mp4'],
});
const wanReferenceRequest = buildAionGenerationRequest(wanVideoModel, {
  caseId: 'case-wan-reference-video',
  datasetItemId: 'item-wan-reference-video',
  rowIndex: 9,
  prompt: 'Follow this motion.',
  imageUrls: [],
  audioUrls: [],
  videoUrls: wanReferenceInputs.videoUrls,
  controls: { duration: 10 },
  extraInputs: wanReferenceInputs.extraInputs,
  generationType: 'reference_to_video',
});
assert.deepEqual(wanReferenceRequest.body.reference_video_urls, [
  'https://assets.example.com/reference.mp4',
]);
assert.equal(resolveReferenceAudioDuration(wanVideoModel, 10.2, 'reference_to_video').valid, false);
assert.equal(resolveReferenceAudioDuration(wanVideoModel, 10.2, 'text_to_video').resolvedDuration, 11);

const singleVideoModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'single-video-model',
  options: {
    ...camelCaseVideoModel.options,
    supported_params: ['prompt', 'duration', 'video_url'],
  },
});
assert.equal(getGenerationReferenceVideoSupport(singleVideoModel).strategy, 'single_field');
assert.ok(compileGenerationReferenceVideoInputs(singleVideoModel, [
  'https://assets.example.com/one.mp4',
  'https://assets.example.com/two.mp4',
]).issues.some(issue => issue.code === 'REFERENCE_VIDEO_COUNT_OUT_OF_RANGE'));

const uncertainElementsModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'uncertain-elements-model',
  options: {
    ...camelCaseVideoModel.options,
    supported_params: ['prompt', 'duration', 'elements'],
  },
});
assert.equal(getGenerationReferenceVideoSupport(uncertainElementsModel).supported, false);
assert.ok(compileGenerationReferenceVideoInputs(uncertainElementsModel, [
  'https://assets.example.com/reference.mp4',
]).issues.some(issue => issue.code === 'REFERENCE_VIDEO_NOT_SUPPORTED'));
assert.ok(compileGenerationReferenceVideoInputs(hailuoH3Model, [
  'https://assets.example.com/reference.mp4',
], [{ video_url: 'https://assets.example.com/raw.mp4' }]).issues.some(
  issue => issue.code === 'CONFLICTING_REFERENCE_VIDEO_INPUTS',
));

const discreteAudioDuration = resolveReferenceAudioDuration(hailuoH3Model, 8.515917);
assert.equal(discreteAudioDuration.valid, true);
assert.equal(discreteAudioDuration.resolvedDuration, 9);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 5.1).resolvedDuration, 5);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 5.2).resolvedDuration, 6);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 15.16).valid, false);
assert.equal(resolveReferenceAudioDuration(hailuoH3Model, 3.8).valid, false);

const continuousDurationModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'continuous-duration-model',
  options: {
    supported_params: ['prompt', 'duration'],
    parameter_schema: {
      properties: {
        duration: { type: 'number', minimum: 2, maximum: 20 },
      },
    },
  },
});
assert.equal(resolveReferenceAudioDuration(continuousDurationModel, 8.515917).resolvedDuration, 8.516);

let probeCalls = 0;
const audioProbeCache = new Map<string, number>();
const probedAudio = await probeAudioDurations([
  'https://assets.example.com/audio.mp3',
  'https://assets.example.com/audio.mp3',
], {
  cache: audioProbeCache,
  concurrency: 2,
  timeoutMs: 100,
  probe: async () => {
    probeCalls += 1;
    return 8.515917;
  },
});
assert.equal(probeCalls, 1);
assert.equal(probedAudio['https://assets.example.com/audio.mp3'].seconds, 8.515917);
await probeAudioDurations(['https://assets.example.com/audio.mp3'], {
  cache: audioProbeCache,
  probe: async () => {
    probeCalls += 1;
    return 9;
  },
});
assert.equal(probeCalls, 1, 'successful metadata probes should be cached by URL');
const timedOutAudio = await probeAudioDurations(['https://assets.example.com/timeout.mp3'], {
  timeoutMs: 5,
  probe: async () => new Promise<number>(() => undefined),
});
assert.match(timedOutAudio['https://assets.example.com/timeout.mp3'].error || '', /timed out/i);
const serviceDataset = {
  id: 'dataset-duration-service',
  items: [
    {
      [DATASET_ITEM_ID_KEY]: 'duration-item-1',
      case_id: 'duration-case-1',
      prompt: 'Use the reference media.',
      audio: 'https://assets.example.com/audio.mp3',
      video: 'https://assets.example.com/reference.mp4',
      duration_column: '11',
    },
    {
      [DATASET_ITEM_ID_KEY]: 'duration-item-2',
      case_id: 'duration-case-2',
      prompt: 'Invalid multiple audio case.',
      audio: 'https://assets.example.com/one.mp3;https://assets.example.com/two.mp3',
      video: 'https://assets.example.com/reference-2.mp4',
      duration_column: '',
    },
  ],
} as any;
const serviceSelection = serviceDataset.items.map((row: Record<string, unknown>, rowIndex: number) => ({
  row,
  rowIndex,
  datasetItemId: String(row[DATASET_ITEM_ID_KEY]),
}));
const audioFollowingCases = buildGenerationCasesForPreflight(serviceDataset, {
  datasetId: serviceDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    promptColumn: 'prompt',
    referenceImageColumns: [],
    referenceAudioColumns: ['audio'],
    referenceVideoColumns: ['video'],
    extraInputColumns: [],
  },
  defaultControls: { resolution: '1080p' },
  perCaseControlColumns: {},
  durationSource: {
    mode: 'reference_audio',
    referenceAudio: {
      'duration-item-1': {
        audioUrl: 'https://assets.example.com/audio.mp3',
        detectedSeconds: 8.515917,
        resolvedDuration: 9,
      },
    },
  },
}, hailuoH3Model, serviceSelection);
assert.equal(audioFollowingCases[0].resolvedCase.controls.duration, 9);
assert.equal(audioFollowingCases[0].resolvedCase.durationResolution?.detectedSeconds, 8.516);
assert.equal(audioFollowingCases[0].resolvedCase.durationResolution?.resolvedDuration, 9);
assert.equal(audioFollowingCases[0].resolvedCase.generationType, 'reference_to_video');
assert.deepEqual(audioFollowingCases[0].resolvedCase.extraInputs?.elements, [
  { video_url: 'https://assets.example.com/reference.mp4' },
]);
assert.deepEqual(audioFollowingCases[0].preparationIssues, []);
assert.ok(audioFollowingCases[1].preparationIssues.some(
  issue => issue.code === 'MULTIPLE_REFERENCE_AUDIOS',
));

const durationColumnCases = buildGenerationCasesForPreflight(serviceDataset, {
  datasetId: serviceDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    promptColumn: 'prompt',
    referenceImageColumns: [],
    referenceAudioColumns: [],
    referenceVideoColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { resolution: '1080p' },
  perCaseControlColumns: {},
  durationSource: { mode: 'column', column: 'duration_column' },
}, hailuoH3Model, serviceSelection);
assert.equal(durationColumnCases[0].resolvedCase.controls.duration, 11);
assert.equal(durationColumnCases[0].resolvedCase.durationResolution?.source, 'column');
assert.ok(durationColumnCases[1].preparationIssues.some(
  issue => issue.code === 'MISSING_DURATION_COLUMN_VALUE',
));
const mcpDataset = {
  id: 'dataset-mcp-contract',
  items: [{
    [DATASET_ITEM_ID_KEY]: 'mcp-item-1',
    case_id: 'mcp-case-1',
    prompt_json: 'Use @Element1 and @audio1.',
    elements_json: '[{"frontal_image_url":"https://assets.example.com/subject.png"}]',
    audios_json: '[{"url":"https://assets.example.com/voice.mp3","range":[0,4]}]',
    duration_value: '4',
  }],
} as any;
const mcpCases = buildGenerationCasesForPreflight(mcpDataset, {
  datasetId: mcpDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    mappingMode: 'mcp',
    compatibilityMode: 'strict',
    canonicalFieldMappings: {
      prompt: 'prompt_json',
      elements: 'elements_json',
      audios: 'audios_json',
      duration: 'duration_value',
    },
    referenceImageColumns: [],
    referenceAudioColumns: [],
    referenceVideoColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { resolution: '1080p' },
  perCaseControlColumns: {},
  durationSource: { mode: 'uniform' },
}, hailuoH3Model, [{
  row: mcpDataset.items[0],
  rowIndex: 0,
  datasetItemId: 'mcp-item-1',
}]);
assert.deepEqual(mcpCases[0].preparationIssues, []);
assert.equal(mcpCases[0].resolvedCase.generationType, 'reference_to_video');
assert.deepEqual(mcpCases[0].resolvedCase.audioInputs, [
  { url: 'https://assets.example.com/voice.mp3', range: [0, 4] },
]);
assert.equal(mcpCases[0].resolvedCase.controls.duration, 4);
assert.equal(mcpCases[0].resolvedCase.compilerAudit?.profileId, 'hailuo-h3');
const mcpRequest = buildAionGenerationRequest(hailuoH3Model, {
  ...mcpCases[0].resolvedCase,
  generationType: mcpCases[0].resolvedCase.generationType || 'reference_to_video',
});
assert.deepEqual(mcpRequest.body.elements, [
  { frontal_image_url: 'https://assets.example.com/subject.png' },
]);
assert.deepEqual(mcpRequest.body.audios, [
  { url: 'https://assets.example.com/voice.mp3', range: [0, 4] },
]);

assert.throws(() => validateDurationSourceConfiguration({
  datasetId: serviceDataset.id,
  datasetVersion: 1,
  modelName: hailuoH3Model.modelName,
  targetColumn: 'result',
  inputMapping: {
    referenceImageColumns: [],
    referenceAudioColumns: [],
    extraInputColumns: [],
  },
  defaultControls: { duration: 9 },
  perCaseControlColumns: { duration: 'duration_column' },
  durationSource: { mode: 'uniform' },
}, hailuoH3Model), /Uniform duration cannot be combined/);


const cliShapeCase = preflightGenerationCase(cliShapeModel, {
  caseId: 'case-cli-shape',
  datasetItemId: 'item-cli-shape',
  rowIndex: 5,
  prompt: 'Animate the reference.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: [],
  controls: { duration: 5, resolution: '1080p' },
});
assert.equal(cliShapeCase.valid, true);
const cliShapeCost = estimateGenerationCost(cliShapeModel, [cliShapeCase.resolvedCase]);
assert.equal(cliShapeCost.known, true);
assert.equal(cliShapeCost.totalCredits, 400);
assert.equal(cliShapeCost.unitLabel, 'second (upper rate)');

const audioArrayCase = preflightGenerationCase(cliShapeModel, {
  caseId: 'case-audio-array',
  datasetItemId: 'item-audio-array',
  rowIndex: 6,
  prompt: 'Animate with the reference audio.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: ['https://assets.example.com/voice.wav'],
  controls: { duration: 5, resolution: '1080p' },
});
assert.equal(audioArrayCase.valid, true);
const audioArrayRequest = buildAionGenerationRequest(cliShapeModel, audioArrayCase.resolvedCase);
assert.deepEqual(audioArrayRequest.body.audios, [{ url: 'https://assets.example.com/voice.wav' }]);
assert.equal(audioArrayRequest.body.audio_url, undefined);

const audioUrlOnlyModel = normalizeAionModelConfig({
  ...camelCaseVideoModel,
  name: 'provider/audio-url-only',
  options: {
    ...camelCaseVideoModel.options,
    supportedParams: ['prompt', 'image_urls', 'audio_url', 'duration', 'resolution'],
  },
});
const rangedAudioCase = preflightGenerationCase(audioUrlOnlyModel, {
  caseId: 'case-ranged-audio',
  datasetItemId: 'item-ranged-audio',
  rowIndex: 7,
  prompt: 'Animate with a selected audio range.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: ['https://assets.example.com/voice.wav'],
  audioInputs: [{
    url: 'https://assets.example.com/voice.wav',
    range: [1, 4],
  }],
  controls: { duration: 5, resolution: '1080p' },
});
assert.equal(rangedAudioCase.valid, false);
assert.ok(rangedAudioCase.errors.some(item =>
  item.code === 'AUDIO_RANGE_REQUIRES_AUDIOS'));

const multipleAudioUrlCase = preflightGenerationCase(audioUrlOnlyModel, {
  ...rangedAudioCase.resolvedCase,
  caseId: 'case-multiple-audio-url',
  datasetItemId: 'item-multiple-audio-url',
  audioUrls: ['https://assets.example.com/one.wav', 'https://assets.example.com/two.wav'],
  audioInputs: [],
});
assert.equal(multipleAudioUrlCase.valid, false);
assert.ok(multipleAudioUrlCase.errors.some(item =>
  item.code === 'MULTIPLE_AUDIOS_REQUIRE_AUDIOS'));

const tooManyAudios = preflightGenerationCase(cliShapeModel, {
  ...audioArrayCase.resolvedCase,
  caseId: 'case-too-many-audios',
  datasetItemId: 'item-too-many-audios',
  audioUrls: ['https://assets.example.com/one.wav', 'https://assets.example.com/two.wav'],
});
assert.equal(tooManyAudios.valid, false);
assert.ok(tooManyAudios.errors.some(item => item.code === 'INPUT_COUNT_OUT_OF_RANGE'));

const unsupportedExtraInputCase = preflightGenerationCase(audioUrlOnlyModel, {
  ...rangedAudioCase.resolvedCase,
  caseId: 'case-unsupported-extra-input',
  audioInputs: undefined,
  extraInputs: { custom_provider_field: 'value' },
});
assert.ok(unsupportedExtraInputCase.errors.some(item =>
  item.code === 'UNSUPPORTED_INPUT' && item.field === 'custom_provider_field'));

const mcpImageModel = normalizeAionModelConfig({
  name: 'provider/mcp-image-model',
  displayName: 'MCP image model',
  type: 'image',
  provider: 'provider',
  capabilities: { image2image: true },
  options: {
    supported_params: ['prompt', 'images'],
    required_params: { image_to_image: ['images'] },
  },
  priceItems: [{ unit: 'image', credits: 1 }],
});
const mcpImageCase = preflightGenerationCase(mcpImageModel, {
  caseId: 'case-mcp-image',
  datasetItemId: 'item-mcp-image',
  rowIndex: 8,
  prompt: 'Restyle @image1.',
  imageUrls: ['https://assets.example.com/reference.png'],
  audioUrls: [],
  controls: {},
});
assert.equal(mcpImageCase.valid, true);
const mcpImageRequest = buildAionGenerationRequest(mcpImageModel, mcpImageCase.resolvedCase);
assert.deepEqual(mcpImageRequest.body.image_urls, ['https://assets.example.com/reference.png']);

const validTextCase = preflightGenerationCase(videoModel, {
  caseId: 'case-1',
  datasetItemId: 'item-1',
  rowIndex: 0,
  prompt: 'A runner crosses the finish line.',
  imageUrls: [],
  audioUrls: [],
  controls: {
    duration: 5,
    aspect_ratio: '16:9',
    resolution: '720p',
  },
});
assert.equal(validTextCase.valid, true);
assert.equal(validTextCase.generationType, 'text_to_video');

const promptTooLongCase = preflightGenerationCase(videoModel, {
  ...validTextCase.resolvedCase,
  caseId: 'case-prompt-too-long',
  datasetItemId: 'item-prompt-too-long',
  prompt: '123456',
}, { promptMaxLength: 5 });
assert.equal(promptTooLongCase.valid, false);
assert.ok(promptTooLongCase.errors.some(item => (
  item.code === 'PROMPT_TOO_LONG' && item.field === 'prompt'
)));

const structuredPromptModel = {
  ...videoModel,
  inputSchema: {
    ...videoModel.inputSchema,
    properties: { prompt: { type: 'string', maxLength: 5 } },
  },
};
assert.deepEqual(generationValidationForModel(structuredPromptModel, {
  [videoModel.modelName]: { promptMaxLength: 10 },
}), { promptMaxLength: 5 });

const invalidDuration = preflightGenerationCase(videoModel, {
  caseId: 'case-2',
  datasetItemId: 'item-2',
  rowIndex: 1,
  prompt: 'A runner crosses the finish line.',
  imageUrls: [],
  audioUrls: [],
  controls: { duration: 7 },
});
assert.equal(invalidDuration.valid, false);
assert.ok(invalidDuration.errors.some(item => item.code === 'UNSUPPORTED_CONTROL_VALUE'));

const imageCase = preflightGenerationCase(videoModel, {
  caseId: 'case-3',
  datasetItemId: 'item-3',
  rowIndex: 2,
  prompt: 'The subject turns toward camera.',
  imageUrls: ['https://assets.example.com/start.png'],
  audioUrls: [],
  controls: { duration: 5 },
});
assert.equal(imageCase.generationType, 'image_to_video');

const referenceCapableModel = {
  ...videoModel,
  capabilities: [...videoModel.capabilities, 'reference_to_video'],
};
const referenceModeCase = preflightGenerationCase(referenceCapableModel, {
  caseId: 'case-reference-mode',
  datasetItemId: 'item-reference-mode',
  rowIndex: 7,
  prompt: 'Keep both reference subjects.',
  imageUrls: referenceImageInputs.imageUrls,
  audioUrls: [],
  controls: { duration: 5 },
  generationType: referenceImageInputs.generationType,
});
assert.equal(referenceModeCase.valid, true);
assert.equal(referenceModeCase.generationType, 'reference_to_video');
assert.equal(
  buildAionGenerationRequest(referenceCapableModel, referenceModeCase.resolvedCase).body.generation_type,
  'reference_to_video',
);

const request = buildAionGenerationRequest(videoModel, imageCase.resolvedCase);
assert.equal(request.path, '/model/api/v1/model/generate-video');
assert.equal(request.body.model_name, rawVideoModel.name);
assert.equal(request.body.generation_type, 'image_to_video');
assert.deepEqual(request.body.image_urls, ['https://assets.example.com/start.png']);
assert.equal(request.body.features.auto_adjust_duration_to_supported, false);

const customInputModel = {
  ...videoModel,
  capabilities: [...videoModel.capabilities, 'reference_to_video'],
  inputSchema: {
    properties: {
      conditioning_assets: { type: 'array' },
    },
    required_inputs: {
      reference_to_video: ['conditioning_assets'],
    },
  },
};
const customInputCase = preflightGenerationCase(customInputModel, {
  caseId: 'case-custom-input',
  datasetItemId: 'item-custom-input',
  rowIndex: 4,
  prompt: 'Use the conditioning assets.',
  imageUrls: [],
  audioUrls: [],
  controls: { duration: 5 },
  generationType: 'reference_to_video',
  extraInputs: {
    conditioning_assets: [{ image_url: 'https://assets.example.com/character.png' }],
    model_name: 'untrusted-model',
    features: { auto_adjust_duration_to_supported: true },
  },
});
assert.equal(customInputCase.valid, true);
const customInputRequest = buildAionGenerationRequest(customInputModel, customInputCase.resolvedCase);
assert.deepEqual(customInputRequest.body.conditioning_assets, [
  { image_url: 'https://assets.example.com/character.png' },
]);
assert.equal(customInputRequest.body.model_name, rawVideoModel.name);
assert.equal(customInputRequest.body.features.auto_adjust_duration_to_supported, false);

const cost = estimateGenerationCost(videoModel, 3);
assert.equal(cost.known, true);
assert.equal(cost.totalCredits, 36);

const unknownCost = estimateGenerationCost({
  ...videoModel,
  priceItems: [{ formula: 'provider-specific' }],
}, 3);
assert.equal(unknownCost.known, false);

const assets = [
  { id: 'asset-1', relativePath: 'characters/p1.png', fileName: 'p1.png' },
  { id: 'asset-2', relativePath: 'looks/p2.png', fileName: 'p2.png' },
  { id: 'asset-3', relativePath: 'alternate/p2.png', fileName: 'p2.png' },
];
assert.equal(matchUploadedAsset('characters\\p1.png', assets).assetId, 'asset-1');
assert.equal(matchUploadedAsset('p1.png', assets).assetId, 'asset-1');
assert.equal(matchUploadedAsset('p2.png', assets).errorCode, 'AMBIGUOUS_ASSET');
assert.equal(matchUploadedAsset('missing.png', assets).errorCode, 'MISSING_ASSET');

const invalidUrl = preflightGenerationCase(videoModel, {
  caseId: 'case-4',
  datasetItemId: 'item-4',
  rowIndex: 3,
  prompt: 'Prompt',
  imageUrls: ['file:///tmp/reference.png'],
  audioUrls: [],
  controls: { duration: 5 },
});
assert.equal(invalidUrl.valid, false);
assert.ok(invalidUrl.errors.some(item => item.code === 'INVALID_ASSET_URL'));

const wrappedProviderPayload = normalizeProviderPayload({
  data: {
    taskId: 'task-wrapped',
    taskStatus: 'succeeded',
    endpointType: 'video',
    videos: [{ url: 'https://assets.example.com/result.mp4', previewUrl: 'https://assets.example.com/preview.jpg' }],
  },
});
assert.equal(wrappedProviderPayload.task_id, 'task-wrapped');
assert.equal(wrappedProviderPayload.task_status, 'succeeded');
const wrappedProviderResult = providerResult({ data: wrappedProviderPayload });
assert.equal(wrappedProviderResult?.originalResultUrl, 'https://assets.example.com/result.mp4');
assert.equal(wrappedProviderResult?.resultUrl, 'https://assets.example.com/result.mp4');
assert.equal(wrappedProviderResult?.durability, 'temporary');
assert.equal(wrappedProviderResult?.previewUrl, 'https://assets.example.com/preview.jpg');

const vidMuseAssetOptions = {
  mediaType: 'video' as const,
  expectedUserId: '796854911166661',
  imageBaseUrl: 'https://vidmuse-dev.sandcdn.com',
  videoBaseUrl: 'https://vidmuse-dev-video.sandcdn.com',
};
const providerTemporaryUrl = 'https://provider.example.com/generated.mp4?expires=soon';
const stableVideoUrl = 'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/%E7%BB%93%E6%9E%9C%201.mp4';
assert.equal(
  aionUserAssetPathToUrl(
    '/work/aion-user-base-dev/796854911166661/assets/videos/\u7ed3\u679c 1.mp4',
    vidMuseAssetOptions,
  ),
  stableVideoUrl,
);
assert.equal(
  aionUserAssetPathToUrl(
    '/work/aion-user-base-dev/796854911166661/assets/images/result image.png',
    { ...vidMuseAssetOptions, mediaType: 'image' },
  ),
  'https://vidmuse-dev.sandcdn.com/user/796854911166661/assets/images/result%20image.png',
);
assert.equal(
  aionUserAssetPathToUrl(
    'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/already-stable.mp4',
    vidMuseAssetOptions,
  ),
  'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/already-stable.mp4',
);
for (const unsafePath of [
  '/work/aion-user-base-dev/999/assets/videos/result.mp4',
  '/work/aion-user-base-dev/796854911166661/assets/images/result.mp4',
  '/work/aion-user-base-dev/796854911166661/assets/videos/../secrets.mp4',
  '/work/aion-runtime-dev/thread_1/result.mp4',
  'https://vidmuse-dev-video.sandcdn.com/user/999/assets/videos/wrong-user.mp4',
  'https://attacker.example.com/user/796854911166661/assets/videos/result.mp4',
]) {
  assert.equal(aionUserAssetPathToUrl(unsafePath, vidMuseAssetOptions), undefined);
}

const persistedProviderResult = providerResult({
  data: {
    taskStatus: 'succeeded',
    videos: [{
      url: providerTemporaryUrl,
      local_path: '/work/aion-user-base-dev/796854911166661/assets/videos/\u7ed3\u679c 1.mp4',
    }],
  },
}, vidMuseAssetOptions);
assert.deepEqual(persistedProviderResult, {
  originalResultUrl: providerTemporaryUrl,
  resultUrl: stableVideoUrl,
  durability: 'vidmuse_asset',
  previewUrl: undefined,
});
assert.deepEqual(
  unarchivedGenerationResult({}, persistedProviderResult!, 'video'),
  {
    originalResultUrl: providerTemporaryUrl,
    resultUrl: stableVideoUrl,
    durability: 'vidmuse_asset',
    previewUrl: undefined,
    mediaType: 'video',
  },
);
assert.deepEqual(
  archivedGenerationResult({}, persistedProviderResult!, 'https://eval.example.com/stable/video.mp4', 'video'),
  {
    originalResultUrl: providerTemporaryUrl,
    resultUrl: 'https://eval.example.com/stable/video.mp4',
    mediaType: 'video',
    durability: 'manueval_oss',
  },
);

const camelCasePersistedResult = providerResult({
  videos: [{
    url: providerTemporaryUrl,
    localPath: '/work/aion-user-base-dev/796854911166661/assets/videos/camel-case.mp4',
  }],
}, vidMuseAssetOptions);
assert.equal(
  camelCasePersistedResult?.resultUrl,
  'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/camel-case.mp4',
);
assert.equal(camelCasePersistedResult?.durability, 'vidmuse_asset');

const topLevelFilePathResult = providerResult({
  videos: [{ url: providerTemporaryUrl }],
  filePath: '/work/aion-user-base-dev/796854911166661/assets/videos/top-level.mp4',
}, vidMuseAssetOptions);
assert.equal(
  topLevelFilePathResult?.resultUrl,
  'https://vidmuse-dev-video.sandcdn.com/user/796854911166661/assets/videos/top-level.mp4',
);
assert.equal(topLevelFilePathResult?.durability, 'vidmuse_asset');

const rejectedPersistedResult = providerResult({
  videos: [{
    url: providerTemporaryUrl,
    file_path: '/work/aion-user-base-dev/999/assets/videos/wrong-user.mp4',
  }],
}, vidMuseAssetOptions);
assert.equal(rejectedPersistedResult?.resultUrl, providerTemporaryUrl);
assert.equal(rejectedPersistedResult?.durability, 'temporary');
assert.equal(JSON.stringify(rejectedPersistedResult).includes('/work/'), false);
assert.equal(
  generationAssetService.isExecutionReady(),
  generationAssetService.usesTemporaryUrls() || generationAssetService.isConfigured(),
);

const taskWorkerSubmission = buildTaskWorkerSubmission(
  '/model/api/v1/model/generate-video',
  {
    model_name: 'provider/video-pro',
    prompt: 'Animate this.',
    resolution: '720p',
    features: { auto_adjust_duration_to_supported: false },
  },
);
assert.equal(taskWorkerSubmission.modality, 'video');
assert.equal(taskWorkerSubmission.request.event_type, 'vidflow/remix-shot-video.triggered');
assert.equal(taskWorkerSubmission.request.data.standalone, true);
assert.equal(taskWorkerSubmission.request.data.features, undefined);
assert.equal(
  taskWorkerFilePathToUrl(
    '/work/aion-user-base-dev/987654/images/result image.png',
    'image',
    'https://image.example.com',
    'https://video.example.com',
  ),
  'https://image.example.com/user/987654/images/result%20image.png',
);
assert.deepEqual(
  normalizeTaskWorkerTask({
    id: 'rtc-1',
    status: 'success',
    data: {
      model_request_id: 'request-1',
      result: { file_path: '/work/aion-user-base-dev/987654/images/result.png' },
    },
  }, 'image', 'https://image.example.com', 'https://video.example.com'),
  {
    task_id: 'rtc-1',
    task_status: 'succeed',
    task_status_msg: undefined,
    endpoint_type: 'image',
    model_request_id: 'request-1',
    images: [{
      url: 'https://image.example.com/user/987654/images/result.png',
      file_path: '/work/aion-user-base-dev/987654/images/result.png',
    }],
  },
);

const aionRequests: Array<{ url: string; init?: RequestInit }> = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  aionRequests.push({ url, init });
  if (url.includes('/public/api/v1/configs/model-configs')) {
    return new Response(JSON.stringify({
      data: [
        camelCaseVideoModel,
        {
          ...camelCaseVideoModel,
          name: 'disabled-video-model',
          is_enabled: false,
        },
      ],
      limit: 20,
      offset: 0,
      total: 2,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ task_id: 'task-1', task_status: 'submitted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const aionClient = new AionGenerationClient(
  'https://aion.example.com',
  '987654',
  fakeFetch,
  'https://model.example.com/private/api/v1/model',
  'model_api',
);
const listedModels = await aionClient.listModels(['video']);
assert.equal(listedModels.length, 1);
assert.equal(listedModels[0].modelName, camelCaseVideoModel.name);
await aionClient.submit('/model/api/v1/model/generate-video', { model_name: rawVideoModel.name });
const submitRequest = aionRequests.at(-1);
assert.equal(submitRequest?.url, 'https://model.example.com/private/api/v1/model/generate-video');
assert.equal(new Headers(submitRequest?.init?.headers).get('x-auth-user-id'), '987654');

const taskWorkerRequests: Array<{ url: string; init?: RequestInit }> = [];
const taskWorkerFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  taskWorkerRequests.push({ url, init });
  if (init?.method === 'POST') {
    return new Response(JSON.stringify({ status: 'accepted', task_ids: ['rtc-1'] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify([{
    id: 'rtc-1',
    status: 'success',
    data: {
      model_request_id: 'request-1',
      result: { file_path: '/work/aion-user-base-dev/987654/images/result.png' },
    },
  }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const taskWorkerClient = new AionGenerationClient(
  'https://catalog.example.com',
  '987654',
  taskWorkerFetch,
  '',
  'task_worker',
  'https://manager.example.com/manager',
  'thread-1',
  'https://image.example.com',
  'https://video.example.com',
);
const submittedTaskWorker = await taskWorkerClient.submit(
  '/model/api/v1/model/generate-image',
  { model_name: 'xai/grok-imagine-image', prompt: 'A red teapot.' },
);
assert.equal(submittedTaskWorker.task_id, 'rtc-1');
assert.equal(taskWorkerRequests[0].url, 'https://manager.example.com/manager/api/v2/threads/thread-1/task-worker/create-task');
assert.equal(new Headers(taskWorkerRequests[0].init?.headers).get('x-auth-thread-id'), 'thread-1');
const polledTaskWorker = await taskWorkerClient.getTask('rtc-1', 'xai/grok-imagine-image', 'image');
assert.equal(polledTaskWorker.task_status, 'succeed');
assert.equal(polledTaskWorker.images[0].url, 'https://image.example.com/user/987654/images/result.png');

await assert.rejects(
  () => generationAssetService.createUpload({
    datasetId: 'dataset-1',
    fileName: 'payload.exe',
    relativePath: 'payload.exe',
    contentType: 'application/octet-stream',
    sizeBytes: 100,
  }, {
    id: 'user-1',
    displayName: 'Tester',
    email: 'tester@example.com',
    organizationId: 'default',
  }),
  generationAssetService.usesTemporaryUrls()
    ? /Local asset upload is unavailable in temporary URL mode/
    : /Unsupported generation asset type/,
);

const oversizedStream = Readable.from([Buffer.alloc(6)]).pipe(createByteLimitStream(5));
await assert.rejects(async () => {
  for await (const _chunk of oversizedStream) {
    // Consume the stream so the byte limiter observes every chunk.
  }
}, /Remote asset exceeds 5 bytes/);
console.log('Generation planning and client tests passed.');
