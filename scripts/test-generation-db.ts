import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { RequestUser } from '../server/auth/context.ts';
import { closeDatabase, dbPool } from '../server/db/client.ts';
import { serverConfig } from '../server/config.ts';
import { getDataset, saveDataset } from '../server/datasets/datasetRepository.ts';
import {
  beginGenerationSubmission,
  claimNextGenerationItem,
  createGenerationBatchFromPreflight,
  findGenerationWritebackCandidate,
  getGenerationBatch,
  refreshGenerationJob,
  releaseGenerationItemLease,
  requestGenerationCancellation,
  saveGenerationPreflight,
  renewGenerationItemLease,
  updateGenerationItem,
  type StoredGenerationPreflight,
} from '../server/generation/generationExecutionRepository.ts';
import { normalizeAionModelConfig } from '../server/generation/generationPlanning.ts';
import { writeGenerationBatchToDataset } from '../server/generation/generationWritebackService.ts';
import { DATASET_ITEM_ID_KEY } from '../src/datasetSync.ts';
import type { EvalDataset } from '../src/types.ts';

const suffix = randomUUID();
const user: RequestUser = {
  id: `generation-db-user-${suffix}`,
  email: `generation-db-${suffix}@example.com`,
  displayName: 'Generation DB Test',
  organizationId: 'default',
};
const datasetId = `generation-db-dataset-${suffix}`;

const model = normalizeAionModelConfig({
  name: 'fake/image-model',
  displayName: 'Fake image model',
  type: 'image',
  provider: 'fake',
  capabilities: { text2image: true },
  options: {
    required_params: { text_to_image: ['prompt'] },
    supported_params: ['prompt', 'aspect_ratio'],
    aspect_ratio_options: ['1:1'],
  },
  priceItems: [{ unit_type: 'images', price: { output: 1 } }],
});

const createPreflightRecord = (
  savedDataset: EvalDataset,
  targetColumn: string,
  requestHash: string,
): StoredGenerationPreflight => {
  const stableItemId = String(savedDataset.items[0][DATASET_ITEM_ID_KEY]);
  const resolvedCase = {
    caseId: 'case-1',
    datasetItemId: stableItemId,
    rowIndex: 0,
    prompt: 'A controlled database test image.',
    imageUrls: [],
    audioUrls: [],
    controls: { aspect_ratio: '1:1' },
    seed: 7,
    extraInputs: {},
    generationType: 'text_to_image',
  };
  const now = Date.now();
  return {
    id: `preflight-${randomUUID()}`,
    datasetId,
    datasetVersion: savedDataset.version || 1,
    modelName: model.modelName,
    configFingerprint: model.configFingerprint,
    requestHash,
    payload: {
      datasetId,
      datasetVersion: savedDataset.version || 1,
      datasetName: savedDataset.name,
      modelName: model.modelName,
      targetColumn,
      inputMapping: {
        promptColumn: 'prompt',
        referenceImageColumns: [],
        referenceAudioColumns: [],
        extraInputColumns: [],
      },
      defaultControls: { aspect_ratio: '1:1' },
      perCaseControlColumns: {},
      seedMode: 'fixed',
      fixedSeed: 7,
      assetBindings: [],
    },
    result: {
      model,
      configFingerprint: model.configFingerprint,
      validCount: 1,
      invalidCount: 0,
      total: 1,
      costEstimate: { known: true, totalCredits: 1, unitCredits: 1, unitLabel: 'image' },
      cases: [{
        valid: true,
        generationType: 'text_to_image',
        errors: [],
        warnings: [],
        resolvedCase,
      }],
      requestHash,
      expiresAt: now + 60_000,
    },
    createdBy: user.id,
    expiresAt: now + 60_000,
  };
};

try {
  await dbPool.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
    [user.id, user.email, user.displayName],
  );
  await dbPool.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ('default', $1, 'admin')`,
    [user.id],
  );

  const now = Date.now();
  const savedDataset = await saveDataset({
    id: datasetId,
    name: 'Generation DB integration test',
    description: '',
    tags: [],
    inputSchema: [{
      key: 'prompt',
      label: 'prompt',
      type: 'text',
      role: 'input',
      sourceKey: 'prompt',
      previewType: 'text',
    }],
    items: [{ case_id: 'case-1', prompt: 'A controlled database test image.' }],
    inputType: 'text',
    modality: 'image',
    columnMappings: {
      inputColumns: ['prompt'],
      outputColumns: [],
      dimensionColumns: [],
      referenceColumns: [],
      standard: { full_prompt: 'prompt' },
      caseId: 'case_id',
    },
    version: 1,
    versionHistory: [{
      version: 1,
      changedAt: now,
      changedBy: user.displayName,
      changeSummary: 'Generation DB test seed',
      itemCountBefore: 0,
      itemCountAfter: 1,
    }],
    creatorUid: user.id,
    creatorName: user.displayName,
    createdAt: now,
    updatedAt: now,
  }, user.id);

  const cancelledPreflight = createPreflightRecord(savedDataset, 'cancelled_result', `request-${suffix}-cancel`);
  await saveGenerationPreflight(cancelledPreflight);
  const cancelledJob = await createGenerationBatchFromPreflight(cancelledPreflight, user);

  const claims = await Promise.all([
    claimNextGenerationItem('image', `worker-a-${suffix}`),
    claimNextGenerationItem('image', `worker-b-${suffix}`),
  ]);
  const claimedItems = claims.filter(Boolean);
  assert.equal(claimedItems.length, 1, 'SKIP LOCKED must allow only one worker to claim the case');
  const claimedItem = claimedItems[0]!;

  assert.equal(await requestGenerationCancellation(cancelledJob.id), true);
  const maySubmitAfterCancellation = await beginGenerationSubmission(
    claimedItem.id,
    claimedItem.attempt + 1,
    Date.now(),
    Date.now(),
  );
  assert.equal(maySubmitAfterCancellation, false, 'a cancelled claimed item must not enter submitting');
  await releaseGenerationItemLease(claimedItem.id);
  const cancelledAggregate = await refreshGenerationJob(cancelledJob.id);
  assert.equal(cancelledAggregate?.status, 'cancelled');
  assert.equal(await writeGenerationBatchToDataset(cancelledJob.id), true);

  const afterCancelledWriteback = await getDataset(datasetId);
  assert.equal(afterCancelledWriteback?.version, 2);
  assert.equal(afterCancelledWriteback?.items[0].cancelled_result, undefined);
  assert.equal(afterCancelledWriteback?.items[0].cancelled_result_status, 'cancelled');

  await dbPool.query(
    `UPDATE generation_jobs
     SET writeback_status = 'running', updated_at = now() - interval '10 minutes'
     WHERE id = $1`,
    [cancelledJob.id],
  );
  assert.equal(await findGenerationWritebackCandidate(), cancelledJob.id);
  assert.equal(await writeGenerationBatchToDataset(cancelledJob.id), true);
  const afterRecoveredWriteback = await getDataset(datasetId);
  assert.equal(afterRecoveredWriteback?.version, 2, 'writeback recovery must not create a duplicate dataset version');

  const unknownPreflight = createPreflightRecord(
    afterRecoveredWriteback!,
    'unknown_result',
    `request-${suffix}-unknown`,
  );
  await saveGenerationPreflight(unknownPreflight);
  const unknownJob = await createGenerationBatchFromPreflight(unknownPreflight, user);
  const unknownClaim = await claimNextGenerationItem('image', `worker-unknown-${suffix}`);
  assert.equal(unknownClaim?.jobId, unknownJob.id);
  await updateGenerationItem(unknownClaim!.id, {
    status: 'submission_unknown',
    error: { code: 'TEST_SUBMISSION_UNKNOWN', message: 'Simulated lost POST response.' },
    finishedAt: Date.now(),
    nextPollAt: null,
  });
  await releaseGenerationItemLease(unknownClaim!.id);
  await refreshGenerationJob(unknownJob.id);
  assert.equal(await claimNextGenerationItem('image', `worker-no-resend-${suffix}`), null);
  await writeGenerationBatchToDataset(unknownJob.id);
  const unknownBatch = await getGenerationBatch(unknownJob.id);
  assert.equal(unknownBatch?.items[0].attempt, 0);
  assert.equal(unknownBatch?.items[0].status, 'submission_unknown');
  assert.equal(unknownBatch?.writebackStatus, 'completed');

  const stableProviderUrl = 'https://provider.example.com/result.png?expires=soon';
  const stableAssetUrl = 'https://vidmuse-dev.sandcdn.com/user/796854911166661/assets/images/result.png';
  const stablePreflight = createPreflightRecord(
    (await getDataset(datasetId))!,
    'stable_result',
    `request-${suffix}-stable`,
  );
  await saveGenerationPreflight(stablePreflight);
  const stableJob = await createGenerationBatchFromPreflight(stablePreflight, user);
  const stableClaim = await claimNextGenerationItem('image', `worker-stable-${suffix}`);
  assert.equal(stableClaim?.jobId, stableJob.id);
  await updateGenerationItem(stableClaim!.id, {
    status: 'succeeded',
    providerTaskId: 'provider-stable-request',
    providerStatus: 'succeed',
    result: {
      originalResultUrl: stableProviderUrl,
      resultUrl: stableAssetUrl,
      durability: 'vidmuse_asset',
      mediaType: 'image',
    },
    finishedAt: Date.now(),
    nextPollAt: null,
  });
  await releaseGenerationItemLease(stableClaim!.id);
  await refreshGenerationJob(stableJob.id);
  assert.equal(await writeGenerationBatchToDataset(stableJob.id), true);
  const stableBatch = await getGenerationBatch(stableJob.id);
  assert.equal(stableBatch?.items[0].durability, 'vidmuse_asset');
  assert.equal(stableBatch?.items[0].originalResultUrl, stableProviderUrl);
  const afterStableWriteback = await getDataset(datasetId);
  assert.equal(afterStableWriteback?.items[0].stable_result, stableAssetUrl);
  const stableParams = JSON.parse(String(afterStableWriteback?.items[0].stable_result_params_json || '{}'));
  assert.equal(stableParams.durability, 'vidmuse_asset');
  assert.equal(stableParams.originalResultUrl, stableProviderUrl);
  const capacityPreflight = createPreflightRecord(
    (await getDataset(datasetId))!,
    'capacity_result',
    `request-${suffix}-capacity`,
  );
  const baseCase = capacityPreflight.result.cases[0];
  const requestedClaims = serverConfig.generationImageConcurrency + 1;
  capacityPreflight.result = {
    ...capacityPreflight.result,
    validCount: requestedClaims,
    total: requestedClaims,
    cases: Array.from({ length: requestedClaims }, (_, index) => ({
      ...baseCase,
      resolvedCase: {
        ...baseCase.resolvedCase,
        caseId: `capacity-case-${index + 1}`,
      },
    })),
  };
  await saveGenerationPreflight(capacityPreflight);
  const capacityJob = await createGenerationBatchFromPreflight(capacityPreflight, user);
  const capacityClaims = await Promise.all(Array.from(
    { length: requestedClaims },
    (_, index) => claimNextGenerationItem('image', `capacity-worker-${index}-${suffix}`),
  ));
  const activeClaims = capacityClaims.filter(item => item !== null);
  assert.equal(activeClaims.length, serverConfig.generationImageConcurrency, 'global image leases must respect the configured capacity');
  const firstActiveIndex = capacityClaims.findIndex(item => item !== null);
  const firstActiveClaim = capacityClaims[firstActiveIndex]!;
  const leaseBefore = await dbPool.query(
    'SELECT lease_expires_at FROM generation_job_items WHERE id = $1',
    [firstActiveClaim.id],
  );
  assert.equal(await renewGenerationItemLease(firstActiveClaim.id, 'wrong-owner'), false);
  assert.equal(await renewGenerationItemLease(firstActiveClaim.id, `capacity-worker-${firstActiveIndex}-${suffix}`), true);
  const leaseAfter = await dbPool.query(
    'SELECT lease_expires_at FROM generation_job_items WHERE id = $1',
    [firstActiveClaim.id],
  );
  assert.ok(leaseAfter.rows[0].lease_expires_at >= leaseBefore.rows[0].lease_expires_at);
  await requestGenerationCancellation(capacityJob.id);
  await Promise.all(activeClaims.map(item => releaseGenerationItemLease(item!.id)));
  console.log('Generation PostgreSQL integration tests passed.');
} finally {
  await dbPool.query('DELETE FROM datasets WHERE id = $1', [datasetId]).catch(() => undefined);
  await dbPool.query('DELETE FROM users WHERE id = $1', [user.id]).catch(() => undefined);
  await closeDatabase();
}
