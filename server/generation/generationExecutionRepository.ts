import { randomUUID } from 'node:crypto';

import type { RequestUser } from '../auth/context.ts';
import { dbPool } from '../db/client.ts';
import { serverConfig } from '../config.ts';

export type StoredGenerationPreflight = {
  id: string;
  datasetId: string;
  datasetVersion: number;
  modelName: string;
  configFingerprint: string;
  requestHash: string;
  payload: Record<string, any>;
  result: Record<string, any>;
  createdBy: string;
  expiresAt: number;
};

export type ClaimedGenerationItem = {
  id: string;
  jobId: string;
  status: string;
  attempt: number;
  providerTaskId?: string;
  providerEndpointType?: string;
  providerStatus?: string;
  request: Record<string, any>;
  result: Record<string, any>;
  error: Record<string, any>;
  startedAt?: number;
  submissionStartedAt?: number;
  job: {
    id: string;
    datasetId: string;
    sourceDatasetVersion: number;
    targetColumn: string;
    model: Record<string, any>;
    cancelRequested: boolean;
    createdBy: string;
  };
};

const toTimestamp = (value: Date | string | number | null | undefined) =>
  value ? new Date(value).getTime() : undefined;

export const saveGenerationPreflight = async (preflight: StoredGenerationPreflight) => {
  await dbPool.query(
    `
      INSERT INTO generation_preflights (
        id, dataset_id, dataset_version, model_name, config_fingerprint,
        request_hash, payload_json, result_json, created_by, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, to_timestamp($10 / 1000.0))
    `,
    [
      preflight.id,
      preflight.datasetId,
      preflight.datasetVersion,
      preflight.modelName,
      preflight.configFingerprint,
      preflight.requestHash,
      JSON.stringify(preflight.payload),
      JSON.stringify(preflight.result),
      preflight.createdBy,
      preflight.expiresAt,
    ],
  );
  return preflight;
};

export const getGenerationPreflight = async (preflightId: string): Promise<StoredGenerationPreflight | null> => {
  const result = await dbPool.query(
    `
      SELECT *
      FROM generation_preflights
      WHERE id = $1 AND expires_at > now()
    `,
    [preflightId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    datasetId: row.dataset_id,
    datasetVersion: row.dataset_version,
    modelName: row.model_name,
    configFingerprint: row.config_fingerprint,
    requestHash: row.request_hash,
    payload: row.payload_json || {},
    result: row.result_json || {},
    createdBy: row.created_by,
    expiresAt: toTimestamp(row.expires_at) || Date.now(),
  };
};

export const createGenerationBatchFromPreflight = async (
  preflight: StoredGenerationPreflight,
  user: RequestUser,
) => {
  const existing = await dbPool.query(
    'SELECT id FROM generation_jobs WHERE request_hash = $1 LIMIT 1',
    [preflight.requestHash],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, reused: true };

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const jobId = `gen-${randomUUID()}`;
    const allCases = Array.isArray(preflight.result.cases) ? preflight.result.cases : [];
    const cases = allCases.filter((item: any) => item.valid);
    const controls = {
      defaultControls: preflight.payload.defaultControls || {},
      perCaseControlColumns: preflight.payload.perCaseControlColumns || {},
      seedMode: preflight.payload.seedMode || 'derive_from_case',
      fixedSeed: preflight.payload.fixedSeed,
      seedColumn: preflight.payload.seedColumn,
      datasetName: preflight.payload.datasetName,
      assetBindings: preflight.payload.assetBindings || [],
      selectedDatasetItemIds: preflight.payload.selectedDatasetItemIds || [],
      datasetVersion: preflight.datasetVersion,
      createdByUid: user.id,
      createdBy: user.displayName,
    };

    await client.query(
      `
        INSERT INTO generation_jobs (
          id, dataset_id, dataset_version_id, source_dataset_version, preflight_id,
          request_hash, retry_of_job_id, status, model_config_json, target_column, input_mapping_json,
          controls_json, cost_estimate_json, total, succeeded, failed, created_by
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, 'queued', $8::jsonb, $9, $10::jsonb,
          $11::jsonb, $12::jsonb, $13, 0, $14, $15
        )
      `,
      [
        jobId,
        preflight.datasetId,
        `${preflight.datasetId}:v${preflight.datasetVersion}`,
        preflight.datasetVersion,
        preflight.id,
        preflight.requestHash,
        preflight.payload.retryOfJobId || null,
        JSON.stringify(preflight.result.model || {}),
        preflight.payload.targetColumn,
        JSON.stringify(preflight.payload.inputMapping || {}),
        JSON.stringify(controls),
        JSON.stringify(preflight.result.costEstimate || {}),
        cases.length,
        0,
        user.id,
      ],
    );

    for (const item of cases) {
      const itemId = `gen-item-${randomUUID()}`;
      const request = {
        datasetId: preflight.datasetId,
        caseId: item.resolvedCase.caseId,
        resolvedInputs: item.resolvedCase,
        resolvedControls: item.resolvedCase.controls || {},
        seed: item.resolvedCase.seed,
        generationType: item.generationType,
        preflightWarnings: item.warnings || [],
      };
      await client.query(
        `
          INSERT INTO generation_job_items (
            id, job_id, stable_dataset_item_id, row_index, case_key, status,
            request_json, error_json, next_poll_at, finished_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
            CASE WHEN $6 = 'pending' THEN now() ELSE NULL END,
            CASE WHEN $6 = 'failed' THEN now() ELSE NULL END
          )
        `,
        [
          itemId,
          jobId,
          item.resolvedCase.datasetItemId,
          item.resolvedCase.rowIndex,
          item.resolvedCase.caseId,
          item.valid ? 'pending' : 'failed',
          JSON.stringify(request),
          JSON.stringify(item.valid ? {} : {
            code: 'PREFLIGHT_FAILED',
            message: (item.errors || []).map((issue: any) => issue.message).join('?'),
            issues: item.errors || [],
          }),
        ],
      );
    }

    await client.query('COMMIT');
    return { id: jobId, reused: false };
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as any)?.code === '23505') {
      const duplicate = await dbPool.query(
        'SELECT id FROM generation_jobs WHERE request_hash = $1 LIMIT 1',
        [preflight.requestHash],
      );
      if (duplicate.rows[0]) return { id: duplicate.rows[0].id, reused: true };
    }
    throw error;
  } finally {
    client.release();
  }
};

const mapBatch = (job: any, items: any[]) => ({
  id: job.id,
  datasetId: job.dataset_id,
  sourceDatasetVersion: job.source_dataset_version,
  status: job.status,
  modelConfig: job.model_config_json || {},
  targetColumn: job.target_column,
  inputMapping: job.input_mapping_json || {},
  controls: job.controls_json || {},
  costEstimate: job.cost_estimate_json || {},
  total: job.total,
  succeeded: job.succeeded,
  failed: job.failed,
  cancelRequested: job.cancel_requested,
  writebackStatus: job.writeback_status,
  writebackDatasetVersion: job.writeback_dataset_version,
  error: job.execution_error_json || {},
  createdBy: job.created_by,
  createdAt: toTimestamp(job.created_at),
  updatedAt: toTimestamp(job.updated_at),
  startedAt: toTimestamp(job.started_at),
  finishedAt: toTimestamp(job.finished_at),
  items: items.map(item => ({
    id: item.id,
    jobId: item.job_id,
    datasetItemId: item.stable_dataset_item_id,
    rowIndex: item.row_index,
    caseId: item.case_key,
    status: item.status,
    attempt: item.attempt,
    providerTaskId: item.provider_task_id,
    requestId: item.provider_task_id,
    providerJobId: item.provider_task_id,
    providerStatus: item.provider_status,
    resolvedInputs: item.request_json?.resolvedInputs || {},
    resolvedControls: item.request_json?.resolvedControls || {},
    seed: item.request_json?.seed,
    resultUrl: item.result_json?.resultUrl,
    originalResultUrl: item.result_json?.originalResultUrl,
    durability: item.result_json?.durability,
    mediaType: item.result_json?.mediaType,
    error: item.error_json || {},
    startedAt: toTimestamp(item.started_at),
    finishedAt: toTimestamp(item.finished_at),
  })),
});

export const getGenerationBatch = async (jobId: string) => {
  const [jobResult, itemResult] = await Promise.all([
    dbPool.query('SELECT * FROM generation_jobs WHERE id = $1', [jobId]),
    dbPool.query(
      'SELECT * FROM generation_job_items WHERE job_id = $1 ORDER BY row_index, id',
      [jobId],
    ),
  ]);
  if (!jobResult.rows[0]) return null;
  return mapBatch(jobResult.rows[0], itemResult.rows);
};

export const claimNextGenerationItem = async (
  modality: 'image' | 'video',
  owner: string,
): Promise<ClaimedGenerationItem | null> => {
  const concurrencyLimit = modality === 'image'
    ? serverConfig.generationImageConcurrency
    : serverConfig.generationVideoConcurrency;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`manueval:generation:${modality}`],
    );
    const activeResult = await client.query(
      `
        SELECT count(*)::int AS active
        FROM generation_job_items item
        JOIN generation_jobs job ON job.id = item.job_id
        WHERE job.model_config_json->>'outputModality' = $1
          AND item.lease_expires_at > now()
      `,
      [modality],
    );
    if (Number(activeResult.rows[0]?.active || 0) >= concurrencyLimit) {
      await client.query('COMMIT');
      return null;
    }

    const result = await client.query(
      `
        WITH candidate AS (
          SELECT item.id
          FROM generation_job_items item
          JOIN generation_jobs job ON job.id = item.job_id
          WHERE job.model_config_json->>'outputModality' = $1
            AND item.status IN ('pending', 'submitting', 'submitted', 'processing', 'archiving')
            AND (item.next_poll_at IS NULL OR item.next_poll_at <= now())
            AND (item.lease_expires_at IS NULL OR item.lease_expires_at < now())
            AND NOT (job.cancel_requested AND item.status = 'pending')
          ORDER BY item.next_poll_at NULLS FIRST, item.created_at
          FOR UPDATE OF item SKIP LOCKED
          LIMIT 1
        )
        UPDATE generation_job_items item
        SET lease_owner = $2,
            lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
            updated_at = now()
        FROM candidate
        WHERE item.id = candidate.id
        RETURNING item.*
      `,
      [modality, owner, serverConfig.generationLeaseMs],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    const jobResult = await client.query('SELECT * FROM generation_jobs WHERE id = $1', [row.job_id]);
    const job = jobResult.rows[0];
    await client.query('COMMIT');
    if (!job) return null;
    return {
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      attempt: row.attempt,
      providerTaskId: row.provider_task_id || undefined,
      providerEndpointType: row.provider_endpoint_type || undefined,
      providerStatus: row.provider_status || undefined,
      request: row.request_json || {},
      result: row.result_json || {},
      error: row.error_json || {},
      startedAt: toTimestamp(row.started_at),
      submissionStartedAt: toTimestamp(row.submission_started_at),
      job: {
        id: job.id,
        datasetId: job.dataset_id,
        sourceDatasetVersion: job.source_dataset_version,
        targetColumn: job.target_column,
        model: job.model_config_json || {},
        cancelRequested: job.cancel_requested,
        createdBy: job.created_by,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
const ITEM_COLUMNS: Record<string, string> = {
  status: 'status',
  attempt: 'attempt',
  providerTaskId: 'provider_task_id',
  providerEndpointType: 'provider_endpoint_type',
  providerStatus: 'provider_status',
  request: 'request_json',
  result: 'result_json',
  error: 'error_json',
  nextPollAt: 'next_poll_at',
  submissionStartedAt: 'submission_started_at',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  archivedAssetId: 'archived_asset_id',
  leaseOwner: 'lease_owner',
  leaseExpiresAt: 'lease_expires_at',
};

export const updateGenerationItem = async (itemId: string, values: Record<string, any>) => {
  const entries = Object.entries(values).filter(([key]) => ITEM_COLUMNS[key]);
  if (!entries.length) return;
  const assignments = entries.map(([key], index) => {
    const column = ITEM_COLUMNS[key];
    if (['request', 'result', 'error'].includes(key)) return `${column} = $${index + 2}::jsonb`;
    if (['nextPollAt', 'submissionStartedAt', 'startedAt', 'finishedAt', 'leaseExpiresAt'].includes(key)) {
      return `${column} = CASE WHEN $${index + 2}::bigint IS NULL THEN NULL ELSE to_timestamp($${index + 2} / 1000.0) END`;
    }
    return `${column} = $${index + 2}`;
  });
  const params = entries.map(([key, value]) =>
    ['request', 'result', 'error'].includes(key) ? JSON.stringify(value || {}) : value ?? null);
  await dbPool.query(
    `
      UPDATE generation_job_items
      SET ${assignments.join(', ')}, updated_at = now()
      WHERE id = $1
    `,
    [itemId, ...params],
  );
};

export const beginGenerationSubmission = async (
  itemId: string,
  attempt: number,
  startedAt: number,
  submissionStartedAt: number,
) => {
  const result = await dbPool.query(
    `
      UPDATE generation_job_items item
      SET status = 'submitting',
          attempt = $2,
          started_at = COALESCE(item.started_at, to_timestamp($3 / 1000.0)),
          submission_started_at = to_timestamp($4 / 1000.0),
          next_poll_at = NULL,
          updated_at = now()
      FROM generation_jobs job
      WHERE item.id = $1
        AND item.job_id = job.id
        AND item.status = 'pending'
        AND job.cancel_requested = false
      RETURNING item.id
    `,
    [itemId, attempt, startedAt, submissionStartedAt],
  );
  return Boolean(result.rows[0]);
};

export const renewGenerationItemLease = async (itemId: string, owner: string) => {
  const result = await dbPool.query(
    `
      UPDATE generation_job_items
      SET lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
          updated_at = now()
      WHERE id = $1 AND lease_owner = $2
      RETURNING id
    `,
    [itemId, owner, serverConfig.generationLeaseMs],
  );
  return Boolean(result.rows[0]);
};

export const releaseGenerationItemLease = async (itemId: string) => {
  await dbPool.query(
    `
      UPDATE generation_job_items
      SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1
    `,
    [itemId],
  );
};

export const refreshGenerationJob = async (jobId: string) => {
  const result = await dbPool.query(
    `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
        count(*) FILTER (WHERE status IN ('failed', 'submission_unknown'))::int AS failed,
        count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        count(*) FILTER (
          WHERE status IN ('pending', 'submitting', 'submitted', 'processing', 'archiving')
        )::int AS active
      FROM generation_job_items
      WHERE job_id = $1
    `,
    [jobId],
  );
  const counts = result.rows[0];
  const jobResult = await dbPool.query(
    'SELECT cancel_requested FROM generation_jobs WHERE id = $1',
    [jobId],
  );
  if (!jobResult.rows[0]) return null;
  const terminal = counts.active === 0;
  let status = 'running';
  if (terminal) {
    if (jobResult.rows[0].cancel_requested && counts.succeeded === 0) status = 'cancelled';
    else if (counts.succeeded === 0 && counts.failed > 0) status = 'failed';
    else if (counts.failed > 0 || counts.cancelled > 0) status = 'partial';
    else status = 'completed';
  }
  await dbPool.query(
    `
      UPDATE generation_jobs
      SET status = $2,
          total = $3,
          succeeded = $4,
          failed = $5,
          started_at = COALESCE(started_at, now()),
          finished_at = CASE WHEN $6 THEN now() ELSE NULL END,
          updated_at = now()
      WHERE id = $1
    `,
    [jobId, status, counts.total, counts.succeeded, counts.failed, terminal],
  );
  return { ...counts, terminal, status };
};

export const requestGenerationCancellation = async (jobId: string) => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
        UPDATE generation_jobs
        SET cancel_requested = true, status = 'running', updated_at = now()
        WHERE id = $1 AND status IN ('queued', 'running')
        RETURNING id
      `,
      [jobId],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `
        UPDATE generation_job_items
        SET status = 'cancelled', finished_at = now(), updated_at = now()
        WHERE job_id = $1 AND status = 'pending'
      `,
      [jobId],
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const findGenerationWritebackCandidate = async () => {
  const result = await dbPool.query(
    `
      SELECT id
      FROM generation_jobs
      WHERE status IN ('completed', 'partial', 'failed', 'cancelled')
        AND (
          writeback_status = 'pending'
          OR (writeback_status = 'running' AND updated_at < now() - ($1::bigint * interval '1 millisecond'))
        )
      ORDER BY updated_at, created_at
      LIMIT 1
    `,
    [serverConfig.generationLeaseMs * 5],
  );
  return result.rows[0]?.id as string | undefined;
};

export const claimGenerationWriteback = async (jobId: string) => {
  const result = await dbPool.query(
    `
      UPDATE generation_jobs
      SET writeback_status = 'running', updated_at = now()
      WHERE id = $1
        AND status IN ('completed', 'partial', 'failed', 'cancelled')
        AND (
          writeback_status = 'pending'
          OR (writeback_status = 'running' AND updated_at < now() - ($2::bigint * interval '1 millisecond'))
        )
      RETURNING *
    `,
    [jobId, serverConfig.generationLeaseMs * 5],
  );
  return result.rows[0] || null;
};

export const finishGenerationWriteback = async (
  jobId: string,
  status: 'completed' | 'conflict' | 'failed',
  datasetVersion?: number,
  error?: Record<string, any>,
) => {
  await dbPool.query(
    `
      UPDATE generation_jobs
      SET writeback_status = $2,
          writeback_dataset_version = $3,
          execution_error_json = $4::jsonb,
          status = CASE WHEN $2 = 'conflict' THEN 'writeback_conflict' ELSE status END,
          updated_at = now()
      WHERE id = $1
    `,
    [jobId, status, datasetVersion || null, JSON.stringify(error || {})],
  );
};

export type NewGenerationAsset = {
  id?: string;
  organizationId: string;
  datasetId?: string;
  jobId?: string;
  jobItemId?: string;
  kind: string;
  status?: string;
  fileName: string;
  relativePath?: string;
  objectKey: string;
  contentType?: string;
  sizeBytes?: number;
  sourceUrl?: string;
  capabilityTokenHash: string;
  createdBy?: string;
};

export const createGenerationAsset = async (asset: NewGenerationAsset) => {
  const id = asset.id || `asset-${randomUUID()}`;
  await dbPool.query(
    `
      INSERT INTO generation_assets (
        id, organization_id, dataset_id, job_id, job_item_id, kind, status,
        file_name, relative_path, object_key, content_type, size_bytes,
        source_url, capability_token_hash, created_by
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
    `,
    [
      id,
      asset.organizationId,
      asset.datasetId || null,
      asset.jobId || null,
      asset.jobItemId || null,
      asset.kind,
      asset.status || 'pending',
      asset.fileName,
      asset.relativePath || null,
      asset.objectKey,
      asset.contentType || null,
      asset.sizeBytes || null,
      asset.sourceUrl || null,
      asset.capabilityTokenHash,
      asset.createdBy || null,
    ],
  );
  return { ...asset, id };
};

export const updateGenerationAsset = async (
  assetId: string,
  values: { status?: string; contentType?: string; sizeBytes?: number; sourceUrl?: string },
) => {
  await dbPool.query(
    `
      UPDATE generation_assets
      SET status = COALESCE($2, status),
          content_type = COALESCE($3, content_type),
          size_bytes = COALESCE($4, size_bytes),
          source_url = COALESCE($5, source_url),
          updated_at = now()
      WHERE id = $1
    `,
    [
      assetId,
      values.status || null,
      values.contentType || null,
      values.sizeBytes || null,
      values.sourceUrl || null,
    ],
  );
};

export const getGenerationAsset = async (assetId: string) => {
  const result = await dbPool.query('SELECT * FROM generation_assets WHERE id = $1', [assetId]);
  return result.rows[0] || null;
};

export const getGenerationAssetsForPreflight = async (
  assetIds: string[],
  datasetId: string,
  user: RequestUser,
) => {
  if (!assetIds.length) return [];
  const result = await dbPool.query(
    `
      SELECT id, relative_path, file_name
      FROM generation_assets
      WHERE id = ANY($1::text[])
        AND dataset_id = $2
        AND organization_id = $3
        AND created_by = $4
        AND status = 'ready'
    `,
    [assetIds, datasetId, user.organizationId, user.id],
  );
  return result.rows.map(row => ({
    id: String(row.id),
    relativePath: String(row.relative_path || row.file_name),
    fileName: String(row.file_name),
  }));
};

export const findGenerationAssetBySource = async (jobId: string, sourceUrl: string) => {
  const result = await dbPool.query(
    `
      SELECT *
      FROM generation_assets
      WHERE job_id = $1 AND source_url = $2 AND status = 'ready'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [jobId, sourceUrl],
  );
  return result.rows[0] || null;
};
