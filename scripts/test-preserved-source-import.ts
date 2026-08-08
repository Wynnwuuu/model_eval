import assert from 'node:assert/strict';

import {
  VIDMUSE_STRUCTURED_EVALUATION_COLUMNS,
  VIDMUSE_STRUCTURED_AUDIT_COLUMNS,
  buildPreservedEvaluationDataset,
  parseAuditedEvaluationImportEnvelope,
  parsePreservedEvaluationImportEnvelope,
  parseVerifiedEvaluationImportEnvelope,
  sameVerifiedEvaluationDatasetContent,
  unwrapFeishuTransportLink,
  verifyPreservedEvaluationDataset,
  type FeishuBaseSnapshot,
} from '../src/features/datasets/preservedSourceImport.ts';

const rawHttps = '[https://cdn.example.com/reference%20one.png](https://cdn.example.com/reference%20one.png)';
const rawRelative = '[online-mining/thread/assets/audio.mp3](http://online-mining/thread/assets/audio.mp3)';
const rawRelativeDirect = '[online-mining/thread/assets/audio.mp3](online-mining/thread/assets/audio.mp3)';
const fields = [...VIDMUSE_STRUCTURED_EVALUATION_COLUMNS];
const values = (overrides: Record<string, unknown>) => fields.map(field => overrides[field] ?? null);

assert.equal(unwrapFeishuTransportLink(rawRelative), 'online-mining/thread/assets/audio.mp3');
assert.equal(unwrapFeishuTransportLink(rawRelativeDirect), 'online-mining/thread/assets/audio.mp3');

const snapshot: FeishuBaseSnapshot = {
  sourceUrl: 'https://example.feishu.cn/base/source?table=table&view=view',
  baseToken: 'base-token',
  tableId: 'table-id',
  viewId: 'view-id',
  fetchedAt: '2026-08-08T10:00:00.000Z',
  snapshotHash: 'sha256:test-snapshot',
  fields,
  fieldIds: fields.map((_, index) => `field-${index + 1}`),
  fieldTypes: [
    'text', 'select', 'select', 'text', 'text', 'text', 'text', 'number',
    'select', 'text', 'checkbox', 'text', 'text', 'text', 'text', 'text',
  ],
  records: [
    {
      recordId: 'record-1',
      values: values({
        case_id: 'video-reference-1',
        cell_id: ['AI'],
        modality: ['video'],
        variant_label: 'reference',
        prompt: 'Use @Element1 as the identity reference.',
        duration: 5,
        aspect_ratio: ['16:9'],
        resolution: '720p',
        generate_audio: true,
        audio_url: rawRelative,
        elements: JSON.stringify([{ frontal_image_url: rawHttps, video_url: null }]),
      }),
    },
    {
      recordId: 'record-2',
      values: values({
        case_id: 'video-keyframes-1',
        cell_id: ['IS'],
        modality: ['video'],
        variant_label: 'keyframes',
        prompt: 'Move from @Image1 to @Image2.',
        duration: 4,
        aspect_ratio: ['9:16'],
        resolution: '720p',
        generate_audio: false,
        image_urls: JSON.stringify([rawHttps, 'https://cdn.example.com/last.png']),
      }),
    },
    {
      recordId: 'record-3',
      values: values({
        case_id: 'video-keyframes-1',
        cell_id: ['IS'],
        modality: ['video'],
        variant_label: 'reference-approximation',
        prompt: 'Keep @Element1 consistent.',
        duration: 4,
        aspect_ratio: ['9:16'],
        resolution: '720p',
        generate_audio: true,
        elements: JSON.stringify([{ frontal_image_url: 'https://cdn.example.com/person.png' }]),
      }),
    },
  ],
};

const dataset = buildPreservedEvaluationDataset(snapshot, {
  id: 'ds-preserved-source-test',
  name: 'Preserved source test',
  now: Date.parse(snapshot.fetchedAt),
});

assert.deepEqual(dataset.inputSchema.map(field => field.key), fields);
assert.deepEqual(dataset.inputSchema.map(field => field.label), fields);
assert.equal(dataset.inputSchema.some(field => field.key === '用例ID'), false);
assert.deepEqual(Object.keys(dataset.items[0]).filter(key => !key.startsWith('__') && key !== '_originalData'), fields);
assert.equal(dataset.items[0].cell_id, 'AI');
assert.equal(dataset.items[0].modality, 'video');
assert.equal(dataset.items[0].aspect_ratio, '16:9');
assert.equal(dataset.items[0].audio_url, 'online-mining/thread/assets/audio.mp3');
assert.equal(JSON.parse(dataset.items[0].elements)[0].frontal_image_url, 'https://cdn.example.com/reference%20one.png');
assert.equal(JSON.parse(dataset.items[1].image_urls)[0], 'https://cdn.example.com/reference%20one.png');
assert.equal(dataset.items[0]._originalData.audio_url, rawRelative);
assert.equal(dataset.items[0].__feishuRecordId, 'record-1');
assert.equal(dataset.items[0].__sourceSnapshotHash, snapshot.snapshotHash);
assert.equal(dataset.items[0].__sourceNormalizationVersion, 2);
assert.notEqual(dataset.items[1].__datasetItemId, dataset.items[2].__datasetItemId);
assert.equal(dataset.columnMappings?.caseId, 'case_id');
assert.deepEqual(dataset.columnMappings?.inputColumns, ['prompt']);
assert.deepEqual(dataset.columnMappings?.referenceColumns, ['audio_url', 'image_urls', 'elements']);

const verification = verifyPreservedEvaluationDataset(snapshot, dataset);
assert.equal(verification.ok, true, verification.errors.join('\n'));
assert.equal(verification.recordCount, 3);
assert.equal(verification.visibleColumnCount, 16);
assert.equal(verification.transportNormalizations, 12);
assert.equal(verification.normalizationVersion, 2);

const parsedEnvelope = parsePreservedEvaluationImportEnvelope(JSON.stringify({
  importMode: 'preserve_source_schema_v1',
  dataset,
  verification,
}));
assert.equal(parsedEnvelope?.dataset.id, dataset.id);
assert.equal(sameVerifiedEvaluationDatasetContent(dataset, structuredClone(dataset)), true);
assert.equal(sameVerifiedEvaluationDatasetContent(dataset, {
  ...dataset,
  items: dataset.items.map((row, index) => index === 0 ? { ...row, prompt: 'different' } : row),
}), false);
assert.throws(() => parsePreservedEvaluationImportEnvelope(JSON.stringify({
  importMode: 'preserve_source_schema_v1',
  dataset: { ...dataset, inputSchema: dataset.inputSchema.slice(1) },
  verification,
})), /exact 16-column schema/i);

const auditDataset = {
  ...dataset,
  id: 'ds-vidmuse-audit-test-snapshot',
  inputSchema: VIDMUSE_STRUCTURED_AUDIT_COLUMNS.map(key => ({
    key,
    label: key,
    type: 'text' as const,
    sourceKey: key,
    role: key === 'case_id' ? 'case_id' as const : 'metadata' as const,
  })),
  items: [{
    ...Object.fromEntries(VIDMUSE_STRUCTURED_AUDIT_COLUMNS.map(key => [key, key === 'source_record_id' ? 'record-1' : 'ok'])),
    __sourceRecordId: 'record-1',
    __sourceSnapshotHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    __datasetItemId: 'audit-item-1',
  }],
};
const auditEnvelope = JSON.stringify({
  importMode: 'audited_dataset_v1',
  dataset: auditDataset,
  verification: {
    ok: true,
    sourceSnapshotHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    recordCount: 1,
    visibleColumnCount: VIDMUSE_STRUCTURED_AUDIT_COLUMNS.length,
  },
});
assert.equal(parseAuditedEvaluationImportEnvelope(auditEnvelope)?.dataset.id, auditDataset.id);
assert.equal(parseVerifiedEvaluationImportEnvelope(auditEnvelope)?.importMode, 'audited_dataset_v1');
assert.throws(() => parseAuditedEvaluationImportEnvelope(JSON.stringify({
  ...JSON.parse(auditEnvelope),
  dataset: { ...auditDataset, items: [{ ...auditDataset.items[0], __sourceRecordId: 'record-2' }] },
})), /missing source provenance/i);

const corrupted = {
  ...dataset,
  items: dataset.items.map((row, index) => index === 1 ? { ...row, prompt: 'changed' } : row),
};
const corruptedVerification = verifyPreservedEvaluationDataset(snapshot, corrupted);
assert.equal(corruptedVerification.ok, false);
assert(corruptedVerification.errors.some(error => error.includes('record-2')));

console.log('Preserved source import tests passed.');
