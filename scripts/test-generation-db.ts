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
  rowIndexes: number[] = [0],
  targetMode: 'new' | 'fill_existing' = 'new',
): StoredGenerationPreflight => {
  const selectedDatasetItemIds = rowIndexes.map(rowIndex =>
    String(savedDataset.items[rowIndex][DATASET_ITEM_ID_KEY]));
  const cases = rowIndexes.map(rowIndex => {
    const row = savedDataset.items[rowIndex];
    const resolvedCase = {
      caseId: String(row.case_id || `case-${rowIndex + 1}`),
      datasetItemId: String(row[DATASET_ITEM_ID_KEY]),
      rowIndex,
      prompt: String(row.prompt || ''),
      imageUrls: [],
      audioUrls: [],
      controls: { aspect_ratio: '1:1' },
      seed: 7 + rowIndex,
      extraInputs: {},
      generationType: 'text_to_image',
    };
    return {
      valid: true,
      generationType: 'text_to_image',
      errors: [],
      warnings: [],
      resolvedCase,
    };
  });
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
      targetMode,
      selectedDatasetItemIds,
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
      validCount: cases.length,
      invalidCount: 0,
      total: cases.length,
      selectionSummary: {
        datasetTotal: savedDataset.items.length,
        selected: cases.length,
        valid: cases.length,
        invalid: 0,
        unselected: savedDataset.items.length - cases.length,
      },
      costEstimate: {
        known: true,
        totalCredits: cases.length,
        unitCredits: 1,
        unitLabel: 'image',
      },
      cases,
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
    items: [
      { case_id: 'case-1', prompt: 'A controlled database test image.' },
      { case_id: 'case-2', prompt: 'A second controlled database test image.' },
      { case_id: 'case-3', prompt: 'A third controlled database test image.' },
    ],
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
  const partialColumn = 'partial_result';
  const partialPreflight = createPreflightRecord(
    (await getDataset(datasetId))!,
    partialColumn,
    `request-${suffix}-partial-first`,
    [0, 1],
    'new',
  );
  await saveGenerationPreflight(partialPreflight);
  const partialJob = await createGenerationBatchFromPreflight(partialPreflight, user);
  const partialBatchBefore = await getGenerationBatch(partialJob.id);
  assert.equal(partialBatchBefore?.total, 2);
  assert.deepEqual(partialBatchBefore?.selectionSummary, {
    datasetTotal: 3,
    selected: 2,
    valid: 2,
    invalid: 0,
    unselected: 1,
  });

  const partialClaims = await Promise.all([
    claimNextGenerationItem('image', `worker-partial-a-${suffix}`),
    claimNextGenerationItem('image', `worker-partial-b-${suffix}`),
  ]);
  assert.equal(partialClaims.filter(Boolean).length, 2);
  for (const item of partialClaims) {
    if (!item) throw new Error('Expected a claimed partial generation item.');
    const claimedCaseId = String(item.request.caseId);
    await updateGenerationItem(item.id, {
      status: 'succeeded',
      providerTaskId: `provider-${claimedCaseId}`,
      providerStatus: 'succeed',
      result: {
        resultUrl: `https://assets.example.com/${claimedCaseId}.png`,
        durability: 'vidmuse_asset',
        mediaType: 'image',
      },
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    await releaseGenerationItemLease(item.id);
  }
  await refreshGenerationJob(partialJob.id);
  assert.equal(await writeGenerationBatchToDataset(partialJob.id), true);

  const afterPartialWriteback = (await getDataset(datasetId))!;
  const firstResult = String(afterPartialWriteback.items[0][partialColumn]);
  const secondResult = String(afterPartialWriteback.items[1][partialColumn]);
  assert.match(firstResult, /case-1\.png$/);
  assert.match(secondResult, /case-2\.png$/);
  assert.equal(afterPartialWriteback.items[2][partialColumn], undefined);
  for (const suffixKey of ['status', 'seed', 'request_id', 'error', 'params_json']) {
    assert.equal(
      afterPartialWriteback.items[2][`${partialColumn}_${suffixKey}`],
      undefined,
      `unselected case must not receive ${suffixKey} metadata`,
    );
  }

  const fillPreflight = createPreflightRecord(
    afterPartialWriteback,
    partialColumn,
    `request-${suffix}-partial-fill`,
    [2],
    'fill_existing',
  );
  await saveGenerationPreflight(fillPreflight);
  const fillJob = await createGenerationBatchFromPreflight(fillPreflight, user);
  const fillClaim = await claimNextGenerationItem('image', `worker-partial-fill-${suffix}`);
  assert.equal(fillClaim?.jobId, fillJob.id);
  await updateGenerationItem(fillClaim!.id, {
    status: 'succeeded',
    providerTaskId: 'provider-case-3',
    providerStatus: 'succeed',
    result: {
      resultUrl: 'https://assets.example.com/case-3.png',
      durability: 'vidmuse_asset',
      mediaType: 'image',
    },
    finishedAt: Date.now(),
    nextPollAt: null,
  });
  await releaseGenerationItemLease(fillClaim!.id);
  await refreshGenerationJob(fillJob.id);
  assert.equal(await writeGenerationBatchToDataset(fillJob.id), true);

  const afterFillWriteback = (await getDataset(datasetId))!;
  assert.equal(afterFillWriteback.items[0][partialColumn], firstResult);
  assert.equal(afterFillWriteback.items[1][partialColumn], secondResult);
  assert.equal(afterFillWriteback.items[2][partialColumn], 'https://assets.example.com/case-3.png');
  assert.equal(afterFillWriteback.inputSchema?.filter(field => field.key === partialColumn).length, 1);
  assert.equal(afterFillWriteback.columnMappings?.outputColumns.filter(column => column === partialColumn).length, 1);

  const overwritePreflight = createPreflightRecord(
    afterFillWriteback,
    partialColumn,
    `request-${suffix}-partial-overwrite`,
    [0],
    'fill_existing',
  );
  await saveGenerationPreflight(overwritePreflight);
  const overwriteJob = await createGenerationBatchFromPreflight(overwritePreflight, user);
  const overwriteClaim = await claimNextGenerationItem('image', `worker-partial-overwrite-${suffix}`);
  assert.equal(overwriteClaim?.jobId, overwriteJob.id);
  await updateGenerationItem(overwriteClaim!.id, {
    status: 'succeeded',
    result: {
      resultUrl: 'https://assets.example.com/should-not-overwrite.png',
      durability: 'vidmuse_asset',
      mediaType: 'image',
    },
    finishedAt: Date.now(),
    nextPollAt: null,
  });
  await releaseGenerationItemLease(overwriteClaim!.id);
  await refreshGenerationJob(overwriteJob.id);
  assert.equal(await writeGenerationBatchToDataset(overwriteJob.id), false);
  const afterOverwriteAttempt = await getDataset(datasetId);
  assert.equal(afterOverwriteAttempt?.items[0][partialColumn], firstResult);
  assert.equal((await getGenerationBatch(overwriteJob.id))?.writebackStatus, 'conflict');


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
  await Promise.all(activeClaims.map(item => releaseGenerationItemLease(item!.id)));

  const capacityBatch = await getGenerationBatch(capacityJob.id);
  const outstandingItems = capacityBatch!.items.slice(0, serverConfig.generationImageConcurrency);
  for (const [index, item] of outstandingItems.entries()) {
    await updateGenerationItem(item.id, {
      status: 'processing',
      providerTaskId: `outstanding-task-${index}-${suffix}`,
      providerStatus: 'processing',
      nextPollAt: Date.now() + 60_000,
    });
  }
  assert.equal(await claimNextGenerationItem('image', `worker-outstanding-block-${suffix}`), null,
    'outstanding provider tasks must block new submissions at the configured capacity');
  await updateGenerationItem(outstandingItems[0].id, { nextPollAt: Date.now() - 1 });
  const pollClaim = await claimNextGenerationItem('image', `worker-outstanding-poll-${suffix}`);
  assert.equal(pollClaim?.id, outstandingItems[0].id,
    'due provider tasks must remain pollable while submission capacity is full');
  await releaseGenerationItemLease(pollClaim!.id);
  await updateGenerationItem(outstandingItems[0].id, {
    status: 'succeeded',
    nextPollAt: null,
  });
  const resumedClaim = await claimNextGenerationItem('image', `worker-outstanding-resume-${suffix}`);
  assert.equal(resumedClaim?.status, 'pending',
    'a terminal provider task must release capacity for the next pending submission');
  await releaseGenerationItemLease(resumedClaim!.id);
  await requestGenerationCancellation(capacityJob.id);
  const partlyInvalidPreflight = createPreflightRecord(
    (await getDataset(datasetId))!,
    'partly_invalid_result',
    `request-${suffix}-partly-invalid`,
    [0, 1],
  );
  partlyInvalidPreflight.result.cases[1] = {
    ...partlyInvalidPreflight.result.cases[1],
    valid: false,
    errors: [{ code: 'TEST_INVALID_CASE', message: 'Simulated invalid selected case.' }],
  };
  partlyInvalidPreflight.result.validCount = 1;
  partlyInvalidPreflight.result.invalidCount = 1;
  partlyInvalidPreflight.result.selectionSummary = {
    datasetTotal: 3,
    selected: 2,
    valid: 1,
    invalid: 1,
    unselected: 1,
  };
  await saveGenerationPreflight(partlyInvalidPreflight);
  const partlyInvalidJob = await createGenerationBatchFromPreflight(partlyInvalidPreflight, user);
  const partlyInvalidBatch = await getGenerationBatch(partlyInvalidJob.id);
  assert.equal(partlyInvalidBatch?.total, 1);
  assert.equal(partlyInvalidBatch?.items.length, 1);
  assert.equal(partlyInvalidBatch?.items[0].caseId, 'case-1');
  await requestGenerationCancellation(partlyInvalidJob.id);


  console.log('Generation PostgreSQL integration tests passed.');
} finally {
  await dbPool.query('DELETE FROM datasets WHERE id = $1', [datasetId]).catch(() => undefined);
  await dbPool.query('DELETE FROM users WHERE id = $1', [user.id]).catch(() => undefined);
  await closeDatabase();
}
