import type {
  DatasetGenerationJob,
  DatasetGenerationJobItem,
  GenerationItemAttemptSummary,
  GenerationItemStatus,
  GenerationJobStatus,
} from '../../src/types.ts';

export type PhysicalGenerationBatch = Pick<
  DatasetGenerationJob,
  | 'id'
  | 'datasetId'
  | 'modelConfig'
  | 'targetColumn'
  | 'inputMapping'
  | 'status'
  | 'total'
  | 'succeeded'
  | 'failed'
  | 'createdAt'
  | 'updatedAt'
> & Partial<Omit<DatasetGenerationJob,
  | 'id'
  | 'datasetId'
  | 'modelConfig'
  | 'targetColumn'
  | 'inputMapping'
  | 'status'
  | 'total'
  | 'succeeded'
  | 'failed'
  | 'createdAt'
  | 'updatedAt'
>> & {
  sourceDatasetVersion?: number;
  controls?: Record<string, any>;
  items: DatasetGenerationJobItem[];
  error?: Record<string, any>;
  startedAt?: number;
  finishedAt?: number;
};

export type GenerationBatchFamily = PhysicalGenerationBatch & {
  rootBatchId: string;
  requestedBatchId: string;
  retryBatchIds: string[];
  physicalBatchCount: number;
  skipped: number;
};

const runningStatuses = new Set<GenerationItemStatus>([
  'submitting',
  'submitted',
  'processing',
  'reconciling',
  'archiving',
  'running',
]);

const rootIdFor = (
  batchesById: Map<string, PhysicalGenerationBatch>,
  requestedBatchId: string,
) => {
  let current = batchesById.get(requestedBatchId);
  const visited = new Set<string>();
  while (current?.retryOfJobId && !visited.has(current.id)) {
    visited.add(current.id);
    current = batchesById.get(current.retryOfJobId) || current;
    if (visited.has(current.id)) break;
  }
  return current?.retryOfJobId ? requestedBatchId : current?.id || requestedBatchId;
};

const toAttemptSummary = (item: DatasetGenerationJobItem): GenerationItemAttemptSummary => ({
  itemId: item.id,
  jobId: item.jobId,
  retryOfItemId: item.retryOfItemId,
  status: item.status,
  resolutionStatus: item.resolutionStatus,
  providerTaskId: item.providerJobId || item.requestId,
  resultUrl: item.resultUrl,
  error: item.error,
  createdAt: item.createdAt,
  startedAt: item.startedAt,
  finishedAt: item.finishedAt,
});

const logicalStatus = (
  total: number,
  succeeded: number,
  failed: number,
  skipped: number,
  pending: number,
  running: number,
  cancelled: number,
  writebackConflict: boolean,
): GenerationJobStatus => {
  if (writebackConflict) return 'writeback_conflict';
  if (running) return 'running';
  if (pending) return 'queued';
  if (total > 0 && succeeded === total) return 'completed';
  if (succeeded > 0 || skipped > 0) return 'partial';
  if (failed > 0) return 'failed';
  return cancelled > 0 ? 'cancelled' : 'failed';
};

export const buildGenerationBatchFamily = (
  physicalBatches: PhysicalGenerationBatch[],
  requestedBatchId: string,
): GenerationBatchFamily => {
  if (!physicalBatches.length) throw new Error('Generation batch family is empty.');
  const batchesById = new Map(physicalBatches.map(batch => [batch.id, batch]));
  const rootBatchId = rootIdFor(batchesById, requestedBatchId);
  const root = batchesById.get(rootBatchId) || physicalBatches[0];
  const batchCreatedAt = new Map(physicalBatches.map(batch => [batch.id, batch.createdAt || 0]));
  const attemptsByStableId = new Map<string, DatasetGenerationJobItem[]>();

  for (const batch of physicalBatches) {
    for (const item of batch.items) {
      const stableId = String(item.datasetItemId || '').trim();
      if (!stableId) continue;
      const attempts = attemptsByStableId.get(stableId) || [];
      attempts.push(item);
      attemptsByStableId.set(stableId, attempts);
    }
  }

  const items = root.items.map(rootItem => {
    const stableId = String(rootItem.datasetItemId || '').trim();
    const attempts = [...(attemptsByStableId.get(stableId) || [rootItem])].sort((left, right) => {
      const leftTime = left.createdAt || left.submissionStartedAt || left.startedAt || batchCreatedAt.get(left.jobId) || 0;
      const rightTime = right.createdAt || right.submissionStartedAt || right.startedAt || batchCreatedAt.get(right.jobId) || 0;
      return leftTime - rightTime || left.id.localeCompare(right.id);
    });
    const latest = attempts.at(-1) || rootItem;
    return {
      ...rootItem,
      ...latest,
      rowIndex: rootItem.rowIndex,
      caseId: rootItem.caseId,
      datasetItemId: rootItem.datasetItemId,
      rootItemId: rootItem.id,
      latestAttemptJobId: latest.jobId,
      attemptCount: attempts.length,
      attemptHistory: attempts.map(toAttemptSummary),
    };
  });

  const pending = items.filter(item => item.status === 'pending').length;
  const submitting = items.filter(item => item.status === 'submitting').length;
  const submitted = items.filter(item => item.status === 'submitted').length;
  const processing = items.filter(item => item.status === 'processing' || item.status === 'running').length;
  const reconciling = items.filter(item => item.status === 'reconciling').length;
  const archiving = items.filter(item => item.status === 'archiving').length;
  const succeeded = items.filter(item => item.status === 'succeeded' || item.status === 'completed').length;
  const skipped = items.filter(item => item.resolutionStatus === 'skipped').length;
  const failedStatus = items.filter(item => item.status === 'failed' && item.resolutionStatus !== 'skipped').length;
  const submissionUnknown = items.filter(item => (
    item.status === 'submission_unknown' && item.resolutionStatus !== 'skipped'
  )).length;
  const failed = failedStatus + submissionUnknown;
  const cancelled = items.filter(item => (
    item.status === 'cancelled' && item.resolutionStatus !== 'skipped'
  )).length;
  const running = items.filter(item => runningStatuses.has(item.status)).length;
  const unresolved = items.filter(item => (
    ['failed', 'submission_unknown'].includes(item.status)
    && !['skipped', 'retrying', 'resolved'].includes(item.resolutionStatus || 'open')
  )).length;
  const writebackStatuses = physicalBatches.map(batch => batch.writebackStatus);
  const writebackStatus = writebackStatuses.some(status => status === 'conflict')
    ? 'conflict' as const
    : writebackStatuses.some(status => status === 'failed')
      ? 'failed' as const
      : writebackStatuses.every(status => status === 'completed')
        ? 'completed' as const
        : 'pending' as const;
  const statusCounts = {
    pending,
    submitting,
    submitted,
    processing,
    archiving,
    reconciling,
    succeeded,
    failed: failedStatus,
    submissionUnknown,
    cancelled,
    unresolved,
  };

  return {
    ...root,
    id: root.id,
    rootBatchId: root.id,
    requestedBatchId,
    retryOfJobId: undefined,
    retryBatchIds: physicalBatches.filter(batch => batch.id !== root.id).map(batch => batch.id),
    physicalBatchCount: physicalBatches.length,
    items,
    total: items.length,
    succeeded,
    failed,
    skipped,
    unresolved,
    statusCounts,
    status: logicalStatus(
      items.length,
      succeeded,
      failed,
      skipped,
      pending,
      running,
      cancelled,
      writebackStatus === 'conflict',
    ),
    writebackStatus,
    updatedAt: Math.max(...physicalBatches.map(batch => batch.updatedAt || 0)),
  };
};
