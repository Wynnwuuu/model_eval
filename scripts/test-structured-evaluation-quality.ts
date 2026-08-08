import assert from 'node:assert/strict';

import { analyzeStructuredEvaluationDataset } from '../server/audit/structuredEvaluationQualityAudit.ts';
import { getMediaProbeUrlRejection } from './lib/mediaProbe.ts';
import { ensureStableDatasetItemIds } from '../src/datasetSync.ts';
import { VIDMUSE_STRUCTURED_EVALUATION_COLUMNS } from '../src/features/datasets/preservedSourceImport.ts';
import type { EvalDataset } from '../src/types.ts';

const sourceRows = [
  {
    case_id: 'valid-reference', cell_id: 'I', modality: 'video', variant_label: 'reference',
    prompt: 'Keep @Element1 consistent.', duration: 5, aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
    elements: JSON.stringify([{ frontal_image_url: 'https://cdn.example.com/person.png' }]),
  },
  {
    case_id: 'bad-element-union', cell_id: 'VI', modality: 'video', variant_label: 'reference',
    prompt: 'Use @Element1.', duration: 5, aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
    elements: JSON.stringify([{
      frontal_image_url: 'https://cdn.example.com/person.mp4',
      video_url: 'https://cdn.example.com/reference.mp4',
    }]),
  },
  {
    case_id: 'bad-audio-kind', cell_id: 'A', modality: 'video', variant_label: 'audio',
    prompt: 'Follow the input audio while keeping the video silent with no audio.',
    duration: 5, aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
    audio_url: 'https://cdn.example.com/reference.mp4',
  },
  {
    case_id: 'placeholder-mismatch', cell_id: 'I', modality: 'video', variant_label: 'elements_approx',
    prompt: 'Use @Image2 as the subject and the final frame.',
    duration: 5, aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
    elements: JSON.stringify([{ frontal_image_url: 'https://cdn.example.com/person.png' }]),
  },
  {
    case_id: 'missing-audio-placeholder', cell_id: 'M', modality: 'video', variant_label: 'mcp_direct',
    prompt: 'Cut the shots to @audio1.',
    duration: 5, aspect_ratio: '16:9', resolution: '720p', generate_audio: true,
  },
];

assert.equal(getMediaProbeUrlRejection('online-mining/audio/example.mp3'), 'relative_or_non_http_url');
assert.equal(getMediaProbeUrlRejection('file:///C:/secret.txt'), 'relative_or_non_http_url');
assert.equal(getMediaProbeUrlRejection('http://localhost/media.mp4'), 'non_public_media_url');
assert.equal(getMediaProbeUrlRejection('http://127.0.0.1/media.mp4'), 'non_public_media_url');
assert.equal(getMediaProbeUrlRejection('http://192.168.1.2/media.mp4'), 'non_public_media_url');
assert.equal(getMediaProbeUrlRejection('https://cdn.example.com/media.mp4'), undefined);

const rows = sourceRows.map(row => Object.fromEntries(
  VIDMUSE_STRUCTURED_EVALUATION_COLUMNS.map(key => [key, row[key as keyof typeof row] ?? null]),
));
const dataset: EvalDataset = {
  id: 'quality-audit-test',
  name: 'Quality audit test',
  description: '',
  tags: [],
  inputSchema: VIDMUSE_STRUCTURED_EVALUATION_COLUMNS.map(key => ({
    key, label: key, type: 'text', sourceKey: key,
    role: key === 'case_id' ? 'case_id' : key === 'prompt' ? 'input' : 'metadata',
  })),
  items: ensureStableDatasetItemIds('quality-audit-test', rows),
  createdAt: 1,
  updatedAt: 1,
};

const audit = analyzeStructuredEvaluationDataset(dataset);
assert.equal(audit.cases.length, 5);
assert.equal(audit.summary.totalCases, 5);
assert.equal(audit.summary.byMcpStatus.valid, 3);
assert.equal(audit.summary.byMcpStatus.blocked, 1);
assert.equal(audit.summary.byMcpStatus.review, 1);
assert(audit.cases.find(item => item.caseId === 'bad-element-union')?.issues.some(issue => issue.code === 'ELEMENT_MODE_CONFLICT'));
assert(audit.cases.find(item => item.caseId === 'bad-element-union')?.issues.some(issue => issue.code === 'MEDIA_TYPE_MISMATCH'));
assert(audit.cases.find(item => item.caseId === 'bad-audio-kind')?.issues.some(issue => issue.code === 'AUDIO_INTENT_CONTRADICTION'));
assert(audit.cases.find(item => item.caseId === 'bad-audio-kind')?.issues.some(issue => issue.code === 'MEDIA_TYPE_MISMATCH'));
assert(audit.cases.find(item => item.caseId === 'placeholder-mismatch')?.issues.some(issue =>
  issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE' && issue.severity === 'medium'));
assert(audit.cases.find(item => item.caseId === 'missing-audio-placeholder')?.issues.some(issue =>
  issue.code === 'PROMPT_REFERENCE_OUT_OF_RANGE'
  && issue.message.includes('@audio1')
  && issue.severity === 'high'));
assert.equal(audit.mediaReferences.length, 5);

console.log('Structured evaluation quality tests passed.');
