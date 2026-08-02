import assert from 'node:assert/strict';

import {
  inferDatasetImportMappings,
  normalizeDatasetRows,
} from '../src/datasetManifest';
import type { DatasetSchemaField } from '../src/types';

const wideRows = [{
  case_id: 'case-1',
  prompt: 'Create a short product video.',
  ref_image: 'https://example.com/reference.png',
  audio_url: 'https://example.com/reference.mp3',
  first_frame: 'https://example.com/start.jpg',
  last_frame: 'https://example.com/end.jpg',
  lyrics: 'A short lyric line.',
  model_a: 'https://example.com/model-a.mp4',
  model_audio_result: 'https://example.com/model-c.mp3',
  reference_audio_track: 'https://example.com/reference-track.mp3',
  anonymous_video: 'https://example.com/model-b.mp4',
  difficulty: 'hard',
  rubric: 'Keep the subject consistent.',
  aspect_ratio: '16:9',
  random_note: 'internal note',
  docs_url: 'https://example.com/readme',
}];

const headers = Object.keys(wideRows[0]);
const mappings = inferDatasetImportMappings(headers, wideRows);

assert.equal(mappings.caseId, 'case_id');
assert.equal(mappings.standard.case_id, 'case_id');
assert.equal(mappings.standard.full_prompt, 'prompt');
assert.equal(mappings.standard.reference_image_urls, 'ref_image');
assert.equal(mappings.standard.audio_url, 'audio_url');
assert.equal(mappings.standard.start_image_url, 'first_frame');
assert.equal(mappings.standard.end_image_url, 'last_frame');
assert.equal(mappings.standard.lyrics_or_dialogue, 'lyrics');
assert.deepEqual(mappings.inputColumns, ['prompt', 'lyrics']);
assert.deepEqual(
  mappings.referenceColumns,
  ['ref_image', 'audio_url', 'first_frame', 'last_frame', 'reference_audio_track']
);
assert.deepEqual(mappings.outputColumns, ['model_a', 'model_audio_result', 'anonymous_video']);
assert.deepEqual(mappings.dimensionColumns, []);
assert.equal(mappings.standard.eval_dimension, undefined);
assert.equal(mappings.standard.rubric, undefined);
assert.equal(mappings.standard.aspect_ratio, undefined);
assert.ok(!mappings.inputColumns.includes('random_note'));
assert.ok(mappings.referenceColumns.includes('reference_audio_track'));
assert.ok(!mappings.referenceColumns.includes('model_audio_result'));
assert.ok(!mappings.outputColumns.includes('docs_url'));
assert.ok(!mappings.outputColumns.includes('ref_image'));

const activeSchema: DatasetSchemaField[] = [
  { key: 'FullPrompt', label: 'Full prompt', type: 'text', role: 'input', sourceKey: 'prompt' },
  { key: 'ReferenceImage', label: 'Reference image', type: 'image_url', role: 'reference', sourceKey: 'ref_image', previewType: 'image' },
  { key: 'model_a', label: 'model_a', type: 'video_url', role: 'output', sourceKey: 'model_a', previewType: 'video' },
];

const activeOnlyRows = normalizeDatasetRows(wideRows, mappings, activeSchema, { activeFieldsOnly: true });
assert.equal(activeOnlyRows[0].FullPrompt, wideRows[0].prompt);
assert.equal(activeOnlyRows[0].ReferenceImage, wideRows[0].ref_image);
assert.equal(activeOnlyRows[0].model_a, wideRows[0].model_a);
assert.equal(activeOnlyRows[0]['\u7528\u4f8bID'], 'case-1');
assert.equal(activeOnlyRows[0].difficulty, undefined);
assert.equal(activeOnlyRows[0].rubric, undefined);
assert.equal(activeOnlyRows[0].random_note, undefined);
assert.equal(activeOnlyRows[0]._originalData.difficulty, 'hard');
assert.equal(activeOnlyRows[0]._originalData.random_note, 'internal note');

const legacyRows = normalizeDatasetRows(wideRows, mappings, activeSchema);
assert.equal(legacyRows[0].difficulty, 'hard', 'legacy normalization must preserve root columns');

const generatedIdRows = normalizeDatasetRows(
  [{ prompt: 'No source ID.' }],
  inferDatasetImportMappings(['prompt'], [{ prompt: 'No source ID.' }]),
  [{ key: 'FullPrompt', label: 'Full prompt', type: 'text', role: 'input', sourceKey: 'prompt' }],
  { activeFieldsOnly: true }
);
assert.equal(generatedIdRows[0]['\u7528\u4f8bID'], 'case-0001');

console.log('Dataset import mapping tests passed.');
