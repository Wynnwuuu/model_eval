import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  buildAionGenerationRequest,
  estimateGenerationCost,
  matchUploadedAsset,
  normalizeAionModelConfig,
  preflightGenerationCase,
  resolveGenerationImageInputs,
} from '../server/generation/generationPlanning.ts';
import {
  AionGenerationClient,
  buildTaskWorkerSubmission,
  normalizeTaskWorkerTask,
  taskWorkerFilePathToUrl,
} from '../server/generation/aionGenerationClient.ts';
import {
  normalizeProviderPayload,
  providerResult,
  temporaryGenerationResult,
} from '../server/generation/generationWorker.ts';
import { createByteLimitStream, generationAssetService } from '../server/generation/generationAssetService.ts';
import { inferDatasetMappings } from '../src/datasetManifest.ts';
import {
  defaultGenerationInputMapping,
  getGenerationImageRole,
  inferGenerationImageRole,
  setGenerationImageRole,
} from '../src/features/generation/inputMapping.ts';
import { getSupportedGenerationImageRoles } from '../src/features/generation/modelCapabilities.ts';

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
assert.equal(emptyMediaMapping.startImageColumn, '');
assert.equal(emptyMediaMapping.endImageColumn, '');
assert.equal(inferGenerationImageRole('参考图_URLs', mappingDataset.inputSchema), 'reference');
assert.equal(inferGenerationImageRole('首帧图_URL', mappingDataset.inputSchema), 'start');
assert.equal(inferGenerationImageRole('尾帧图_URL', mappingDataset.inputSchema), 'end');
assert.equal(inferGenerationImageRole('\u9996\u5e27\u56fe_URL', []), 'start');
assert.equal(inferGenerationImageRole('\u5c3e\u5e27\u56fe_URL', []), 'end');

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
assert.deepEqual(audioArrayRequest.body.audios, ['https://assets.example.com/voice.wav']);
assert.equal(audioArrayRequest.body.audio_url, undefined);

const tooManyAudios = preflightGenerationCase(cliShapeModel, {
  ...audioArrayCase.resolvedCase,
  caseId: 'case-too-many-audios',
  datasetItemId: 'item-too-many-audios',
  audioUrls: ['https://assets.example.com/one.wav', 'https://assets.example.com/two.wav'],
});
assert.equal(tooManyAudios.valid, false);
assert.ok(tooManyAudios.errors.some(item => item.code === 'INPUT_COUNT_OUT_OF_RANGE'));

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
assert.equal(wrappedProviderResult?.previewUrl, 'https://assets.example.com/preview.jpg');
assert.deepEqual(
  temporaryGenerationResult({}, 'https://assets.example.com/temporary.mp4', 'video'),
  {
    originalResultUrl: 'https://assets.example.com/temporary.mp4',
    resultUrl: 'https://assets.example.com/temporary.mp4',
    mediaType: 'video',
    durability: 'temporary',
  },
);
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
