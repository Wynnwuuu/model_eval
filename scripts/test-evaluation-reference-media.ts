import assert from 'node:assert/strict';

import {
  getEvaluationReferenceInputKeys,
  resolveEvaluationReferenceMedia,
} from '../src/evaluationReferenceMedia';
import type { EvaluationItem } from '../src/types';

const item: EvaluationItem = {
  id: 'mixed-reference-case',
  modelA_Url: 'https://outputs.example.com/model-a.mp4',
  modelB_Url: 'https://outputs.example.com/model-b.mp4',
  modelOutputs: [
    { modelId: 'a', modelName: 'A', url: 'https://outputs.example.com/model-a.mp4' },
    { modelId: 'b', modelName: 'B', url: 'https://outputs.example.com/model-b.mp4' },
  ],
  prompt: 'Compare the outputs. Documentation: https://docs.example.com/spec',
  inputs: {
    prompt: 'Compare the outputs. Documentation: https://docs.example.com/spec',
    image_urls: JSON.stringify([
      'https://assets.example.com/first-no-extension',
      'https://assets.example.com/shared.jpg',
    ]),
    elements: [
      {
        frontal_image_url: 'https://assets.example.com/character-no-extension',
        reference_image_urls: ['https://assets.example.com/shared.jpg'],
        prompt: 'Keep https://docs.example.com/element-guide out of the media strip.',
      },
      { video_url: 'https://assets.example.com/motion-no-extension' },
    ],
    audios: [{ audio_url: 'https://assets.example.com/voice-no-extension' }],
    notes: 'Do not collect https://docs.example.com/notes as media.',
    image_prompt: 'Do not collect https://docs.example.com/image-prompt as media.',
  },
  startImageUrl: 'https://assets.example.com/first-no-extension',
  referenceUrls: [
    'https://assets.example.com/shared.jpg',
    'https://assets.example.com/character-no-extension',
    'https://assets.example.com/motion-no-extension',
    'https://assets.example.com/voice-no-extension',
  ],
  type: 'video',
};

const media = resolveEvaluationReferenceMedia(item);
assert.deepEqual(
  media.map(entry => ({ url: entry.url, type: entry.type, sourceOrder: entry.sourceOrder })),
  [
    { url: 'https://assets.example.com/first-no-extension', type: 'image', sourceOrder: 0 },
    { url: 'https://assets.example.com/shared.jpg', type: 'image', sourceOrder: 1 },
    { url: 'https://assets.example.com/character-no-extension', type: 'image', sourceOrder: 2 },
    { url: 'https://assets.example.com/motion-no-extension', type: 'video', sourceOrder: 3 },
    { url: 'https://assets.example.com/voice-no-extension', type: 'audio', sourceOrder: 4 },
  ],
  'reference media must preserve source order, infer nested types, and deduplicate URLs',
);
assert.deepEqual(
  [...getEvaluationReferenceInputKeys(item)],
  ['image_urls', 'elements', 'audios'],
  'media input keys must be available for hiding raw payloads from the prompt strip',
);
assert.ok(!media.some(entry => entry.url.includes('docs.example.com')), 'ordinary prompt and note links must not become reference media');
assert.ok(!media.some(entry => entry.url.includes('outputs.example.com')), 'model outputs must not become reference media');

const legacyItem: EvaluationItem = {
  id: 'legacy-reference-case',
  modelA_Url: '',
  modelB_Url: '',
  startImageUrl: 'https://legacy.example.com/start.png',
  referenceUrls: [
    'https://legacy.example.com/clip.mp4',
    'https://legacy.example.com/song.mp3',
    'https://legacy.example.com/start.png',
  ],
  type: 'video',
};

assert.deepEqual(
  resolveEvaluationReferenceMedia(legacyItem).map(entry => [entry.url, entry.type]),
  [
    ['https://legacy.example.com/start.png', 'image'],
    ['https://legacy.example.com/clip.mp4', 'video'],
    ['https://legacy.example.com/song.mp3', 'audio'],
  ],
  'legacy items must retain stored order and deduplicate start/reference URLs',
);

const customColumnItem: EvaluationItem = {
  id: 'custom-reference-case',
  modelA_Url: '',
  modelB_Url: '',
  inputs: {
    character_asset: 'https://assets.example.com/custom.webp',
    website: 'https://example.com',
  },
  referenceUrls: ['https://assets.example.com/custom.webp'],
  type: 'image',
};

assert.deepEqual(
  resolveEvaluationReferenceMedia(customColumnItem).map(entry => entry.url),
  ['https://assets.example.com/custom.webp'],
  'stored references from custom columns must recover their original input position',
);
assert.deepEqual([...getEvaluationReferenceInputKeys(customColumnItem)], ['character_asset']);

console.log('Evaluation reference media tests passed.');
