import type { DatasetGenerationJob, DatasetGenerationJobItem } from '../../src/types.ts';
import { dbPool } from '../db/client.ts';

type GenerationJobRow = {
  id: string;
  dataset_id: string;
  dataset_version_id: string | null;
  retry_of_job_id: string | null;
  source_dataset_version: number | null;
  status: DatasetGenerationJob['status'];
  model_config_json: DatasetGenerationJob['modelConfig'];
  target_column: string | null;
  input_mapping_json: DatasetGenerationJob['inputMapping'];
  controls_json: {
    defaultControls?: DatasetGenerationJob['defaultControls'];
    perCaseControlColumns?: DatasetGenerationJob['perCaseControlColumns'];
    parameterBindings?: DatasetGenerationJob['parameterBindings'];
    caseReviews?: DatasetGenerationJob['caseReviews'];
    seedMode?: DatasetGenerationJob['seedMode'];
    seedPolicyVersion?: DatasetGenerationJob['seedPolicyVersion'];
    fixedSeed?: number;
    seedColumn?: string;
    datasetName?: string;
    datasetVersion?: number;
    createdByUid?: string;
    createdBy?: string;
  } | null;
  total: number;
  succeeded: number;
  failed: number;
  cancel_requested: boolean;
  writeback_status: DatasetGenerationJob['writebackStatus'];
  writeback_dataset_version: number | null;
  dataset_name?: string | null;
  creator_name?: string | null;
  pending_count?: number;
  submitting_count?: number;
  submitted_count?: number;
  processing_count?: number;
  archiving_count?: number;
  reconciling_count?: number;
  succeeded_count?: number;
  failed_count?: number;
  submission_unknown_count?: number;
  cancelled_count?: number;
  unresolved_count?: number;
  execution_error_json: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
  logical_status?: DatasetGenerationJob['status'];
  logical_total?: number;
  logical_succeeded?: number;
  logical_failed?: number;
  logical_skipped?: number;
  logical_writeback_status?: DatasetGenerationJob['writebackStatus'];
  family_updated_at?: Date;
  physical_batch_count?: number;
  full_count?: number;
};

type GenerationJobItemRow = {
  id: string;
  job_id: string;
  dataset_item_id: string | null;
  row_index: number;
  case_key: string | null;
  retry_of_item_id: string | null;
  resolution_status: DatasetGenerationJobItem['resolutionStatus'] | null;
  resolution_by: string | null;
  resolution_at: Date | null;
  submission_started_at: Date | null;
  reconciliation_started_at: Date | null;
  reconciliation_deadline_at: Date | null;
  last_poll_succeeded_at: Date | null;
  consecutive_poll_failures: number;
  stable_dataset_item_id: string | null;
  status: DatasetGenerationJobItem['status'];
  request_json: any;
  result_json: any;
  attempt: number;
  provider_task_id: string | null;
  provider_status: string | null;
  error_json: DatasetGenerationJobItem['error'] | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const toTimestamp = (date: Date | string | number | null | undefined) => {
  if (!date) return undefined;
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

const mapJob = (row: GenerationJobRow): DatasetGenerationJob => {
  const controls = row.controls_json || {};
  const statusCounts = {
    pending: Number(row.pending_count || 0),
    submitting: Number(row.submitting_count || 0),
    submitted: Number(row.submitted_count || 0),
    processing: Number(row.processing_count || 0),
    archiving: Number(row.archiving_count || 0),
    succeeded: Number(row.succeeded_count ?? row.succeeded ?? 0),
    reconciling: Number(row.reconciling_count || 0),
    failed: Number(row.failed_count ?? row.failed ?? 0),
    submissionUnknown: Number(row.submission_unknown_count || 0),
    cancelled: Number(row.cancelled_count || 0),
    unresolved: Number(row.unresolved_count || 0),
  };
  return {
    id: row.id,
    datasetId: row.dataset_id,
    datasetName: row.dataset_name || controls.datasetName,
    datasetVersion: row.source_dataset_version || controls.datasetVersion,
    modelConfig: row.model_config_json,
    targetColumn: row.target_column || '',
    inputMapping: row.input_mapping_json,
    defaultControls: controls.defaultControls || {},
    perCaseControlColumns: controls.perCaseControlColumns || {},
    parameterBindings: controls.parameterBindings,
    caseReviews: controls.caseReviews,
    seedMode: controls.seedMode || (controls.seedPolicyVersion === 2 ? 'unused' : 'derive_from_case'),
    seedPolicyVersion: controls.seedPolicyVersion,
    fixedSeed: controls.fixedSeed,
    seedColumn: controls.seedColumn,
    status: row.logical_status || row.status,
    total: Number(row.logical_total ?? row.total),
    succeeded: Number(row.logical_succeeded ?? row.succeeded),
    cancelRequested: row.cancel_requested,
    writebackStatus: row.logical_writeback_status || row.writeback_status,
    writebackDatasetVersion: row.writeback_dataset_version || undefined,
    failed: Number(row.logical_failed ?? row.failed),
    createdByUid: controls.createdByUid,
    createdBy: row.creator_name || controls.createdBy,
    statusCounts,
    unresolved: statusCounts.unresolved,
    queueReason: statusCounts.unresolved > 0 ? 'needs_attention'
      : statusCounts.pending > 0 ? 'waiting_for_capacity' : undefined,
    retryOfJobId: row.retry_of_job_id || undefined,
    rootBatchId: row.id,
    physicalBatchCount: Number(row.physical_batch_count || 1),
    skipped: Number(row.logical_skipped || 0),
    createdAt: toTimestamp(row.created_at) || Date.now(),
    updatedAt: toTimestamp(row.family_updated_at || row.updated_at) || Date.now(),
  };
};

const mapJobItem = (row: GenerationJobItemRow): DatasetGenerationJobItem => ({
  id: row.id,
  jobId: row.job_id,
  datasetId: row.request_json?.datasetId || '',
  rowIndex: row.row_index,
  caseId: row.case_key || row.request_json?.caseId || row.id,
  status: row.status,
  requestId: row.provider_task_id || row.request_json?.requestId,
  providerJobId: row.provider_task_id || row.request_json?.providerJobId,
  providerStatus: row.provider_status || undefined,
  attempt: row.attempt,
  resolvedInputs: row.request_json?.resolvedInputs || {},
  datasetItemId: row.stable_dataset_item_id || undefined,
  retryOfItemId: row.retry_of_item_id || undefined,
  resolutionStatus: row.resolution_status || undefined,
  resolutionBy: row.resolution_by || undefined,
  resolutionAt: toTimestamp(row.resolution_at),
  resolvedControls: row.request_json?.resolvedControls || {},
  seed: row.request_json?.seed,
  resultUrl: row.result_json?.resultUrl,
  originalResultUrl: row.result_json?.originalResultUrl,
  durability: row.result_json?.durability,
  reconciliationStartedAt: toTimestamp(row.reconciliation_started_at),
  reconciliationDeadlineAt: toTimestamp(row.reconciliation_deadline_at),
  lastPollSucceededAt: toTimestamp(row.last_poll_succeeded_at),
  consecutivePollFailures: Number(row.consecutive_poll_failures || 0),
  resultText: row.result_json?.resultText,
  mediaType: row.result_json?.mediaType,
  error: row.error_json || undefined,
  startedAt: toTimestamp(row.started_at),
  submissionStartedAt: toTimestamp(row.submission_started_at),
  finishedAt: toTimestamp(row.finished_at),
});

export type GenerationJobListParams = {
  organizationId: string;
  datasetId?: string;
  status?: string;
  model?: string;
  createdBy?: string;
  page?: number;
  limit?: number;
};

export const listGenerationJobs = async (params: GenerationJobListParams) => {
  const requestedPage = Number(params.page ?? 1);
  const requestedLimit = Number(params.limit ?? 20);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(100, requestedLimit) : 20;
  const offset = (page - 1) * limit;
  const result = await dbPool.query<GenerationJobRow>(
    `
      WITH RECURSIVE filtered_roots AS (
        SELECT job.id
        FROM generation_jobs job
        JOIN datasets dataset ON dataset.id = job.dataset_id
        LEFT JOIN users creator ON creator.id = job.created_by
        WHERE dataset.organization_id = $1
          AND job.retry_of_job_id IS NULL
          AND ($2::text IS NULL OR job.dataset_id = $2)
          AND (
            $3::text IS NULL
            OR job.model_config_json->>'modelName' ILIKE '%' || $3 || '%'
            OR job.model_config_json->>'displayName' ILIKE '%' || $3 || '%'
          )
          AND (
            $4::text IS NULL
            OR job.created_by = $4
            OR creator.display_name ILIKE '%' || $4 || '%'
            OR creator.email ILIKE '%' || $4 || '%'
          )
      ), family_ids AS (
        SELECT id AS root_id, id AS job_id
        FROM filtered_roots
        UNION ALL
        SELECT family.root_id, child.id
        FROM family_ids family
        JOIN generation_jobs child ON child.retry_of_job_id = family.job_id
      ), ranked_items AS (
        SELECT
          family.root_id,
          item.*,
          row_number() OVER (
            PARTITION BY family.root_id, COALESCE(item.stable_dataset_item_id, item.id)
            ORDER BY item.created_at DESC, item.id DESC
          ) AS latest_rank
        FROM family_ids family
        JOIN generation_job_items item ON item.job_id = family.job_id
      ), latest_item_stats AS (
        SELECT
          root_id,
          count(*)::int AS logical_total,
          count(*) FILTER (WHERE status = 'pending')::int AS pending_count,
          count(*) FILTER (WHERE status = 'submitting')::int AS submitting_count,
          count(*) FILTER (WHERE status = 'submitted')::int AS submitted_count,
          count(*) FILTER (WHERE status IN ('processing', 'running'))::int AS processing_count,
          count(*) FILTER (WHERE status = 'reconciling')::int AS reconciling_count,
          count(*) FILTER (WHERE status = 'archiving')::int AS archiving_count,
          count(*) FILTER (WHERE status IN ('succeeded', 'completed'))::int AS succeeded_count,
          count(*) FILTER (
            WHERE status = 'failed' AND resolution_status IS DISTINCT FROM 'skipped'
          )::int AS failed_count,
          count(*) FILTER (
            WHERE status = 'submission_unknown' AND resolution_status IS DISTINCT FROM 'skipped'
          )::int AS submission_unknown_count,
          count(*) FILTER (
            WHERE status = 'cancelled' AND resolution_status IS DISTINCT FROM 'skipped'
          )::int AS cancelled_count,
          count(*) FILTER (WHERE resolution_status = 'skipped')::int AS logical_skipped,
          count(*) FILTER (
            WHERE status IN ('failed', 'submission_unknown')
              AND COALESCE(resolution_status, 'open') NOT IN ('skipped', 'retrying', 'resolved')
          )::int AS unresolved_count
        FROM ranked_items
        WHERE latest_rank = 1
        GROUP BY root_id
      ), family_job_stats AS (
        SELECT
          family.root_id,
          count(*)::int AS physical_batch_count,
          max(job.updated_at) AS family_updated_at,
          CASE
            WHEN bool_or(job.writeback_status = 'conflict') THEN 'conflict'
            WHEN bool_or(job.writeback_status = 'failed') THEN 'failed'
            WHEN bool_and(job.writeback_status = 'completed') THEN 'completed'
            ELSE 'pending'
          END AS logical_writeback_status
        FROM family_ids family
        JOIN generation_jobs job ON job.id = family.job_id
        GROUP BY family.root_id
      ), summaries AS (
        SELECT
          job.*,
          dataset.name AS dataset_name,
          COALESCE(creator.display_name, creator.email) AS creator_name,
          COALESCE(stats.logical_total, job.total, 0)::int AS logical_total,
          COALESCE(stats.succeeded_count, 0)::int AS logical_succeeded,
          (COALESCE(stats.failed_count, 0) + COALESCE(stats.submission_unknown_count, 0))::int AS logical_failed,
          COALESCE(stats.logical_skipped, 0)::int AS logical_skipped,
          COALESCE(stats.pending_count, 0)::int AS pending_count,
          COALESCE(stats.submitting_count, 0)::int AS submitting_count,
          COALESCE(stats.submitted_count, 0)::int AS submitted_count,
          COALESCE(stats.processing_count, 0)::int AS processing_count,
          COALESCE(stats.reconciling_count, 0)::int AS reconciling_count,
          COALESCE(stats.archiving_count, 0)::int AS archiving_count,
          COALESCE(stats.succeeded_count, 0)::int AS succeeded_count,
          COALESCE(stats.failed_count, 0)::int AS failed_count,
          COALESCE(stats.submission_unknown_count, 0)::int AS submission_unknown_count,
          COALESCE(stats.cancelled_count, 0)::int AS cancelled_count,
          COALESCE(stats.unresolved_count, 0)::int AS unresolved_count,
          family.physical_batch_count,
          family.family_updated_at,
          family.logical_writeback_status,
          CASE
            WHEN family.logical_writeback_status = 'conflict' THEN 'writeback_conflict'
            WHEN COALESCE(stats.submitting_count, 0)
               + COALESCE(stats.submitted_count, 0)
               + COALESCE(stats.processing_count, 0)
               + COALESCE(stats.reconciling_count, 0)
               + COALESCE(stats.archiving_count, 0) > 0 THEN 'running'
            WHEN COALESCE(stats.pending_count, 0) > 0 THEN 'queued'
            WHEN COALESCE(stats.logical_total, 0) > 0
             AND COALESCE(stats.succeeded_count, 0) = COALESCE(stats.logical_total, 0) THEN 'completed'
            WHEN COALESCE(stats.succeeded_count, 0) > 0 OR COALESCE(stats.logical_skipped, 0) > 0 THEN 'partial'
            WHEN COALESCE(stats.failed_count, 0) + COALESCE(stats.submission_unknown_count, 0) > 0 THEN 'failed'
            WHEN COALESCE(stats.cancelled_count, 0) > 0 THEN 'cancelled'
            ELSE job.status
          END AS logical_status
        FROM filtered_roots roots
        JOIN generation_jobs job ON job.id = roots.id
        JOIN datasets dataset ON dataset.id = job.dataset_id
        LEFT JOIN users creator ON creator.id = job.created_by
        LEFT JOIN latest_item_stats stats ON stats.root_id = job.id
        JOIN family_job_stats family ON family.root_id = job.id
      )
      SELECT summaries.*, count(*) OVER()::int AS full_count
      FROM summaries
      WHERE ($5::text IS NULL OR summaries.logical_status = $5)
      ORDER BY
        CASE
          WHEN summaries.logical_status IN ('queued', 'running') OR summaries.unresolved_count > 0 THEN 0
          ELSE 1
        END,
        summaries.family_updated_at DESC,
        summaries.created_at DESC
      LIMIT $6 OFFSET $7
    `,
    [
      params.organizationId,
      params.datasetId || null,
      params.model || null,
      params.createdBy || null,
      params.status || null,
      limit,
      offset,
    ],
  );
  if (!result.rows.length && page > 1) {
    const firstPage = await listGenerationJobs({ ...params, page: 1, limit: 1 });
    return { jobs: [], total: firstPage.total, page, limit };
  }
  return {
    jobs: result.rows.map(mapJob),
    total: Number(result.rows[0]?.full_count || 0),
    page,
    limit,
  };
};

export const listGenerationJobItems = async (
  jobId: string,
  organizationId?: string,
): Promise<DatasetGenerationJobItem[]> => {
  const result = await dbPool.query<GenerationJobItemRow>(
    `
      SELECT item.*
      FROM generation_job_items item
      JOIN generation_jobs job ON job.id = item.job_id
      JOIN datasets dataset ON dataset.id = job.dataset_id
      WHERE item.job_id = $1
        AND ($2::text IS NULL OR dataset.organization_id = $2)
      ORDER BY item.row_index, item.id
    `,
    [jobId, organizationId || null],
  );
  return result.rows.map(mapJobItem);
};

export const saveGenerationJob = async (job: DatasetGenerationJob): Promise<DatasetGenerationJob> => {
  const controls = {
    defaultControls: job.defaultControls || {},
    perCaseControlColumns: job.perCaseControlColumns || {},
    parameterBindings: job.parameterBindings,
    caseReviews: job.caseReviews,
    seedMode: job.seedMode,
    fixedSeed: job.fixedSeed,
    seedColumn: job.seedColumn,
    datasetName: job.datasetName,
    datasetVersion: job.datasetVersion,
    createdByUid: job.createdByUid,
    createdBy: job.createdBy,
  };

  await dbPool.query(
    `
      INSERT INTO generation_jobs (
        id,
        dataset_id,
        status,
        model_config_json,
        target_column,
        input_mapping_json,
        controls_json,
        total,
        succeeded,
        failed,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9, $10,
        to_timestamp($11 / 1000.0), to_timestamp($12 / 1000.0)
      )
      ON CONFLICT (id) DO UPDATE SET
        dataset_id = EXCLUDED.dataset_id,
        status = EXCLUDED.status,
        model_config_json = EXCLUDED.model_config_json,
        target_column = EXCLUDED.target_column,
        input_mapping_json = EXCLUDED.input_mapping_json,
        controls_json = EXCLUDED.controls_json,
        total = EXCLUDED.total,
        succeeded = EXCLUDED.succeeded,
        failed = EXCLUDED.failed,
        updated_at = EXCLUDED.updated_at
    `,
    [
      job.id,
      job.datasetId,
      job.status,
      JSON.stringify(job.modelConfig || {}),
      job.targetColumn,
      JSON.stringify(job.inputMapping || {}),
      JSON.stringify(controls),
      job.total || 0,
      job.succeeded || 0,
      job.failed || 0,
      job.createdAt || Date.now(),
      job.updatedAt || Date.now(),
    ]
  );
  return job;
};

export const saveGenerationJobItem = async (item: DatasetGenerationJobItem): Promise<DatasetGenerationJobItem> => {
  await dbPool.query(
    `
      INSERT INTO generation_job_items (
        id,
        job_id,
        row_index,
        case_key,
        status,
        request_json,
        result_json,
        error_json,
        started_at,
        finished_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb,
        CASE WHEN $9::bigint IS NULL THEN NULL ELSE to_timestamp($9 / 1000.0) END,
        CASE WHEN $10::bigint IS NULL THEN NULL ELSE to_timestamp($10 / 1000.0) END,
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        row_index = EXCLUDED.row_index,
        case_key = EXCLUDED.case_key,
        status = EXCLUDED.status,
        request_json = EXCLUDED.request_json,
        result_json = EXCLUDED.result_json,
        error_json = EXCLUDED.error_json,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        updated_at = now()
    `,
    [
      item.id,
      item.jobId,
      item.rowIndex,
      item.caseId,
      item.status,
      JSON.stringify({
        datasetId: item.datasetId,
        caseId: item.caseId,
        requestId: item.requestId,
        providerJobId: item.providerJobId,
        resolvedInputs: item.resolvedInputs || {},
        resolvedControls: item.resolvedControls || {},
        seed: item.seed,
      }),
      JSON.stringify({
        resultUrl: item.resultUrl,
        originalResultUrl: item.originalResultUrl,
        durability: item.durability,
        resultText: item.resultText,
        mediaType: item.mediaType,
      }),
      JSON.stringify(item.error || {}),
      item.startedAt || null,
      item.finishedAt || null,
    ]
  );
  return item;
};

export const isExecutionManagedGenerationJob = async (jobId: string): Promise<boolean> => {
  const result = await dbPool.query(
    'SELECT 1 FROM generation_jobs WHERE id = $1 AND request_hash IS NOT NULL LIMIT 1',
    [jobId],
  );
  return Boolean(result.rows[0]);
};

export const deleteGenerationJob = async (jobId: string): Promise<boolean> => {
  const result = await dbPool.query(
    `
      DELETE FROM generation_jobs
      WHERE id = $1
    `,
    [jobId]
  );
  return (result.rowCount || 0) > 0;
};
