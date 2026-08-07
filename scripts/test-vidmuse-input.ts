import assert from 'node:assert/strict';

import {
  buildAssistedVidMuseInput,
  compileVidMuseGenerationInput,
  parseVidMuseDatasetJson,
} from '../src/features/generation/vidmuseInputContract.ts';
import { extractMediaUrls } from '../src/mediaUrlUtils.ts';

const seedance = {
  modelName: 'seedance-2.0-pro',
  outputModality: 'video' as const,
};

const assisted = buildAssistedVidMuseInput({
  prompt: 'Keep @Element1 and @audio1 consistent.',
  startImageUrls: [],
  endImageUrls: [],
  referenceImageUrls: ['https://cdn.example.com/front one.png', 'https://cdn.example.com/look.png'],
  referenceVideoUrls: ['https://cdn.example.com/motion.mp4'],
  referenceAudios: [
    'https://cdn.example.com/voice.mp3',
    { url: 'https://cdn.example.com/music.mp3', range: [1.25, 4.5] },
  ],
  existingElements: [{ element_id: 7 }],
});
assert.deepEqual(assisted.elements, [
  { element_id: 7 },
  { frontal_image_url: 'https://cdn.example.com/front one.png' },
  { frontal_image_url: 'https://cdn.example.com/look.png' },
  { video_url: 'https://cdn.example.com/motion.mp4' },
]);
assert.deepEqual(assisted.audios, [
  { url: 'https://cdn.example.com/voice.mp3' },
  { url: 'https://cdn.example.com/music.mp3', range: [1.25, 4.5] },
]);

const canonical = compileVidMuseGenerationInput({
  model: { modelName: 'provider/reference-video', outputModality: 'video' },
  input: {
    prompt: '[{"prompt":"wide shot @Element1","duration":3},{"prompt":"close-up","duration":2}]',
    image_urls: '',
    elements: '[{"frontal_image_url":"https://cdn.example.com/person.png"}]',
    audios: '[{"url":"https://cdn.example.com/voice.mp3","range":[0,5]}]',
  },
});
assert.equal(canonical.errors.length, 0);
assert.equal(canonical.generationType, 'reference_to_video');
assert.deepEqual(canonical.input.audios, [{ url: 'https://cdn.example.com/voice.mp3', range: [0, 5] }]);
assert.deepEqual(canonical.bindings.elements, [{ index: 1, element: { frontal_image_url: 'https://cdn.example.com/person.png' } }]);

const invalid = compileVidMuseGenerationInput({
  model: seedance,
  input: {
    prompt: 'Use @Element2 and @audio1.',
    elements: [{ frontal_image_url: 'https://cdn.example.com/a.png', video_url: 'https://cdn.example.com/a.mp4' }],
    audios: [{ url: 'https://cdn.example.com/a.mp3', range: [4, 2] }],
  },
});
assert(invalid.errors.some(issue => issue.code === 'INVALID_ELEMENT_MODE'));
assert(invalid.errors.some(issue => issue.code === 'INVALID_AUDIO_RANGE'));
assert(invalid.errors.some(issue => issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE'));

const strictMixed = compileVidMuseGenerationInput({
  model: seedance,
  input: {
    prompt: 'Begin at @image1 while following @audio1.',
    image_urls: ['https://cdn.example.com/start.png'],
    audios: [{ url: 'https://cdn.example.com/guide.mp3' }],
  },
});
assert(strictMixed.errors.some(issue => issue.code === 'MODEL_INPUT_CONFLICT'));

const compatibleMixed = compileVidMuseGenerationInput({
  model: seedance,
  compatibilityMode: 'reference_fallback',
  input: {
    prompt: 'Begin at @image1 while following @audio1.',
    image_urls: ['https://cdn.example.com/start.png'],
    elements: [{ frontal_image_url: 'https://cdn.example.com/subject.png' }],
    audios: [{ url: 'https://cdn.example.com/guide.mp3' }],
  },
});
assert.equal(compatibleMixed.errors.length, 0);
assert.equal(compatibleMixed.generationType, 'reference_to_video');
assert.equal(compatibleMixed.compatibilityApplied, true);
assert.deepEqual(compatibleMixed.input.image_urls, []);
assert.deepEqual(compatibleMixed.input.elements, [
  { frontal_image_url: 'https://cdn.example.com/subject.png' },
  { frontal_image_url: 'https://cdn.example.com/start.png' },
]);
assert.equal(compatibleMixed.input.prompt, 'Begin at @Element2 while following @audio1.');
assert(compatibleMixed.warnings.some(issue => issue.code === 'COMPATIBILITY_REFERENCE_FALLBACK'));

const compatibilityUsageWarning = compileVidMuseGenerationInput({
  model: seedance,
  compatibilityMode: 'reference_fallback',
  input: {
    prompt: 'Keep @Element1 consistent.',
    image_urls: ['https://cdn.example.com/start.png'],
    elements: [{ frontal_image_url: 'https://cdn.example.com/subject.png' }],
  },
});
assert(compatibilityUsageWarning.warnings.some(issue =>
  issue.code === 'COMPATIBILITY_FRAME_USAGE_UNCLEAR'));
assert(compatibilityUsageWarning.warnings.some(issue =>
  issue.code === 'UNREFERENCED_PROMPT_ASSET' && issue.message.includes('@Element2')));

const bracketedTextPrompt = compileVidMuseGenerationInput({
  model: { modelName: 'provider/text-video', outputModality: 'video' },
  input: {
    prompt: '[Scene 1] A person walks into frame.',
  },
});
assert.equal(bracketedTextPrompt.errors.length, 0);
assert.equal(bracketedTextPrompt.input.prompt, '[Scene 1] A person walks into frame.');

const unknownCombination = compileVidMuseGenerationInput({
  model: { modelName: 'future/video-model', outputModality: 'video' },
  input: {
    prompt: 'Natural language without explicit bindings.',
    elements: [{ video_url: 'https://cdn.example.com/reference.mp4' }],
    audios: [{ url: 'https://cdn.example.com/reference.mp3' }],
  },
});
assert.equal(unknownCombination.errors.length, 0);
assert(unknownCombination.warnings.some(issue => issue.code === 'UNVERIFIED_MODEL_COMBINATION'));
assert(unknownCombination.warnings.some(issue => issue.code === 'UNREFERENCED_PROMPT_ASSET'));

const v2BracketedText = compileVidMuseGenerationInput({
  contractVersion: 2,
  promptFormat: 'text',
  model: { modelName: 'provider/text-video', outputModality: 'video' },
  input: { prompt: '[{"prompt":"this remains literal text","duration":2.5}]' },
});
assert.equal(v2BracketedText.errors.length, 0);
assert.equal(v2BracketedText.input.prompt, '[{"prompt":"this remains literal text","duration":2.5}]');

const v2MultiPrompt = compileVidMuseGenerationInput({
  contractVersion: 2,
  promptFormat: 'multi_prompt_json',
  model: { modelName: 'provider/text-video', outputModality: 'video' },
  input: { prompt: '[{"prompt":"first shot","duration":2.5},{"prompt":"second shot","duration":1.25}]' },
});
assert.equal(v2MultiPrompt.errors.length, 0);
assert.deepEqual(v2MultiPrompt.input.prompt, [
  { prompt: 'first shot', duration: 2.5 },
  { prompt: 'second shot', duration: 1.25 },
]);

const v2ReferenceImages = compileVidMuseGenerationInput({
  contractVersion: 2,
  model: { modelName: 'future/video-model', outputModality: 'video' },
  input: {
    prompt: 'Keep @Element1 and @Element2 consistent.',
    elements: [
      { frontal_image_url: 'https://cdn.example.com/reference-a.png' },
      { frontal_image_url: 'https://cdn.example.com/reference-b.png' },
    ],
  },
});
assert.equal(v2ReferenceImages.errors.length, 0);
assert.equal(v2ReferenceImages.generationType, 'reference_to_video');
assert.equal(v2ReferenceImages.warnings.some(issue => issue.code === 'UNVERIFIED_MODEL_COMBINATION'), false);

const v2Keyframes = compileVidMuseGenerationInput({
  contractVersion: 2,
  model: { modelName: 'future/video-model', outputModality: 'video' },
  input: {
    prompt: 'Move from @Image1 to @Image2.',
    image_urls: [
      'https://cdn.example.com/first.png',
      'https://cdn.example.com/last.png',
    ],
  },
});
assert.equal(v2Keyframes.errors.length, 0);
assert.equal(v2Keyframes.generationType, 'images_to_video');
assert.deepEqual(v2Keyframes.bindings.images.map(binding => binding.url), [
  'https://cdn.example.com/first.png',
  'https://cdn.example.com/last.png',
]);

const v2TooManyKeyframes = compileVidMuseGenerationInput({
  contractVersion: 2,
  model: { modelName: 'future/video-model', outputModality: 'video' },
  input: {
    image_urls: [
      'https://cdn.example.com/one.png',
      'https://cdn.example.com/two.png',
      'https://cdn.example.com/three.png',
    ],
  },
});
assert(v2TooManyKeyframes.errors.some(issue => issue.code === 'MCP_KEYFRAME_COUNT_EXCEEDED'));

for (const modelName of ['future/video-model', 'hailuo-h3', 'wan3']) {
  const mixed = compileVidMuseGenerationInput({
    contractVersion: 2,
    compatibilityMode: 'reference_fallback',
    model: { modelName, outputModality: 'video' },
    input: {
      image_urls: ['https://cdn.example.com/first.png'],
      elements: [{ video_url: 'https://cdn.example.com/reference.mp4' }],
    },
  });
  assert(mixed.errors.some(issue => issue.code === 'MCP_INPUT_MODE_CONFLICT'));
  assert.equal(mixed.compatibilityApplied, false);
}

const v2H3MultiViewElement = compileVidMuseGenerationInput({
  contractVersion: 2,
  model: { modelName: 'hailuo-h3', outputModality: 'video' },
  input: {
    elements: [{
      frontal_image_url: 'https://cdn.example.com/front.png',
      reference_image_urls: [
        'https://cdn.example.com/left.png',
        'https://cdn.example.com/right.png',
      ],
    }],
  },
});
assert.equal(v2H3MultiViewElement.errors.some(issue => issue.code === 'MODEL_ELEMENT_IMAGE_LIMIT'), false);

const v2WanAudioOnly = compileVidMuseGenerationInput({
  contractVersion: 2,
  model: { modelName: 'wan3', outputModality: 'video' },
  input: { audios: [{ url: 'https://cdn.example.com/reference.mp3', range: [0.1234, 3.9876] }] },
});
assert.equal(v2WanAudioOnly.errors.some(issue => issue.code === 'AUDIO_ONLY_NOT_SUPPORTED'), false);
assert.deepEqual(v2WanAudioOnly.input.audios, [
  { url: 'https://cdn.example.com/reference.mp3', range: [0.1234, 3.9876] },
]);

const v2PromptReferences = compileVidMuseGenerationInput({
  contractVersion: 2,
  model: { modelName: 'future/video-model', outputModality: 'video' },
  input: {
    prompt: 'Use @Image2 and leave @audio99 as ordinary prompt text.',
    image_urls: ['https://cdn.example.com/first.png'],
  },
});
assert(v2PromptReferences.errors.some(issue => issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE'));
assert.equal(v2PromptReferences.errors.some(issue => issue.message.includes('@audio99')), false);

for (const modelName of ['hailuo-h3', 'wan3']) {
  const dualFrame = compileVidMuseGenerationInput({
    contractVersion: 2,
    model: { modelName, outputModality: 'video' },
    input: {
      image_urls: [
        'https://cdn.example.com/first.png',
        'https://cdn.example.com/last.png',
      ],
    },
  });
  assert.equal(dualFrame.generationType, 'images_to_video');
  assert.equal(dualFrame.effectiveGenerationType, 'image_to_video');
}

const futureModel = {
  modelName: 'future/provider-video-v9',
  outputModality: 'video' as const,
  capabilities: ['text_to_video', 'image_to_video', 'images_to_video', 'reference_to_video'],
  inputSchema: {
    supported_inputs: ['prompt', 'image_urls', 'elements', 'audios'],
    required_inputs: {},
    required_one_of_inputs: {},
  },
};
const v3DualFrame = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  input: {
    prompt: 'Move from the first frame to the last frame.',
    image_urls: ['https://cdn.example.com/first.png', 'https://cdn.example.com/last.png'],
  },
});
assert.equal(v3DualFrame.generationType, 'images_to_video');
assert.equal(v3DualFrame.profileId, undefined);
assert.equal(v3DualFrame.effectiveGenerationType, undefined);

const v3PromptProposal = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  input: {
    prompt: 'Keep @image1 and @image2 consistent.',
    elements: [
      { frontal_image_url: 'https://cdn.example.com/a.png' },
      { frontal_image_url: 'https://cdn.example.com/b.png' },
    ],
  },
});
assert(v3PromptProposal.contractFindings?.some(finding => finding.id === 'plugin-prompt-image-to-element'));
assert(v3PromptProposal.errors.some(issue => issue.code === 'CONTRACT_REVIEW_REQUIRED'));
const v3AcceptedPromptProposal = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  review: { acceptedFindingIds: ['plugin-prompt-image-to-element'] },
  input: {
    prompt: 'Keep @image1 and @image2 consistent.',
    elements: [
      { frontal_image_url: 'https://cdn.example.com/a.png' },
      { frontal_image_url: 'https://cdn.example.com/b.png' },
    ],
  },
});
assert.equal(v3AcceptedPromptProposal.input.prompt, 'Keep @Element1 and @Element2 consistent.');
assert.equal(v3AcceptedPromptProposal.errors.length, 0);
const v3RejectedPromptProposal = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  review: { rejectedFindingIds: ['plugin-prompt-image-to-element'] },
  input: {
    prompt: 'Keep @image1 and @image2 consistent.',
    elements: [
      { frontal_image_url: 'https://cdn.example.com/a.png' },
      { frontal_image_url: 'https://cdn.example.com/b.png' },
    ],
  },
});
assert.equal(v3RejectedPromptProposal.input.prompt, 'Keep @image1 and @image2 consistent.');
assert(v3RejectedPromptProposal.errors.some(issue => issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE'));

const v3KnownElementTokenOutOfRange = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  input: {
    prompt: 'Keep @Element1 and @Element3 consistent.',
    elements: [
      { frontal_image_url: 'https://cdn.example.com/a.png' },
      { frontal_image_url: 'https://cdn.example.com/b.png' },
    ],
  },
});
assert(v3KnownElementTokenOutOfRange.errors.some(issue =>
  issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE' && issue.message.includes('@Element3')));

const v3UnknownTokenContract = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: { modelName: 'future/no-structured-contract', outputModality: 'video' },
  input: {
    prompt: 'Treat @Element9 as ordinary provider prompt text.',
    elements: [{ frontal_image_url: 'https://cdn.example.com/a.png' }],
  },
});
assert.equal(v3UnknownTokenContract.errors.some(issue => issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE'), false);

const v3MixedReview = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  input: {
    prompt: 'Start from @image1 while preserving @Element1.',
    image_urls: ['https://cdn.example.com/start.png'],
    elements: [{ frontal_image_url: 'https://cdn.example.com/person.png' }],
  },
});
assert.equal(v3MixedReview.generationType, 'manual_review');
assert(v3MixedReview.contractFindings?.some(finding => finding.id === 'plugin-mixed-keyframes-to-elements'));
const v3AcceptedMixed = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  review: { acceptedFindingIds: ['plugin-mixed-keyframes-to-elements'] },
  input: {
    prompt: 'Start from @image1 while preserving @Element1.',
    image_urls: ['https://cdn.example.com/start.png'],
    elements: [{ frontal_image_url: 'https://cdn.example.com/person.png' }],
  },
});
assert.equal(v3AcceptedMixed.generationType, 'reference_to_video');
assert.deepEqual(v3AcceptedMixed.input.image_urls, []);
assert.deepEqual(v3AcceptedMixed.input.elements, [
  { frontal_image_url: 'https://cdn.example.com/person.png' },
  { frontal_image_url: 'https://cdn.example.com/start.png' },
]);
assert.equal(v3AcceptedMixed.input.prompt, 'Start from @Element2 while preserving @Element1.');

const v3RelativeAudio = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: futureModel,
  input: { prompt: 'Follow the reference audio.', audios: [{ url: 'online-mining/audio/example.mp3' }] },
});
assert.deepEqual(v3RelativeAudio.input.audios, [{ url: 'online-mining/audio/example.mp3' }]);
assert(v3RelativeAudio.contractFindings?.some(finding => finding.code === 'RELATIVE_ASSET_REQUIRES_REVIEW'));
assert(v3RelativeAudio.errors.some(issue => issue.code === 'AUDIO_ONLY_MODE_REVIEW_REQUIRED'));

const v3ExplicitAudioOnly = compileVidMuseGenerationInput({
  contractVersion: 3,
  model: {
    ...futureModel,
    inputSchema: {
      ...futureModel.inputSchema,
      required_one_of_inputs: { reference_to_video: [['audios']] },
    },
  },
  input: { audios: [{ url: 'https://cdn.example.com/audio.mp3' }] },
});
assert.equal(v3ExplicitAudioOnly.generationType, 'reference_to_video');
assert.equal(v3ExplicitAudioOnly.errors.some(issue => issue.code === 'AUDIO_ONLY_MODE_REVIEW_REQUIRED'), false);

const attachmentElementsPromptCases = Array.from({ length: 18 }, (_, index) =>
  compileVidMuseGenerationInput({
    contractVersion: 3,
    model: futureModel,
    input: {
      prompt: `Keep @image1 consistent in fixture ${index}.`,
      elements: [{ frontal_image_url: `https://cdn.example.com/element-${index}.png` }],
    },
  }));
assert.equal(attachmentElementsPromptCases.filter(result => result.contractFindings?.some(
  finding => finding.id === 'plugin-prompt-image-to-element',
)).length, 18);

const attachmentKeyframePromptCases = Array.from({ length: 3 }, (_, index) =>
  compileVidMuseGenerationInput({
    contractVersion: 3,
    model: futureModel,
    input: {
      prompt: `Move from @Element1 to @Element2 in fixture ${index}.`,
      image_urls: [
        `https://cdn.example.com/first-${index}.png`,
        `https://cdn.example.com/last-${index}.png`,
      ],
    },
  }));
assert.equal(attachmentKeyframePromptCases.filter(result => result.contractFindings?.some(
  finding => finding.id === 'plugin-prompt-element-to-image',
)).length, 3);

const attachmentMixedCases = Array.from({ length: 11 }, (_, index) =>
  compileVidMuseGenerationInput({
    contractVersion: 3,
    model: futureModel,
    input: {
      prompt: `Mixed fixture ${index}.`,
      image_urls: [`https://cdn.example.com/frame-${index}.png`],
      elements: [{ frontal_image_url: `https://cdn.example.com/reference-${index}.png` }],
      ...(index % 2 ? { audios: [{ url: `https://cdn.example.com/audio-${index}.mp3` }] } : {}),
    },
  }));
assert.equal(attachmentMixedCases.filter(result => result.generationType === 'manual_review').length, 11);
assert.equal(attachmentMixedCases.filter(result => result.contractFindings?.some(
  finding => finding.id === 'plugin-mixed-keyframes-to-elements',
)).length, 11);

const parsedArray = parseVidMuseDatasetJson('[{"case_id":"a","prompt":"one"}]');
assert.deepEqual(parsedArray.rows, [{ case_id: 'a', prompt: 'one' }]);
assert.deepEqual(parsedArray.headers, ['case_id', 'prompt']);
const parsedEnvelope = parseVidMuseDatasetJson('{"items":[{"case_id":"b","elements":[{"element_id":3}]}]}');
assert.deepEqual(parsedEnvelope.rows[0].elements, [{ element_id: 3 }]);
assert.throws(() => parseVidMuseDatasetJson('{"items":{}}'), /items.*array/i);
assert.deepEqual(extractMediaUrls({
  frontal_image_url: 'https://cdn.example.com/front.png',
  nested: [{ video_url: 'https://cdn.example.com/motion.mp4' }],
}), [
  'https://cdn.example.com/front.png',
  'https://cdn.example.com/motion.mp4',
]);

console.log('VidMuse MCP input contract tests passed.');
