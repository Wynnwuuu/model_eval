import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { RequestUser } from '../server/auth/context.ts';
import { closeDatabase, dbPool } from '../server/db/client.ts';
import { getDataset, getDatasetVersion, listDatasets, saveDataset } from '../server/datasets/datasetRepository.ts';
import {
  applyDatasetSyncPreview,
  createDatasetSyncPreview,
  updateDatasetSyncPreview,
} from '../server/datasets/datasetSyncService.ts';
import {
  createGenerationBatchFromPreflight,
  saveGenerationPreflight,
  type StoredGenerationPreflight,
} from '../server/generation/generationExecutionRepository.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import { DATASET_RESULT_META_KEY } from '../src/datasetVersionedSync.ts';
import type { EvalDataset } from '../src/types.ts';

const suffix = randomUUID();
const datasetId = `dataset-versioned-sync-${suffix}`;
const user: RequestUser = {
  id: `dataset-sync-user-${suffix}`,
  email: `dataset-sync-${suffix}@example.com`,
  displayName: 'Dataset Sync DB Test',
  organizationId: 'default',
};

const manualSource = (rows: Record<string, unknown>[]) => ({
  kind: 'manual' as const,
  headers: ['case_id', 'variant_label', 'prompt', 'category', 'model_result'],
  rows,
  label: 'DB integration fixture',
});

const makePreflight = (dataset: EvalDataset, requestHash: string): StoredGenerationPreflight => {
  const row = dataset.items[0];
  const now = Date.now();
  const model = {
    id: 'fake-image',
    modelName: 'fake/image',
    displayName: 'Fake image',
    outputModality: 'image',
    provider: 'fake',
    transport: 'model_api',
    capabilities: { textToImage: true },
    generationTypes: ['text_to_image'],
    controls: [],
    configFingerprint: 'fake-config',
    rawConfig: {},
  } as any;
  const resolvedCase = {
    caseId: row.case_id,
    datasetItemId: row[DATASET_ITEM_ID_KEY],
    rowIndex: 0,
    prompt: row.prompt,
    controls: {},
    generationType: 'text_to_image',
  };
  return {
    id: `preflight-${randomUUID()}`,
    datasetId: dataset.id,
    datasetVersion: dataset.version || 1,
    modelName: model.modelName,
    configFingerprint: model.configFingerprint,
    requestHash,
    payload: {
      datasetId: dataset.id,
      datasetVersion: dataset.version || 1,
      datasetName: dataset.name,
      targetColumn: 'model_result',
      modelName: model.modelName,
      selectedDatasetItemIds: [row[DATASET_ITEM_ID_KEY]],
      inputMapping: { promptColumn: 'prompt' },
      defaultControls: {},
      perCaseControlColumns: {},
      seedMode: 'unused',
      seedPolicyVersion: 2,
    },
    result: {
      model,
      cases: [{ valid: true, generationType: 'text_to_image', errors: [], warnings: [], resolvedCase }],
      selectionSummary: { datasetTotal: dataset.items.length, selected: 1, valid: 1, invalid: 0, unselected: dataset.items.length - 1 },
      costEstimate: { known: false },
      requestHash,
      expiresAt: now + 60_000,
    },
    createdBy: user.id,
    expiresAt: now + 60_000,
  };
};

try {
  await dbPool.query('INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)', [user.id, user.email, user.displayName]);
  await dbPool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ('default', $1, 'admin')", [user.id]);
  const initial = await saveDataset({
    id: datasetId,
    name: 'Versioned synchronization DB test',
    description: '',
    tags: [],
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    inputSchema: [
      { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id' },
      { key: 'variant_label', label: 'variant_label', type: 'text', role: 'metadata' },
      { key: 'prompt', label: 'prompt', type: 'text', role: 'input' },
      { key: 'category', label: 'category', type: 'text', role: 'metadata' },
      { key: 'model_result', label: 'model_result', type: 'video_url', role: 'output', previewType: 'video' },
    ],
    columnMappings: {
      caseId: 'case_id',
      inputColumns: ['prompt'],
      outputColumns: ['model_result'],
      dimensionColumns: [],
      referenceColumns: [],
      standard: { case_id: 'case_id', prompt: 'prompt' },
    },
    items: [
      { case_id: 'case-1', variant_label: '', prompt: 'old prompt', category: 'old', model_result: 'https://example.com/one.mp4' },
      { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'old', model_result: 'https://example.com/two.mp4' },
    ],
  }, user.id, { deferPropagation: true });
  const stableOne = initial.items[0][DATASET_ITEM_ID_KEY];
  const stableTwo = initial.items[1][DATASET_ITEM_ID_KEY];

  const firstPreview = await createDatasetSyncPreview(datasetId, 1, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'new', model_result: '' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  assert.equal(firstPreview.syncMode, 'merge');
  assert.equal(firstPreview.summary.added, 1);
  assert.equal(firstPreview.summary.updated, 1);
  assert.equal(firstPreview.summary.deleted, 0);
  assert.equal(firstPreview.summary.unchanged, 1);
  assert.equal(firstPreview.summary.staleResults, 1);
  const versionTwo = await applyDatasetSyncPreview(firstPreview.id, {
    decisionFingerprint: firstPreview.decisionFingerprint,
  }, user);
  assert.equal(versionTwo.version, 2);
  assert.equal(versionTwo.items[0][DATASET_ITEM_ID_KEY], stableOne);
  assert.equal(versionTwo.items[0].model_result, 'https://example.com/one.mp4');
  assert.equal(versionTwo.items[0][DATASET_RESULT_META_KEY].model_result.stale, true);
  assert.equal(versionTwo.items.length, 3, 'merge synchronization must retain source-omitted cases');
  assert.equal(versionTwo.datasetCard?.sampleSize, 3);
  assert.match(versionTwo.datasetCard?.latestChange || '', /更新评测集/);

  const snapshotDraft = await createDatasetSyncPreview(datasetId, 2, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'new', model_result: '' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  const snapshotPreview = await updateDatasetSyncPreview(snapshotDraft.id, { syncMode: 'snapshot' }, user);
  assert.equal(snapshotPreview.summary.deleted, 1);
  assert.equal(snapshotPreview.requiresDeletionConfirmation, true);
  await assert.rejects(
    applyDatasetSyncPreview(snapshotPreview.id, { decisionFingerprint: snapshotPreview.decisionFingerprint }, user),
    (error: any) => error?.statusCode === 400,
    'snapshot deletion must require explicit confirmation',
  );
  const versionThree = await applyDatasetSyncPreview(snapshotPreview.id, {
    decisionFingerprint: snapshotPreview.decisionFingerprint,
    confirmCaseDeletion: true,
  }, user);
  assert.equal(versionThree.items.length, 2);

  const restorePreview = await createDatasetSyncPreview(datasetId, 3, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'new', model_result: '' },
    { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'restored', model_result: '' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  assert.equal(restorePreview.summary.restored, 1);
  const versionFour = await applyDatasetSyncPreview(restorePreview.id, {
    decisionFingerprint: restorePreview.decisionFingerprint,
  }, user);
  const restored = versionFour.items.find(row => row.case_id === 'case-2')!;
  assert.equal(restored[DATASET_ITEM_ID_KEY], stableTwo);
  assert.equal(restored.model_result, 'https://example.com/two.mp4');

  const overwriteDraft = await createDatasetSyncPreview(datasetId, 4, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'new', model_result: 'https://source.example.com/replaced.mp4' },
    { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'restored', model_result: 'https://example.com/two.mp4' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  const overwritePreview = await updateDatasetSyncPreview(overwriteDraft.id, {
    outputPolicies: { model_result: 'source_overwrite' },
  }, user);
  assert.equal(overwritePreview.summary.sourceResultReplacements, 1);
  assert.equal(overwritePreview.requiresOverwriteConfirmation, true);
  await assert.rejects(
    applyDatasetSyncPreview(overwritePreview.id, { decisionFingerprint: overwritePreview.decisionFingerprint }, user),
    (error: any) => error?.statusCode === 400,
    'source-authoritative result replacement must require explicit confirmation',
  );
  const versionFive = await applyDatasetSyncPreview(overwritePreview.id, {
    decisionFingerprint: overwritePreview.decisionFingerprint,
    confirmSourceResultOverwrite: true,
  }, user);
  assert.equal(versionFive.items[0].model_result, 'https://source.example.com/replaced.mp4');

  const noChangePreview = await createDatasetSyncPreview(datasetId, 5, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'new', model_result: 'https://source.example.com/replaced.mp4' },
    { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'restored', model_result: 'https://example.com/two.mp4' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  assert.equal(noChangePreview.hasChanges, false);
  await assert.rejects(
    applyDatasetSyncPreview(noChangePreview.id, { decisionFingerprint: noChangePreview.decisionFingerprint }, user),
    (error: any) => error?.code === 'DATASET_SYNC_NO_CHANGES',
  );
  const promotedColumnPreview = await updateDatasetSyncPreview(noChangePreview.id, {
    columnRoles: { category: 'output' },
  }, user);
  assert.equal(promotedColumnPreview.outputPolicies.category, 'preserve_platform');
  assert.equal(promotedColumnPreview.outputColumns.includes('category'), true);
  const restoredColumnPreview = await updateDatasetSyncPreview(noChangePreview.id, {
    columnRoles: { category: 'source' },
  }, user);
  assert.equal(Object.prototype.hasOwnProperty.call(restoredColumnPreview.outputPolicies, 'category'), false);
  assert.equal(restoredColumnPreview.outputColumns.includes('category'), false);
  assert.equal(restoredColumnPreview.hasChanges, false);

  const stalePreflight = makePreflight(versionFive, `stale-${suffix}`);
  const metadataPreview = await createDatasetSyncPreview(datasetId, 5, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'metadata changed', model_result: '' },
    { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'restored', model_result: '' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  await assert.rejects(
    applyDatasetSyncPreview(metadataPreview.id, { decisionFingerprint: 'stale-decision' }, user),
    (error: any) => error?.statusCode === 409,
    'apply must reject a decision fingerprint that does not match the displayed preview',
  );
  const versionSix = await applyDatasetSyncPreview(metadataPreview.id, {
    decisionFingerprint: metadataPreview.decisionFingerprint,
  }, user);
  assert.equal(versionSix.version, 6);
  await assert.rejects(
    createGenerationBatchFromPreflight(stalePreflight, user),
    (error: any) => error?.statusCode === 409,
    'a preflight from an earlier dataset version must never create a batch',
  );

  const currentPreflight = makePreflight(versionSix, `current-${suffix}`);
  await saveGenerationPreflight(currentPreflight);
  await createGenerationBatchFromPreflight(currentPreflight, user);
  const demotionDraft = await createDatasetSyncPreview(datasetId, 6, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'metadata changed', model_result: '' },
    { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'restored', model_result: '' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  const demotionPreview = await updateDatasetSyncPreview(demotionDraft.id, {
    columnRoles: { model_result: 'source' },
  }, user);
  assert.equal(demotionPreview.requiresDemotionConfirmation, true);
  assert.equal(demotionPreview.blockers.length, 1, 'a running target column must not be demoted');
  assert.match(demotionPreview.blockers[0].reasons.join('；'), /降级为数据字段/);
  const allowedMetadataPreview = await createDatasetSyncPreview(datasetId, 6, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'new prompt', category: 'metadata changed while queued', model_result: '' },
    { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'restored', model_result: '' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  assert.equal(allowedMetadataPreview.blockers.length, 0, 'unrelated metadata edits must remain available while generation is queued');
  const versionSeven = await applyDatasetSyncPreview(allowedMetadataPreview.id, {
    decisionFingerprint: allowedMetadataPreview.decisionFingerprint,
  }, user);
  assert.equal(versionSeven.version, 7);

  const blockedPreview = await createDatasetSyncPreview(datasetId, 7, manualSource([
    { case_id: 'case-1', variant_label: '', prompt: 'changed while queued', category: 'metadata changed while queued', model_result: '' },
    { case_id: 'case-2', variant_label: 'alt', prompt: 'restore later', category: 'restored', model_result: '' },
    { case_id: 'case-3', variant_label: '', prompt: 'added', category: 'new', model_result: '' },
  ]), user);
  assert.equal(blockedPreview.blockers.length, 1);
  assert.equal(blockedPreview.blockers[0].jobId.startsWith('gen-'), true);
  await assert.rejects(
    applyDatasetSyncPreview(blockedPreview.id, { decisionFingerprint: blockedPreview.decisionFingerprint }, user),
    (error: any) => error?.code === 'DATASET_SYNC_GENERATION_BLOCKED',
  );

  assert.equal((await getDataset(datasetId))?.version, 7, 'a blocked synchronization must not create a partial version');
  const listedDataset = (await listDatasets()).find(dataset => dataset.id === datasetId);
  assert.equal(listedDataset?.version, 7, 'dataset listings must materialize the current version');
  assert.equal(listedDataset?.items.length, 3, 'dataset listings must retain every current case');
  const versionOne = await getDatasetVersion(datasetId, 1);
  assert.equal(versionOne?.items[0].prompt, 'old prompt', 'explicit historical version reads must remain available');
  assert.equal(versionOne?.items.length, 2, 'historical reads must materialize only the requested version');
  console.log('Versioned dataset synchronization PostgreSQL tests passed.');
} finally {
  await dbPool.query('DELETE FROM datasets WHERE id = $1', [datasetId]).catch(() => undefined);
  await dbPool.query('DELETE FROM users WHERE id = $1', [user.id]).catch(() => undefined);
  await closeDatabase();
}
