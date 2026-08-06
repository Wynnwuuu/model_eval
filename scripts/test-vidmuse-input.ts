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
