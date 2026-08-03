import { DATASET_ITEM_ID_KEY } from '../../src/datasetSync.ts';
import type { DatasetSchemaField, EvalDataset } from '../../src/types.ts';
import type { RequestUser } from '../auth/context.ts';
import { getDataset, saveDataset } from '../datasets/datasetRepository.ts';
import {
  claimGenerationWriteback,
  finishGenerationWriteback,
  getGenerationBatch,
} from './generationExecutionRepository.ts';

const terminalItemStatuses = new Set(['succeeded', 'failed', 'submission_unknown', 'cancelled']);

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
    const changeSummary = `Generation batch ${batch.id} wrote output column ${batch.targetColumn}.`;
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
    for (const item of batch.items) {
      const currentRow = rowsByStableId.get(String(item.datasetItemId || ''));
      if (!currentRow) continue;
      const row = nextItems[currentRow.index];
      if (item.status === 'succeeded') row[batch.targetColumn] = item.resultUrl || '';
      row[`${batch.targetColumn}_status`] = item.status;
      row[`${batch.targetColumn}_seed`] = item.seed ?? '';
      row[`${batch.targetColumn}_request_id`] = item.providerTaskId || item.id;
      row[`${batch.targetColumn}_error`] = item.error?.message || '';
      row[`${batch.targetColumn}_params_json`] = JSON.stringify({
        modelName: batch.modelConfig.modelName,
        displayName: batch.modelConfig.displayName,
        provider: batch.modelConfig.provider,
        configFingerprint: batch.modelConfig.configFingerprint,
        generationType: item.resolvedInputs?.generationType,
        controls: item.resolvedControls || {},
        seed: item.seed,
        originalResultUrl: item.originalResultUrl,
        durability: item.durability,
      });
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
