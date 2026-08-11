import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { RequestUser } from '../server/auth/context.ts';
import { closeDatabase, dbPool } from '../server/db/client.ts';
import { serverConfig } from '../server/config.ts';
import { getDataset, saveDataset } from '../server/datasets/datasetRepository.ts';
import {
  beginGenerationSubmission,
  claimGenerationWriteback,
  claimNextGenerationItem,
  createGenerationBatchFromPreflight,
  findGenerationWritebackCandidate,
  listGenerationJobEvents,
  getGenerationBatch,
  getGenerationQueueState,
  refreshGenerationJob,
  releaseGenerationItemLease,
  requestGenerationCancellation,
  saveGenerationPreflight,
  skipGenerationItems,
  renewGenerationItemLease,
  updateGenerationItem,
  type StoredGenerationPreflight,
} from '../server/generation/generationExecutionRepository.ts';
import { listGenerationJobs } from '../server/generation/generationRepository.ts';
import { normalizeAionModelConfig } from '../server/generation/generationPlanning.ts';
import {
  markAdaptiveGenerationSubmissionAccepted,
  recordAdaptiveGenerationSubmissionOutcome,
} from '../server/generation/generationAdaptiveCapacityRepository.ts';
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
const teammate: RequestUser = {
  id: `generation-db-teammate-${suffix}`,
  email: `generation-db-teammate-${suffix}@example.com`,
  displayName: 'Generation DB Teammate',
  organizationId: 'default',
};
const otherOrganizationId = `generation-db-org-${suffix}`;
const otherOrganizationUser: RequestUser = {
  id: `generation-db-other-user-${suffix}`,
  email: `generation-db-other-${suffix}@example.com`,
  displayName: 'Generation DB Other Organization',
  organizationId: otherOrganizationId,
};

const datasetId = `generation-db-dataset-${suffix}`;
const fairnessDatasetId = `generation-db-fairness-dataset-${suffix}`;

const fairnessDatasetCId = `generation-db-fairness-dataset-c-${suffix}`;
const fairnessOtherOrganizationDatasetId = `generation-db-fairness-other-org-${suffix}`;
const originalAdaptiveEnabled = serverConfig.generationVideoAdaptiveEnabled;
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
    datasetId: savedDataset.id,
    datasetVersion: savedDataset.version || 1,
    modelName: model.modelName,
    configFingerprint: model.configFingerprint,
    requestHash,
    payload: {
      datasetId: savedDataset.id,
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
      seedPolicyVersion: 2,
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
  serverConfig.generationVideoAdaptiveEnabled = false;
  await dbPool.query(
    `DELETE FROM datasets WHERE id LIKE 'generation-db-%'`,
  );

  await dbPool.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
    [user.id, user.email, user.displayName],
  );
  await dbPool.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ('default', $1, 'admin')`,
    [user.id],
  );
  await dbPool.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
    [teammate.id, teammate.email, teammate.displayName],
  );
  await dbPool.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ('default', $1, 'editor')`,
    [teammate.id],
  );
  await dbPool.query(
    `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
    [otherOrganizationId, 'Generation DB Other Organization'],
  );
  await dbPool.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`,
    [otherOrganizationUser.id, otherOrganizationUser.email, otherOrganizationUser.displayName],
  );
  await dbPool.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')`,
    [otherOrganizationId, otherOrganizationUser.id],
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
  assert.equal((await getGenerationBatch(cancelledJob.id))?.controls.seedPolicyVersion, 2);

  const claims = await Promise.all([
    claimNextGenerationItem('image', `worker-a-${suffix}`),
    claimNextGenerationItem('image', `worker-b-${suffix}`),
  ]);
  const claimedItems = claims.filter(Boolean);
  assert.equal(claimedItems.length, 1, 'SKIP LOCKED must allow only one worker to claim the case');
  const claimedItem = claimedItems[0]!;

  assert.equal(await requestGenerationCancellation(cancelledJob.id, user), true);
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

  const skipPreflight = createPreflightRecord(
    afterRecoveredWriteback!,
    'skip_result',
    `request-${suffix}-skip`,
    [0, 1],
  );
  await saveGenerationPreflight(skipPreflight);
  const skipJob = await createGenerationBatchFromPreflight(skipPreflight, user);
  const skipBefore = await getGenerationBatch(skipJob.id);
  await updateGenerationItem(skipBefore!.items[1].id, {
    status: 'failed',
    error: { code: 'PROVIDER_FAILED', message: 'Provider returned a terminal failure.' },
    finishedAt: Date.now(),
  });
  await skipGenerationItems(
    skipJob.id,
    skipBefore!.items.map(item => item.id),
    teammate,
  );
  await refreshGenerationJob(skipJob.id);
  const skipAfter = await getGenerationBatch(skipJob.id, teammate.organizationId);
  assert.equal(skipAfter?.items[0].status, 'cancelled');
  assert.equal(skipAfter?.items[0].resolutionStatus, 'skipped');
  assert.equal(skipAfter?.items[1].status, 'failed');
  assert.equal(skipAfter?.items[1].resolutionStatus, 'skipped');
  assert.equal(await getGenerationBatch(skipJob.id, 'another-organization'), null);
  const organizationJobs = await listGenerationJobs({
    organizationId: 'default',
    datasetId,
    limit: 100,
  });
  const firstJobsPage = await listGenerationJobs({
    organizationId: 'default',
    datasetId,
    page: 1,
    limit: 1,
  });
  const secondJobsPage = await listGenerationJobs({
    organizationId: 'default',
    datasetId,
    page: 2,
    limit: 1,
  });
  assert.ok(firstJobsPage.total >= 2);
  assert.notEqual(firstJobsPage.jobs[0]?.id, secondJobsPage.jobs[0]?.id);
  const filteredJobs = await listGenerationJobs({
    organizationId: 'default',
    datasetId,
    status: skipAfter!.status,
    createdBy: 'Generation DB Test',
  });
  assert.ok(filteredJobs.jobs.some(job => job.id === skipJob.id));
  assert.ok(organizationJobs.jobs.some(job => job.id === skipJob.id));
  const isolatedJobs = await listGenerationJobs({
    organizationId: 'another-organization',
    datasetId,
  });
  assert.equal(isolatedJobs.total, 0);
  const skipEvents = await listGenerationJobEvents(skipJob.id, 'default');
  assert.ok(skipEvents.some(event =>
    event.action === 'items_skipped' && event.actorId === teammate.id));
  assert.equal(await writeGenerationBatchToDataset(skipJob.id), true);

  const retryBaseDataset = (await getDataset(datasetId))!;
  const retryParentPreflight = createPreflightRecord(
    retryBaseDataset,
    'retry_result',
    `request-${suffix}-retry-parent`,
  );
  await saveGenerationPreflight(retryParentPreflight);
  const retryParent = await createGenerationBatchFromPreflight(retryParentPreflight, user);
  const retryParentBatch = await getGenerationBatch(retryParent.id);
  const retryParentItem = retryParentBatch!.items[0];
  await updateGenerationItem(retryParentItem.id, {
    status: 'failed',
    error: { code: 'PROVIDER_FAILED', message: 'Safe terminal provider failure.' },
    finishedAt: Date.now(),
  });
  await refreshGenerationJob(retryParent.id);
  const isolatedRetryPreflight = createPreflightRecord(
    retryBaseDataset,
    'retry_result',
    `request-${suffix}-retry-cross-org`,
  );
  isolatedRetryPreflight.payload.retryOfJobId = retryParent.id;
  isolatedRetryPreflight.payload.retrySourceItemIds = {
    [retryParentItem.datasetItemId]: retryParentItem.id,
  };
  await assert.rejects(
    createGenerationBatchFromPreflight(isolatedRetryPreflight, {
      ...user,
      organizationId: 'another-organization',
    }),
    /source cases are unavailable/,
  );

  const retryChildPreflight = createPreflightRecord(
    retryBaseDataset,
    'retry_result',
    `request-${suffix}-retry-child`,
  );
  retryChildPreflight.payload.retryOfJobId = retryParent.id;
  retryChildPreflight.payload.retrySourceItemIds = {
    [retryParentItem.datasetItemId]: retryParentItem.id,
  };
  await saveGenerationPreflight(retryChildPreflight);
  const retryChild = await createGenerationBatchFromPreflight(retryChildPreflight, teammate);
  const retryChildBatch = await getGenerationBatch(retryChild.id);
  assert.equal(retryChildBatch?.retryOfJobId, retryParent.id);
  assert.equal(retryChildBatch?.items[0].retryOfItemId, retryParentItem.id);

  const duplicateRetryPreflight = createPreflightRecord(
    retryBaseDataset,
    'retry_result',
    `request-${suffix}-retry-duplicate`,
  );
  duplicateRetryPreflight.payload.retryOfJobId = retryParent.id;
  duplicateRetryPreflight.payload.retrySourceItemIds = {
    [retryParentItem.datasetItemId]: retryParentItem.id,
  };
  await saveGenerationPreflight(duplicateRetryPreflight);
  await assert.rejects(
    createGenerationBatchFromPreflight(duplicateRetryPreflight, teammate),
    /unfinished retry/,
  );

  await updateGenerationItem(retryChildBatch!.items[0].id, {
    status: 'succeeded',
    result: {
      resultUrl: 'https://example.com/retry-result.png',
      mediaType: 'image',
      durability: 'temporary',
    },
    finishedAt: Date.now(),
  });
  await refreshGenerationJob(retryChild.id);
  assert.equal(
    await claimGenerationWriteback(retryChild.id),
    null,
    'retry writeback must wait until its parent writeback completes',
  );
  assert.equal(await writeGenerationBatchToDataset(retryParent.id), true);
  assert.equal(await writeGenerationBatchToDataset(retryChild.id), true);
  const retryWrittenDataset = await getDataset(datasetId);
  assert.equal(retryWrittenDataset?.items[0].retry_result, 'https://example.com/retry-result.png');
  const retryResolvedParent = await getGenerationBatch(retryParent.id);
  assert.equal(retryResolvedParent?.items[0].resolutionStatus, 'resolved');

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
  stablePreflight.payload.parameterBindings = {
    aspect_ratio: { source: 'uniform', value: '1:1' },
  };
  stablePreflight.payload.durationSource = {
    mode: 'reference_audio',
    referenceAudio: {
      [String(stablePreflight.result.cases[0].resolvedCase.datasetItemId)]: {
        audioUrl: 'https://assets.example.com/reference.mp3',
        detectedSeconds: 8.516,
        resolvedDuration: 9,
      },
    },
  };
  stablePreflight.result.cases[0].resolvedCase.durationResolution = {
    source: 'reference_audio',
    audioUrl: 'https://assets.example.com/reference.mp3',
    detectedSeconds: 8.516,
    resolvedDuration: 9,
  };
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
  assert.equal(stableBatch?.controls.durationSource?.mode, 'reference_audio');
  assert.deepEqual(stableBatch?.controls.parameterBindings, {
    aspect_ratio: { source: 'uniform', value: '1:1' },
  });
  const afterStableWriteback = await getDataset(datasetId);
  assert.equal(afterStableWriteback?.items[0].stable_result, stableAssetUrl);
  const stableParams = JSON.parse(String(afterStableWriteback?.items[0].stable_result_params_json || '{}'));
  assert.equal(stableParams.durability, 'vidmuse_asset');
  assert.equal(stableParams.originalResultUrl, stableProviderUrl);
  assert.deepEqual(stableParams.duration, {
    source: 'reference_audio',
    audioUrl: 'https://assets.example.com/reference.mp3',
    detectedSeconds: 8.516,
    resolvedDuration: 9,
  });
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
  serverConfig.generationVideoModelLimits.models[model.modelName] = {
    min: 2, initial: 2, max: 2,
  };

  const fairnessDataset = await saveDataset({
    ...afterFillWriteback,
    id: fairnessDatasetId,
    name: 'Generation fairness integration test',
    items: [
      { case_id: 'fairness-1', prompt: 'Fairness test one.' },
      { case_id: 'fairness-2', prompt: 'Fairness test two.' },
      { case_id: 'fairness-3', prompt: 'Fairness test three.' },
    ],
    version: 1,
    versionHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, user.id);
  const fairnessDatasetC = await saveDataset({
    ...fairnessDataset,
    id: fairnessDatasetCId,
    name: 'Generation fairness integration test C',
    items: Array.from({ length: 12 }, (_, index) => ({
      case_id: `fairness-c-${index + 1}`,
      prompt: `Fairness test C ${index + 1}.`,
    })),
    version: 1,
    versionHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, user.id);
  const fairnessPreflightA = createPreflightRecord(
    afterFillWriteback,
    `fairness_a_${suffix}`,
    `request-${suffix}-fairness-a`,
    [0, 1, 2],
  );
  const fairnessPreflightB = createPreflightRecord(
    fairnessDataset,
    `fairness_b_${suffix}`,
    `request-${suffix}-fairness-b`,
    [0, 1, 2],
  );
  const fairnessPreflightC = createPreflightRecord(
    fairnessDatasetC,
    `fairness_c_${suffix}`,
    `request-${suffix}-fairness-c`,
    [0, 1, 2],
  );
  for (const preflight of [fairnessPreflightA, fairnessPreflightB, fairnessPreflightC]) {
    preflight.result.model = { ...preflight.result.model, outputModality: 'video' };
    await saveGenerationPreflight(preflight);
  }
  const fairnessJobA = await createGenerationBatchFromPreflight(fairnessPreflightA, user);
  const fairnessJobB = await createGenerationBatchFromPreflight(fairnessPreflightB, user);
  const fairnessJobC = await createGenerationBatchFromPreflight(fairnessPreflightC, user);
  const originalVideoConcurrency = serverConfig.generationVideoConcurrency;
  serverConfig.generationVideoConcurrency = 2;
  const firstFairnessClaims = (await Promise.all([
    claimNextGenerationItem('video', `fairness-worker-0-${suffix}`),
    claimNextGenerationItem('video', `fairness-worker-1-${suffix}`),
  ])).filter(Boolean);
  assert.equal(firstFairnessClaims.length, 2);
  const initiallyServed = new Set(firstFairnessClaims.map(item => item!.job.datasetId));
  assert.equal(initiallyServed.size, 2, 'the first two slots must serve different datasets');

  for (const [index, item] of firstFairnessClaims.entries()) {
    const startedAt = Date.now() + index;
    assert.equal(await beginGenerationSubmission(item!.id, 1, startedAt, startedAt), true);
    await updateGenerationItem(item!.id, {
      status: 'processing',
      providerTaskId: `fairness-provider-${index}-${suffix}`,
      providerStatus: 'processing',
      nextPollAt: Date.now() + 60_000,
    });
    await releaseGenerationItemLease(item!.id);
  }
  await updateGenerationItem(firstFairnessClaims[0]!.id, {
    status: 'succeeded',
    finishedAt: Date.now(),
    nextPollAt: null,
  });
  const thirdFairnessClaim = await claimNextGenerationItem('video', `fairness-worker-2-${suffix}`);
  const allFairnessDatasets = [datasetId, fairnessDatasetId, fairnessDatasetCId];
  const neverServedDataset = allFairnessDatasets.find(id => !initiallyServed.has(id));
  assert.equal(
    thirdFairnessClaim?.job.datasetId,
    neverServedDataset,
    'a never-served dataset must receive a slot within the first three allocations',
  );
  serverConfig.generationVideoConcurrency = originalVideoConcurrency;

  await releaseGenerationItemLease(thirdFairnessClaim!.id);
  await updateGenerationItem(firstFairnessClaims[1]!.id, {
    status: 'succeeded',
    finishedAt: Date.now(),
    nextPollAt: null,
  });
  await requestGenerationCancellation(fairnessJobA.id, user);
  await requestGenerationCancellation(fairnessJobB.id, user);
  await requestGenerationCancellation(fairnessJobC.id, user);


  const fairnessOtherOrganizationDataset = await saveDataset({
    ...fairnessDatasetC,
    id: fairnessOtherOrganizationDatasetId,
    name: 'Generation fairness other organization',
    version: 1,
    versionHistory: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, otherOrganizationUser.id);
  await dbPool.query(
    'UPDATE datasets SET organization_id = $2 WHERE id = $1',
    [fairnessOtherOrganizationDatasetId, otherOrganizationId],
  );
  const organizationFairnessPreflightA = createPreflightRecord(
    (await getDataset(datasetId))!,
    `organization_fairness_a_${suffix}`,
    `request-${suffix}-organization-fairness-a`,
  );
  const organizationFairnessPreflightB = createPreflightRecord(
    fairnessOtherOrganizationDataset,
    `organization_fairness_b_${suffix}`,
    `request-${suffix}-organization-fairness-b`,
  );
  for (const preflight of [organizationFairnessPreflightA, organizationFairnessPreflightB]) {
    preflight.result.model = { ...preflight.result.model, outputModality: 'video' };
    await saveGenerationPreflight(preflight);
  }
  const organizationFairnessJobA = await createGenerationBatchFromPreflight(
    organizationFairnessPreflightA,
    user,
  );
  const organizationFairnessJobB = await createGenerationBatchFromPreflight(
    organizationFairnessPreflightB,
    otherOrganizationUser,
  );
  const organizationFairnessConcurrency = serverConfig.generationVideoConcurrency;
  serverConfig.generationVideoConcurrency = 2;
  const organizationFairnessClaims = (await Promise.all([
    claimNextGenerationItem('video', `organization-fairness-a-${suffix}`),
    claimNextGenerationItem('video', `organization-fairness-b-${suffix}`),
  ])).filter(Boolean);
  assert.deepEqual(
    new Set(organizationFairnessClaims.map(item => item!.job.datasetId)),
    new Set([datasetId, fairnessOtherOrganizationDatasetId]),
    'two organizations must each receive one of two free slots',
  );
  serverConfig.generationVideoConcurrency = organizationFairnessConcurrency;
  await Promise.all(organizationFairnessClaims.map(item => releaseGenerationItemLease(item!.id)));
  await requestGenerationCancellation(organizationFairnessJobA.id, user);
  await requestGenerationCancellation(organizationFairnessJobB.id, otherOrganizationUser);



  serverConfig.generationVideoModelLimits.models['test/video-a'] = {
    min: 4, initial: 4, max: 4,
  };
  const modelCapPreflightA = createPreflightRecord(
    (await getDataset(datasetId))!,
    `model_cap_a_${suffix}`,
    `request-${suffix}-model-cap-a`,
  );
  const modelCapBaseCase = modelCapPreflightA.result.cases[0];
  modelCapPreflightA.result = {
    ...modelCapPreflightA.result,
    model: {
      ...modelCapPreflightA.result.model,
      id: 'test/video-a',
      modelName: 'test/video-a',
      outputModality: 'video',
    },
    validCount: 5,
    total: 5,
    cases: Array.from({ length: 5 }, (_, index) => ({
      ...modelCapBaseCase,
      resolvedCase: {
        ...modelCapBaseCase.resolvedCase,
        caseId: `model-cap-a-${index + 1}`,
        datasetItemId: `${modelCapBaseCase.resolvedCase.datasetItemId}-model-cap-a-${index + 1}`,
        rowIndex: index,
      },
    })),
  };
  await saveGenerationPreflight(modelCapPreflightA);
  const modelCapJobA = await createGenerationBatchFromPreflight(modelCapPreflightA, user);
  const modelCapAttempts = await Promise.all(Array.from(
    { length: 5 },
    (_, index) => claimNextGenerationItem('video', `model-cap-a-${index}-${suffix}`),
  ));
  const modelCapClaimsA = modelCapAttempts.filter(
    (item): item is NonNullable<Awaited<ReturnType<typeof claimNextGenerationItem>>> => Boolean(item),
  );
  assert.equal(modelCapClaimsA.length, 4, 'concurrent workers must not over-claim a four-slot model');
  for (const [index, claim] of modelCapClaimsA.entries()) {
    assert.equal(claim.job.model.modelName, 'test/video-a');
    assert.equal(await beginGenerationSubmission(claim.id, 1, Date.now(), Date.now()), true);
    await updateGenerationItem(claim.id, {
      status: 'processing',
      providerTaskId: `model-cap-a-provider-${index}-${suffix}`,
      providerStatus: 'processing',
      nextPollAt: Date.now() + 60_000,
    });
    await releaseGenerationItemLease(claim.id);
  }
  await updateGenerationItem(modelCapClaimsA[0].id, { nextPollAt: Date.now() - 1 });
  const dueAtModelCap = await claimNextGenerationItem('video', `model-cap-a-poll-${suffix}`);
  assert.equal(
    dueAtModelCap?.id,
    modelCapClaimsA[0].id,
    'polling an existing provider task must remain possible at the model limit',
  );
  await releaseGenerationItemLease(dueAtModelCap!.id);
  const reconciliationStartedAt = Date.now();
  await updateGenerationItem(modelCapClaimsA[0].id, {
    status: 'reconciling',
    reconciliationStartedAt,
    reconciliationDeadlineAt: reconciliationStartedAt + 120_000,
    lastPollSucceededAt: reconciliationStartedAt,
    consecutivePollFailures: 0,
    nextPollAt: Date.now() + 60_000,
  });
  const queueDuringReconciliation = await getGenerationQueueState(user.organizationId);
  const reconcilingModelQueue = queueDuringReconciliation.video.models.find(
    item => item.modelName === 'test/video-a',
  );
  assert.equal(reconcilingModelQueue?.active, 3);
  assert.equal(reconcilingModelQueue?.reconciling, 1);

  const replacementClaim = await claimNextGenerationItem(
    'video',
    `model-cap-a-replacement-${suffix}`,
  );
  assert.ok(replacementClaim, 'a reconciling item must release its provider concurrency slot');
  assert.equal(replacementClaim?.job.model.modelName, 'test/video-a');
  assert.equal(await beginGenerationSubmission(
    replacementClaim!.id,
    1,
    Date.now(),
    Date.now(),
  ), true);
  await updateGenerationItem(replacementClaim!.id, {
    status: 'processing',
    providerTaskId: `model-cap-a-replacement-provider-${suffix}`,
    providerStatus: 'processing',
    nextPollAt: Date.now() + 60_000,
  });
  await releaseGenerationItemLease(replacementClaim!.id);

  await updateGenerationItem(modelCapClaimsA[0].id, { nextPollAt: Date.now() + 60_000 });

  assert.equal(
    await claimNextGenerationItem('video', `model-cap-a-blocked-${suffix}`),
    null,
    'the default per-model limit must block a fifth active submission',
  );
  const queueAtModelCap = await getGenerationQueueState(user.organizationId);
  const modelAQueue = queueAtModelCap.video.models.find(item => item.modelName === 'test/video-a');
  assert.equal(modelAQueue?.active, 4);
  assert.equal(modelAQueue?.effectiveLimit, 4);

  const modelCapPreflightB = createPreflightRecord(
    fairnessDatasetC,
    `model_cap_b_${suffix}`,
    `request-${suffix}-model-cap-b`,
  );
  assert.equal(modelAQueue?.reconciling, 1);
  modelCapPreflightB.result.model = {
    ...modelCapPreflightB.result.model,
    id: 'test/video-b',
    modelName: 'test/video-b',
    outputModality: 'video',
  };
  await saveGenerationPreflight(modelCapPreflightB);
  const modelCapJobB = await createGenerationBatchFromPreflight(modelCapPreflightB, user);
  const otherModelClaim = await claimNextGenerationItem('video', `model-cap-b-${suffix}`);
  assert.equal(
    otherModelClaim?.job.model.modelName,
    'test/video-b',
    'another model must be able to use global capacity while the first model is capped',
  );
  await releaseGenerationItemLease(otherModelClaim!.id);
  await updateGenerationItem(otherModelClaim!.id, {
    status: 'succeeded',
    finishedAt: Date.now(),
    nextPollAt: null,
  });
  for (const claim of modelCapClaimsA) {
    await updateGenerationItem(claim.id, {
      status: 'succeeded',
      finishedAt: Date.now(),
      nextPollAt: null,
    });
  }
  await requestGenerationCancellation(modelCapJobA.id, user);
  await requestGenerationCancellation(modelCapJobB.id, user);
  await updateGenerationItem(replacementClaim!.id, {
    status: 'succeeded',
    finishedAt: Date.now(),
    nextPollAt: null,
  });


  serverConfig.generationVideoAdaptiveEnabled = true;
  await dbPool.query(
    `
      UPDATE generation_capacity_states
      SET policy_version = $1,
          enforce_after = now() - interval '1 second',
          updated_at = now()
      WHERE capacity_key = '__video_global__'
    `,
    [serverConfig.generationVideoAdaptivePolicy.policyVersion - 1],
  );
  const shadowQueue = await getGenerationQueueState(user.organizationId);
  const resetGlobalState = (await dbPool.query(
    `
      SELECT policy_version, enforce_after
      FROM generation_capacity_states
      WHERE capacity_key = '__video_global__'
    `,
  )).rows[0];
  assert.equal(shadowQueue.video.adaptiveEnforced, true,
    'policy version four must take over immediately without a terminal-history shadow period');
  assert.equal(shadowQueue.video.strategy, 'optimistic_waves');
  assert.equal(shadowQueue.video.limit, 24);
  assert.equal(resetGlobalState.policy_version, serverConfig.generationVideoAdaptivePolicy.policyVersion);
  assert.ok(new Date(resetGlobalState.enforce_after).getTime() <= Date.now());
  const adaptiveConfigId = `adaptive-video-config-${suffix}`;
  const adaptivePreflight = createPreflightRecord(
    fairnessDatasetC,
    `adaptive_capacity_${suffix}`,
    `request-${suffix}-adaptive-capacity`,
    Array.from({ length: 9 }, (_, index) => index),
  );
  adaptivePreflight.result.model = {
    ...adaptivePreflight.result.model,
    id: adaptiveConfigId,
    configId: adaptiveConfigId,
    modelName: `test/adaptive-video-${suffix}`,
    outputModality: 'video',
  };
  adaptivePreflight.result.cases = adaptivePreflight.result.cases.map(item => ({
    ...item,
    generationType: 'text_to_video',
    resolvedCase: { ...item.resolvedCase, generationType: 'text_to_video' },
  }));
  await saveGenerationPreflight(adaptivePreflight);
  const adaptiveJob = await createGenerationBatchFromPreflight(adaptivePreflight, user);
  await dbPool.query(
    `
      UPDATE generation_capacity_states
      SET enforce_after = now() - interval '1 second',
          state_json = state_json || $1::jsonb,
          updated_at = now()
      WHERE capacity_key = '__video_global__'
    `,
    [JSON.stringify({
      currentWindow: 12,
      acceptedInWave: 0,
      phase: 'stable',
      cooldownUntil: null,
      circuitOpenUntil: null,
      submitTokens: 2,
      submitTokenUpdatedAt: Date.now(),
    })],
  );
  const adaptiveFirstClaims = (await Promise.all([
    claimNextGenerationItem('video', `adaptive-submit-a-${suffix}`, 'submit'),
    claimNextGenerationItem('video', `adaptive-submit-b-${suffix}`, 'submit'),
  ])).filter(Boolean);
  assert.equal(adaptiveFirstClaims.length, 2,
    'the global burst must allow both submission workers to claim atomically');
  const adaptiveBucketKey = (await dbPool.query(
    'SELECT capacity_bucket_key FROM generation_job_items WHERE id = $1',
    [adaptiveFirstClaims[0]!.id],
  )).rows[0].capacity_bucket_key;
  const acceptedClaims = [...adaptiveFirstClaims];
  for (const [index, claim] of acceptedClaims.entries()) {
    assert.equal(await beginGenerationSubmission(claim.id, 1, Date.now(), Date.now()), true);
    await updateGenerationItem(claim.id, {
      status: 'processing',
      providerTaskId: `adaptive-provider-${index}-${suffix}`,
      providerStatus: 'processing',
      nextPollAt: Date.now() + 60_000,
    });
    await releaseGenerationItemLease(claim.id);
    await markAdaptiveGenerationSubmissionAccepted(claim.id);
  }
  for (let index = acceptedClaims.length; index < 8; index += 1) {
    await dbPool.query(
      `
        UPDATE generation_capacity_states
        SET state_json = state_json || $1::jsonb,
            updated_at = now()
        WHERE capacity_key = '__video_global__'
      `,
      [JSON.stringify({ submitTokens: 1, submitTokenUpdatedAt: Date.now() })],
    );
    const claim = await claimNextGenerationItem('video', `adaptive-submit-${index}-${suffix}`, 'submit');
    assert.ok(claim, `optimistic first-wave case ${index + 1} should be claimed`);
    assert.equal(await beginGenerationSubmission(claim!.id, 1, Date.now(), Date.now()), true);
    await updateGenerationItem(claim!.id, {
      status: 'processing',
      providerTaskId: `adaptive-provider-${index}-${suffix}`,
      providerStatus: 'processing',
      nextPollAt: Date.now() + 60_000,
    });
    await releaseGenerationItemLease(claim!.id);
    await markAdaptiveGenerationSubmissionAccepted(claim!.id);
    acceptedClaims.push(claim!);
  }
  const firstWaveState = (await dbPool.query(
    'SELECT state_json FROM generation_capacity_states WHERE capacity_key = $1',
    [adaptiveBucketKey],
  )).rows[0].state_json;
  assert.equal(firstWaveState.currentWindow, 16,
    'eight accepted task IDs must open the second wave without a terminal video result');
  assert.equal(firstWaveState.acceptedInWave, 0);
  assert.equal(new Set(acceptedClaims.map(item => item.providerTaskId).filter(Boolean)).size, 0,
    'claimed snapshots must not invent provider task IDs before submission begins');

  await dbPool.query(
    `UPDATE generation_capacity_states
     SET state_json = state_json || $1::jsonb, updated_at = now()
     WHERE capacity_key = '__video_global__'`,
    [JSON.stringify({ submitTokens: 1, submitTokenUpdatedAt: Date.now() })],
  );
  const ninthClaim = await claimNextGenerationItem('video', `adaptive-submit-ninth-${suffix}`, 'submit');
  assert.ok(ninthClaim, 'the ninth case must be admitted before any first-wave video reaches a terminal state');
  assert.equal(await beginGenerationSubmission(ninthClaim!.id, 1, Date.now(), Date.now()), true);
  await updateGenerationItem(ninthClaim!.id, {
    status: 'processing',
    providerTaskId: `adaptive-provider-8-${suffix}`,
    providerStatus: 'processing',
    nextPollAt: Date.now() + 60_000,
  });
  await releaseGenerationItemLease(ninthClaim!.id);
  await markAdaptiveGenerationSubmissionAccepted(ninthClaim!.id);
  acceptedClaims.push(ninthClaim!);
  const acceptedAudit = (await dbPool.query(
    `
      SELECT
        count(*)::int AS total,
        count(DISTINCT provider_task_id)::int AS distinct_task_ids,
        max(attempt)::int AS max_attempt
      FROM generation_job_items
      WHERE id = ANY($1::text[])
    `,
    [acceptedClaims.map(item => item.id)],
  )).rows[0];
  assert.equal(acceptedAudit.total, 9);
  assert.equal(acceptedAudit.distinct_task_ids, 9,
    'each admitted case must retain one distinct Aion task ID');
  assert.equal(acceptedAudit.max_attempt, 1,
    'opening the second wave must not resubmit any first-wave case');

  const adaptiveQueue = await getGenerationQueueState(user.organizationId);
  const adaptiveModelQueue = adaptiveQueue.video.models.find(
    item => item.modelName === adaptivePreflight.result.model.modelName,
  );
  assert.equal(adaptiveQueue.video.adaptiveEnforced, true);
  assert.equal(adaptiveModelQueue?.buckets?.[0]?.generationType, 'text_to_video');
  assert.equal(adaptiveModelQueue?.buckets?.[0]?.currentLimit, 16);
  assert.equal(adaptiveModelQueue?.buckets?.[0]?.acceptedInWave, 1);

  const adaptiveModePreflight = createPreflightRecord(
    fairnessDatasetC,
    `adaptive_mode_${suffix}`,
    `request-${suffix}-adaptive-mode`,
  );
  adaptiveModePreflight.result.model = { ...adaptivePreflight.result.model };
  adaptiveModePreflight.result.cases = adaptiveModePreflight.result.cases.map(item => ({
    ...item,
    generationType: 'reference_to_video',
    resolvedCase: { ...item.resolvedCase, generationType: 'reference_to_video' },
  }));
  await saveGenerationPreflight(adaptiveModePreflight);
  const adaptiveModeJob = await createGenerationBatchFromPreflight(adaptiveModePreflight, user);
  await dbPool.query(
    `
      UPDATE generation_capacity_states
      SET state_json = state_json || $1::jsonb,
          updated_at = now()
      WHERE capacity_key = '__video_global__'
    `,
    [JSON.stringify({ submitTokens: 2, submitTokenUpdatedAt: Date.now() })],
  );
  const independentModeClaim = await claimNextGenerationItem(
    'video',
    `adaptive-mode-${suffix}`,
    'submit',
  );
  assert.equal(independentModeClaim?.jobId, adaptiveModeJob.id,
    'a different generation type may use the same model capacity group when capacity remains');
  const sharedModeBucketKey = (await dbPool.query(
    'SELECT capacity_bucket_key FROM generation_job_items WHERE id = $1',
    [independentModeClaim!.id],
  )).rows[0].capacity_bucket_key;
  assert.equal(sharedModeBucketKey, adaptiveBucketKey,
    'the same model configuration must share one capacity group across generation modes');
  await releaseGenerationItemLease(independentModeClaim!.id);
  await requestGenerationCancellation(adaptiveModeJob.id, user);
  for (const claim of acceptedClaims) {
    await updateGenerationItem(claim.id, {
      status: 'succeeded',
      result: { resultUrl: `https://assets.example.com/${claim.id}.mp4` },
      finishedAt: Date.now(),
      nextPollAt: null,
    });
  }
  const availabilityPreflight = createPreflightRecord(
    fairnessDatasetC,
    `adaptive_availability_${suffix}`,
    `request-${suffix}-adaptive-availability`,
    [0, 1, 2],
  );
  availabilityPreflight.result.model = { ...adaptivePreflight.result.model };
  availabilityPreflight.result.cases = availabilityPreflight.result.cases.map(item => ({
    ...item,
    generationType: 'images_to_video',
    resolvedCase: { ...item.resolvedCase, generationType: 'images_to_video' },
  }));
  await saveGenerationPreflight(availabilityPreflight);
  const availabilityJob = await createGenerationBatchFromPreflight(availabilityPreflight, user);
  const availabilityClaims = [];
  for (let index = 0; index < 3; index += 1) {
    await dbPool.query(
      `UPDATE generation_capacity_states
       SET state_json = state_json || $1::jsonb, updated_at = now()
       WHERE capacity_key = '__video_global__'`,
      [JSON.stringify({ submitTokens: 1, submitTokenUpdatedAt: Date.now() })],
    );
    const claim = await claimNextGenerationItem(
      'video',
      `adaptive-availability-${index}-${suffix}`,
      'submit',
    );
    assert.equal(claim?.jobId, availabilityJob.id);
    assert.equal(await beginGenerationSubmission(claim!.id, 1, Date.now(), Date.now()), true);
    await releaseGenerationItemLease(claim!.id);
    availabilityClaims.push(claim!);
  }
  for (const claim of availabilityClaims) {
    const availabilityError = {
      code: 'AION_SUBMISSION_UNKNOWN',
      message: 'Aion returned a retryable service failure without a task ID.',
      httpStatus: 503,
      retryable: true,
    };
    await updateGenerationItem(claim.id, {
      status: 'submission_unknown',
      error: availabilityError,
      finishedAt: Date.now(),
      nextPollAt: null,
    });
    await recordAdaptiveGenerationSubmissionOutcome(claim.id, {
      status: 'submission_unknown',
      error: availabilityError,
    });
  }
  const availabilityState = (await dbPool.query(
    'SELECT state_json FROM generation_capacity_states WHERE capacity_key = $1',
    [adaptiveBucketKey],
  )).rows[0].state_json;
  assert.equal(availabilityState.phase, 'circuit_open',
    'three concurrent retryable submission failures must open the capacity-group circuit');
  assert.ok(availabilityState.circuitOpenUntil > Date.now());
  const globalUnknownState = (await dbPool.query(
    `SELECT state_json FROM generation_capacity_states WHERE capacity_key = '__video_global__'`,
  )).rows[0].state_json;
  assert.ok(globalUnknownState.cooldownUntil > Date.now(),
    'submission uncertainty must pause all new video submissions');
  await requestGenerationCancellation(availabilityJob.id, user);
  await requestGenerationCancellation(adaptiveJob.id, user);
  serverConfig.generationVideoAdaptiveEnabled = false;



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
  await requestGenerationCancellation(capacityJob.id, user);
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
  await requestGenerationCancellation(partlyInvalidJob.id, user);


  console.log('Generation PostgreSQL integration tests passed.');
} finally {
  serverConfig.generationVideoAdaptiveEnabled = originalAdaptiveEnabled;
  await dbPool.query('DELETE FROM datasets WHERE id = $1', [datasetId]).catch(() => undefined);
  await dbPool.query('DELETE FROM datasets WHERE id = $1', [fairnessDatasetId]).catch(() => undefined);
  await dbPool.query('DELETE FROM datasets WHERE id = $1', [fairnessDatasetCId]).catch(() => undefined);
  await dbPool.query('DELETE FROM datasets WHERE id = $1', [fairnessOtherOrganizationDatasetId]).catch(() => undefined);
  await dbPool.query(
    'DELETE FROM users WHERE id = ANY($1::text[])',
    [[user.id, teammate.id, otherOrganizationUser.id]],
  ).catch(() => undefined);
  await dbPool.query('DELETE FROM organizations WHERE id = $1', [otherOrganizationId]).catch(() => undefined);
  await closeDatabase();
}
