import { randomUUID } from 'node:crypto';

import { DATASET_ITEM_ID_KEY } from '../../src/datasetSync.ts';
import {
  DATASET_RESULT_META_KEY,
  collectGenerationDependencyColumns,
  datasetGenerationInputFingerprint,
  type DatasetResultFreshnessMap,
} from '../../src/datasetVersionedSync.ts';
import type { DatasetSchemaField, EvalDataset } from '../../src/types.ts';
import {
  formatGenerationFailureCell,
  sanitizeGenerationFailureError,
} from '../../src/features/generation/generationFailureCell.ts';
import type { RequestUser } from '../auth/context.ts';
import { getDataset, getDatasetVersion, saveDataset } from '../datasets/datasetRepository.ts';
import { conflict } from '../http/errors.ts';
import {
  claimGenerationWriteback,
  finishGenerationWriteback,
  getGenerationBatch,
  getGenerationBatchFamily,
  skipGenerationFamilyItems,
} from './generationExecutionRepository.ts';
import { generationTargetSnapshotFingerprint } from './generationTargetWrite.ts';

const terminalItemStatuses = new Set(['succeeded', 'failed', 'submission_unknown', 'cancelled']);

const skippedStatus = (item: { resolutionStatus?: string; status: string }) => (
  item.resolutionStatus === 'skipped' ? 'skipped' : item.status
);

const itemErrorMessage = (item: { error?: { message?: string }; resolutionStatus?: string }) => (
  item.resolutionStatus === 'skipped'
    ? formatGenerationFailureCell(item as any)
    : item.error?.message || ''
);

const metadataFields = (targetColumn: string): DatasetSchemaField[] => [
  {
    key: `${targetColumn}_status`,
    label: `${targetColumn}_status`,
    type: 'text',
    role: 'metadata',
    sourceKey: `${targetColumn}_status`,
    previewType: 'text',
  },
  {
    key: `${targetColumn}_seed`,
    label: `${targetColumn}_seed`,
    type: 'text',
    role: 'metadata',
    sourceKey: `${targetColumn}_seed`,
    previewType: 'text',
  },
  {
    key: `${targetColumn}_request_id`,
    label: `${targetColumn}_request_id`,
    type: 'text',
    role: 'metadata',
    sourceKey: `${targetColumn}_request_id`,
    previewType: 'text',
  },
  {
    key: `${targetColumn}_error`,
    label: `${targetColumn}_error`,
    type: 'text',
    role: 'metadata',
    sourceKey: `${targetColumn}_error`,
    previewType: 'text',
  },
  {
    key: `${targetColumn}_params_json`,
    label: `${targetColumn}_params_json`,
    type: 'text',
    role: 'system',
    sourceKey: `${targetColumn}_params_json`,
    previewType: 'text',
  },
];

export const writeGenerationBatchToDataset = async (jobId: string) => {
  const claimed = await claimGenerationWriteback(jobId);
  if (!claimed) return false;

  try {
    const batch = await getGenerationBatch(jobId);
    if (!batch) throw new Error('Generation batch was not found during writeback');
    if (!batch.items.every(item => terminalItemStatuses.has(item.status))) {
      await finishGenerationWriteback(jobId, 'failed', undefined, {
        code: 'ITEMS_NOT_TERMINAL',
        message: 'Writeback was attempted before every case reached a terminal state.',
      });
      return false;
    }

    const current = await getDataset(batch.datasetId);
    if (!current) throw new Error('Target dataset was not found during writeback');
    const targetMode = batch.targetMode || batch.controls?.targetMode || 'new';
    const successfulFillCount = batch.items.filter(item => (
      item.status === 'succeeded' && Boolean(String(item.resultUrl || '').trim())
      && item.resolvedInputs?.targetWriteIntent?.action !== 'replace'
    )).length;
    const successfulReplacementCount = batch.items.filter(item => (
      item.status === 'succeeded' && Boolean(String(item.resultUrl || '').trim())
      && item.resolvedInputs?.targetWriteIntent?.action === 'replace'
    )).length;
    const changeSummary = targetMode === 'update_existing'
      ? `Generation batch ${batch.id} updated ${batch.targetColumn}: ${successfulFillCount} filled, ${successfulReplacementCount} replaced.`
      : `Generation batch ${batch.id} wrote output column ${batch.targetColumn}.`;
    const completedVersion = current.versionHistory?.find(entry => entry.changeSummary === changeSummary)?.version;
    if (completedVersion) {
      await finishGenerationWriteback(jobId, 'completed', completedVersion);
      return true;
    }

    const rowsByStableId = new Map(
      current.items.map((row, index) => [String(row[DATASET_ITEM_ID_KEY] || ''), { row, index }]),
    );
    const conflicts: Array<{ caseId: string; reason: string }> = [];
    for (const item of batch.items) {
      const currentRow = rowsByStableId.get(String(item.datasetItemId || ''));
      if (!currentRow) {
        conflicts.push({ caseId: item.caseId, reason: 'stable dataset item no longer exists' });
        continue;
      }
      const intent = item.resolvedInputs?.targetWriteIntent;
      if (targetMode === 'update_existing') {
        if (!intent || !['fill', 'replace'].includes(intent.action) || !intent.expectedSnapshotFingerprint) {
          conflicts.push({ caseId: item.caseId, reason: 'target write intent is missing or invalid' });
          continue;
        }
        const currentFingerprint = generationTargetSnapshotFingerprint(currentRow.row, batch.targetColumn);
        if (currentFingerprint !== intent.expectedSnapshotFingerprint) {
          conflicts.push({ caseId: item.caseId, reason: 'target result or its audit metadata changed after preflight' });
        }
        continue;
      }
      const existing = String(currentRow.row[batch.targetColumn] ?? '').trim();
      if (existing) conflicts.push({ caseId: item.caseId, reason: 'target column is already populated' });
    }
    if (conflicts.length) {
      await finishGenerationWriteback(jobId, 'conflict', undefined, {
        code: 'WRITEBACK_CONFLICT',
        message: 'The dataset changed and the batch cannot be merged without overwriting data.',
        conflicts,
      });
      return false;
    }

    const nextItems = current.items.map(row => ({ ...row }));
    const sourceDataset = batch.sourceDatasetVersion
      ? await getDatasetVersion(batch.datasetId, batch.sourceDatasetVersion)
      : current;
    const sourceRowsByStableId = new Map(
      (sourceDataset?.items || []).map(row => [String(row[DATASET_ITEM_ID_KEY] || ''), row]),
    );
    const candidateColumns = current.inputSchema.map(field => field.key);
    const dependencyColumns = collectGenerationDependencyColumns(
      [batch.inputMapping, batch.controls],
      candidateColumns,
    );
    let datasetChanged = false;
    for (const item of batch.items) {
      const currentRow = rowsByStableId.get(String(item.datasetItemId || ''));
      if (!currentRow) continue;
      const replacement = targetMode === 'update_existing'
        && item.resolvedInputs?.targetWriteIntent?.action === 'replace';
      if (replacement && (
        item.status !== 'succeeded' || !String(item.resultUrl || '').trim()
      )) continue;
      const row = nextItems[currentRow.index];
      if (item.status === 'succeeded') row[batch.targetColumn] = item.resultUrl || '';
      if (item.resolutionStatus === 'skipped') row[batch.targetColumn] = formatGenerationFailureCell(item);
      row[`${batch.targetColumn}_status`] = skippedStatus(item);
      row[`${batch.targetColumn}_seed`] = item.seed ?? '';
      row[`${batch.targetColumn}_request_id`] = item.providerTaskId || item.id;
      row[`${batch.targetColumn}_error`] = itemErrorMessage(item);
      row[`${batch.targetColumn}_params_json`] = JSON.stringify({
        modelName: batch.modelConfig.modelName,
        displayName: batch.modelConfig.displayName,
        provider: batch.modelConfig.provider,
        configFingerprint: batch.modelConfig.configFingerprint,
        generationType: item.resolvedInputs?.generationType,
        controls: item.resolvedControls || {},
        duration: item.resolvedInputs?.durationResolution,
        seed: item.seed,
        originalResultUrl: item.originalResultUrl,
        durability: item.durability,
        resolutionStatus: item.resolutionStatus,
        error: item.resolutionStatus === 'skipped'
          ? sanitizeGenerationFailureError(item.error)
          : item.error || undefined,
      });
      datasetChanged = true;
      if (item.status === 'succeeded' && row[batch.targetColumn]) {
        const sourceRow = sourceRowsByStableId.get(String(item.datasetItemId || '')) || row;
        const resultMeta: DatasetResultFreshnessMap = row[DATASET_RESULT_META_KEY]
          && typeof row[DATASET_RESULT_META_KEY] === 'object'
          ? { ...row[DATASET_RESULT_META_KEY] }
          : {};
        const sourceFingerprint = datasetGenerationInputFingerprint(sourceRow, dependencyColumns);
        const currentFingerprint = datasetGenerationInputFingerprint(row, dependencyColumns);
        resultMeta[batch.targetColumn] = {
          source: 'generation',
          stale: sourceFingerprint !== currentFingerprint,
          inputFingerprint: sourceFingerprint,
          dependencyColumns,
          generatedAt: Date.now(),
          ...(sourceFingerprint !== currentFingerprint ? { staleSinceVersion: current.version || 1 } : {}),
        };
        row[DATASET_RESULT_META_KEY] = resultMeta;
      }
    }

    if (!datasetChanged) {
      await finishGenerationWriteback(jobId, 'completed', current.version || 1);
      return true;
    }

    const outputField: DatasetSchemaField = {
      key: batch.targetColumn,
      label: batch.targetColumn,
      type: batch.modelConfig.outputModality === 'image' ? 'image_url' : 'video_url',
      role: 'output',
      sourceKey: batch.targetColumn,
      previewType: batch.modelConfig.outputModality,
    };
    const addedFields = [outputField, ...metadataFields(batch.targetColumn)];
    const addedKeys = new Set(addedFields.map(field => field.key));
    const inputSchema = [
      ...(current.inputSchema || []).filter(field => !addedKeys.has(field.key)),
      ...addedFields,
    ];
    const now = Date.now();
    const version = (current.version || 0) + 1;
    const actorName = batch.controls?.createdBy || batch.createdBy || 'Generation worker';
    const next: EvalDataset = {
      ...current,
      items: nextItems,
      inputSchema,
      columnMappings: {
        inputColumns: current.columnMappings?.inputColumns || [],
        outputColumns: Array.from(new Set([
          ...(current.columnMappings?.outputColumns || []),
          batch.targetColumn,
        ])),
        dimensionColumns: current.columnMappings?.dimensionColumns || [],
        referenceColumns: current.columnMappings?.referenceColumns || [],
        standard: current.columnMappings?.standard || {},
        ...(current.columnMappings?.caseId ? { caseId: current.columnMappings.caseId } : {}),
      },
      modality: batch.modelConfig.outputModality,
      datasetCard: current.datasetCard
        ? {
          ...current.datasetCard,
          modality: batch.modelConfig.outputModality,
          latestChange: changeSummary,
          updatedAt: now,
        }
        : current.datasetCard,
      version,
      versionHistory: [
        ...(current.versionHistory || []),
        {
          version,
          changedAt: now,
          changedBy: actorName,
          changeSummary,
          itemCountBefore: current.items.length,
          itemCountAfter: nextItems.length,
        },
      ],
      updatedAt: now,
    };
    const actor: RequestUser = {
      id: batch.createdBy || 'generation-worker',
      email: '',
      displayName: actorName,
      organizationId: 'default',
    };
    const saved = await saveDataset(next, actor.id, {
      expectedVersion: current.version || 1,
      forcePropagation: true,
    });
    await finishGenerationWriteback(jobId, 'completed', saved.version);
    return true;
  } catch (error) {
    const isConflict = (error as any)?.statusCode === 409;
    await finishGenerationWriteback(jobId, isConflict ? 'conflict' : 'failed', undefined, {
      code: isConflict ? 'WRITEBACK_CONFLICT' : 'WRITEBACK_FAILED',
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

export const skipGenerationFamilyItemsWithWriteback = async (
  jobId: string,
  itemIds: string[],
  user: RequestUser,
) => {
  const family = await getGenerationBatchFamily(jobId, user.organizationId);
  if (!family) throw new Error('Generation batch was not found.');
  const uniqueItemIds = [...new Set(itemIds.filter(Boolean))];
  const selected = uniqueItemIds.map(itemId => family.items.find(item => item.id === itemId));
  if (!uniqueItemIds.length || selected.some(item => !item)) {
    throw conflict('One or more selected cases are not current attempts in this batch. Refresh and try again.');
  }
  const items = selected.filter(Boolean) as typeof family.items;
  const invalid = items.filter(item => (
    !['pending', 'failed', 'submission_unknown'].includes(item.status)
    || ['skipped', 'retrying', 'resolved'].includes(item.resolutionStatus || '')
  ));
  if (invalid.length) {
    throw conflict('One or more selected cases are not currently skippable. Refresh and try again.', {
      itemIds: invalid.map(item => item.id),
    });
  }
  if (family.writebackStatus === 'conflict' || family.writebackStatus === 'failed') {
    throw conflict('Dataset writeback is unavailable for this batch. Resolve the writeback error before skipping cases.');
  }
  if (family.writebackStatus !== 'completed') return { handled: false as const };

  const current = await getDataset(family.datasetId);
  if (!current) throw new Error('Target dataset was not found during skip writeback.');
  const replacementItems = items.filter(item => (
    family.targetMode === 'update_existing'
    && item.resolvedInputs?.targetWriteIntent?.action === 'replace'
  ));
  if (replacementItems.length === items.length) {
    await skipGenerationFamilyItems(jobId, uniqueItemIds, user);
    return {
      handled: true as const,
      datasetVersion: family.writebackDatasetVersion || current.version || 1,
    };
  }
  const rowsByStableId = new Map(current.items.map((row, index) => [
    String(row[DATASET_ITEM_ID_KEY] || ''),
    { row, index },
  ]));
  const nextItems = current.items.map(row => ({ ...row }));
  for (const item of items) {
    if (replacementItems.some(candidate => candidate.id === item.id)) continue;
    const currentRow = rowsByStableId.get(String(item.datasetItemId || ''));
    if (!currentRow) throw conflict('A selected case no longer exists in the current dataset.', {
      datasetItemId: item.datasetItemId,
    });
    const existing = String(currentRow.row[family.targetColumn] ?? '').trim();
    if (existing) throw conflict('A selected case already has a result and cannot be skipped.', {
      datasetItemId: item.datasetItemId,
    });
    const row = nextItems[currentRow.index];
    const skippedItem = { ...item, resolutionStatus: 'skipped' as const };
    const failureText = formatGenerationFailureCell(skippedItem);
    row[family.targetColumn] = failureText;
    row[`${family.targetColumn}_status`] = 'skipped';
    row[`${family.targetColumn}_seed`] = item.seed ?? '';
    row[`${family.targetColumn}_request_id`] = item.providerJobId || item.requestId || item.id;
    row[`${family.targetColumn}_error`] = failureText;
    row[`${family.targetColumn}_params_json`] = JSON.stringify({
      modelName: family.modelConfig.modelName,
      displayName: family.modelConfig.displayName,
      provider: family.modelConfig.provider,
      configFingerprint: family.modelConfig.configFingerprint,
      generationType: item.resolvedInputs?.generationType,
      controls: item.resolvedControls || {},
      duration: item.resolvedInputs?.durationResolution,
      seed: item.seed,
      resolutionStatus: 'skipped',
      error: sanitizeGenerationFailureError(item.error),
      attemptCount: item.attemptCount || 1,
    });
  }

  const now = Date.now();
  const version = (current.version || 0) + 1;
  const changeSummary = `Generation batch ${family.rootBatchId || family.id} recorded ${items.length} skipped case${items.length === 1 ? '' : 's'} in ${family.targetColumn}.`;
  const next: EvalDataset = {
    ...current,
    items: nextItems,
    version,
    versionHistory: [
      ...(current.versionHistory || []),
      {
        version,
        changedAt: now,
        changedBy: user.displayName || user.id,
        changeSummary,
        itemCountBefore: current.items.length,
        itemCountAfter: nextItems.length,
      },
    ],
    datasetCard: current.datasetCard ? {
      ...current.datasetCard,
      latestChange: changeSummary,
      updatedAt: now,
    } : current.datasetCard,
    updatedAt: now,
  };
  const saved = await saveDataset(next, user.id, {
    expectedVersion: current.version || 1,
    forcePropagation: true,
    beforePersist: async client => {
      const lockedItems = await client.query(
        `
          SELECT item.id, item.status, item.resolution_status
          FROM generation_job_items item
          JOIN generation_jobs job ON job.id = item.job_id
          JOIN datasets dataset ON dataset.id = job.dataset_id
          WHERE item.id = ANY($1::text[])
            AND dataset.organization_id = $2
          FOR UPDATE OF item
        `,
        [uniqueItemIds, user.organizationId],
      );
      const stillValid = lockedItems.rowCount === uniqueItemIds.length
        && lockedItems.rows.every(row => (
          ['pending', 'failed', 'submission_unknown'].includes(row.status)
          && !['skipped', 'retrying', 'resolved'].includes(row.resolution_status || '')
        ));
      if (!stillValid) throw conflict('Case status changed. Refresh the task before trying again.');
      await client.query(
        `
          UPDATE generation_job_items
          SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
              resolution_status = 'skipped',
              resolution_by = $2,
              resolution_at = now(),
              finished_at = CASE WHEN status = 'pending' THEN now() ELSE finished_at END,
              updated_at = now()
          WHERE id = ANY($1::text[])
        `,
        [uniqueItemIds, user.id],
      );
      await client.query(
        `
          INSERT INTO generation_job_events (
            id, organization_id, job_id, action, item_ids_json, actor_id, actor_name, details_json
          )
          VALUES ($1, $2, $3, 'items_skipped', $4::jsonb, $5, $6, $7::jsonb)
        `,
        [
          `gen-event-${randomUUID()}`,
          user.organizationId,
          family.rootBatchId || family.id,
          JSON.stringify(uniqueItemIds),
          user.id,
          user.displayName,
          JSON.stringify({ datasetVersion: version, targetColumn: family.targetColumn }),
        ],
      );
    },
  });
  return { handled: true as const, datasetVersion: saved.version };
};
