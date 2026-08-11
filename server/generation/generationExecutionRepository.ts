import { randomUUID } from 'node:crypto';

import type { RequestUser } from '../auth/context.ts';
import { dbPool } from '../db/client.ts';
import { serverConfig } from '../config.ts';
import { conflict } from '../http/errors.ts';
import {
  computeGenerationConcurrencyPolicy,
  GENERATION_POLICY_CACHE_MS,
  GENERATION_POLICY_WINDOW_HOURS,
  resolveGenerationVideoModelLimit,
  type GenerationConcurrencyPolicy,
  type GenerationCapacityOutcome,
} from './generationConcurrencyPolicy.ts';
import {
  generationCapacityDescriptor,
  getAdaptiveVideoCapacitySnapshot,
  reserveAdaptiveVideoCapacity,
} from './generationAdaptiveCapacityRepository.ts';


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
  reconciliationStartedAt?: number;
  reconciliationDeadlineAt?: number;
  lastPollSucceededAt?: number;
  consecutivePollFailures: number;
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
const GENERATION_MODEL_NAME_SQL = `
  COALESCE(
    NULLIF(job.model_config_json->>'modelName', ''),
    NULLIF(job.model_config_json->>'name', ''),
    'unknown-video-model'
  )
`;

type CachedVideoPolicies = {
  expiresAt: number;
  policies: Map<string, GenerationConcurrencyPolicy>;
};

let cachedVideoPolicies: CachedVideoPolicies | undefined;

const normalizePolicyModelName = (value: string) => value.trim().toLowerCase();

const policyForModel = (
  policies: Map<string, GenerationConcurrencyPolicy>,
  modelName: string,
) => policies.get(normalizePolicyModelName(modelName)) || computeGenerationConcurrencyPolicy(
  resolveGenerationVideoModelLimit(serverConfig.generationVideoModelLimits, modelName),
  [],
);

const loadGenerationVideoPolicies = async (): Promise<Map<string, GenerationConcurrencyPolicy>> => {
  if (cachedVideoPolicies && cachedVideoPolicies.expiresAt > Date.now()) {
    return cachedVideoPolicies.policies;
  }

  const [modelResult, outcomeResult] = await Promise.all([
    dbPool.query(
      `
        SELECT DISTINCT ${GENERATION_MODEL_NAME_SQL} AS model_name
        FROM generation_jobs job
        JOIN generation_job_items item ON item.job_id = job.id
        WHERE job.model_config_json->>'outputModality' = 'video'
          AND item.status IN ('pending', 'submitting', 'submitted', 'processing', 'reconciling')
      `,
    ),
    dbPool.query(
      `
        WITH ranked AS (
          SELECT
            ${GENERATION_MODEL_NAME_SQL} AS model_name,
            item.status,
            item.error_json,
            item.finished_at,
            row_number() OVER (
              PARTITION BY ${GENERATION_MODEL_NAME_SQL}
              ORDER BY item.finished_at DESC, item.id
            ) AS outcome_rank
          FROM generation_jobs job
          JOIN generation_job_items item ON item.job_id = job.id
          WHERE job.model_config_json->>'outputModality' = 'video'
            AND item.status IN ('succeeded', 'completed', 'failed', 'submission_unknown')
            AND item.finished_at >= now() - ($1::int * interval '1 hour')
        )
        SELECT model_name, status, error_json, finished_at
        FROM ranked
        WHERE outcome_rank <= 24
        ORDER BY model_name, finished_at DESC
      `,
      [GENERATION_POLICY_WINDOW_HOURS],
    ),
  ]);

  const outcomesByModel = new Map<string, GenerationCapacityOutcome[]>();
  for (const row of outcomeResult.rows) {
    const modelName = normalizePolicyModelName(String(row.model_name || 'unknown-video-model'));
    const outcomes = outcomesByModel.get(modelName) || [];
    outcomes.push({
      status: row.status,
      error: row.error_json || {},
      finishedAt: toTimestamp(row.finished_at),
    });
    outcomesByModel.set(modelName, outcomes);
  }

  const modelNames = new Set<string>([
    ...modelResult.rows.map(row => normalizePolicyModelName(String(row.model_name || 'unknown-video-model'))),
    ...outcomesByModel.keys(),
  ]);
  const policies = new Map<string, GenerationConcurrencyPolicy>();
  for (const modelName of modelNames) {
    policies.set(modelName, computeGenerationConcurrencyPolicy(
      resolveGenerationVideoModelLimit(serverConfig.generationVideoModelLimits, modelName),
      outcomesByModel.get(modelName) || [],
    ));
  }
  cachedVideoPolicies = {
    expiresAt: Date.now() + GENERATION_POLICY_CACHE_MS,
    policies,
  };
  return policies;
};



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
    const retryOfJobId = typeof preflight.payload.retryOfJobId === 'string'
      ? preflight.payload.retryOfJobId
      : undefined;
    const retrySourceItemIds = preflight.payload.retrySourceItemIds || {};
    const sourceItemIds = retryOfJobId
      ? cases.map((item: any) => retrySourceItemIds[item.resolvedCase.datasetItemId]).filter(Boolean)
      : [];
    if (retryOfJobId) {
      if (sourceItemIds.length !== cases.length || new Set(sourceItemIds).size !== cases.length) {
        throw conflict('Retry cases no longer match the source batch. Please preflight again.');
      }
      const sourceResult = await client.query(
        `
          SELECT
            item.id,
            item.stable_dataset_item_id,
            item.status,
            item.resolution_status
          FROM generation_job_items item
          JOIN generation_jobs source_job ON source_job.id = item.job_id
          JOIN datasets source_dataset ON source_dataset.id = source_job.dataset_id
          WHERE source_job.id = $1
            AND item.id = ANY($2::text[])
            AND source_job.dataset_id = $3
            AND source_dataset.organization_id = $4
            AND source_job.target_column = $5
            AND source_job.model_config_json->>'modelName' = $6
          FOR UPDATE OF item, source_job
        `,
        [
          retryOfJobId,
          sourceItemIds,
          preflight.datasetId,
          user.organizationId,
          preflight.payload.targetColumn,
          preflight.modelName,
        ],
      );
      if (sourceResult.rowCount !== sourceItemIds.length) {
        throw conflict('One or more retry source cases are unavailable.');
      }
      const sourceRows = new Map(sourceResult.rows.map(row => [row.id, row]));
      const invalidSource = cases.find((item: any) => {
        const source = sourceRows.get(retrySourceItemIds[item.resolvedCase.datasetItemId]);
        return !source
          || source.stable_dataset_item_id !== item.resolvedCase.datasetItemId
          || !['failed', 'submission_unknown', 'cancelled'].includes(source.status)
          || (source.status !== 'cancelled' && source.resolution_status === 'resolved');
      });
      if (invalidSource) {
        throw conflict('A retry source case changed or was already resolved. Refresh the task.');
      }
      const activeRetry = await client.query(
        `
          SELECT retry.id
          FROM generation_job_items retry
          JOIN generation_jobs retry_job ON retry_job.id = retry.job_id
          WHERE retry.retry_of_item_id = ANY($1::text[])
            AND retry_job.writeback_status NOT IN ('completed', 'conflict', 'failed')
          LIMIT 1
        `,
        [sourceItemIds],
      );
      if (activeRetry.rows[0]) throw conflict('A selected case already has an unfinished retry.');
      if (sourceResult.rows.some(row => row.resolution_status === 'retrying')) {
        throw conflict('A retry source case is still marked as retrying. Refresh the task.');
      }
    }
    const controls = {
      defaultControls: preflight.payload.defaultControls || {},
      perCaseControlColumns: preflight.payload.perCaseControlColumns || {},
      parameterBindings: preflight.payload.parameterBindings,
      caseReviews: preflight.payload.caseReviews,
      durationSource: preflight.payload.durationSource,
      seedMode: preflight.payload.seedMode
        || (preflight.payload.seedPolicyVersion === 2 ? 'unused' : 'derive_from_case'),
      seedPolicyVersion: preflight.payload.seedPolicyVersion,
      fixedSeed: preflight.payload.fixedSeed,
      seedColumn: preflight.payload.seedColumn,
      datasetName: preflight.payload.datasetName,
      targetMode: preflight.payload.targetMode || 'new',
      selectionSummary: preflight.result.selectionSummary,
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
        retryOfJobId || null,
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
            id, job_id, stable_dataset_item_id, retry_of_item_id, row_index, case_key, status,
            request_json, error_json, next_poll_at, finished_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
            CASE WHEN $7 = 'pending' THEN now() ELSE NULL END,
            CASE WHEN $7 = 'failed' THEN now() ELSE NULL END
          )
        `,
        [
          itemId,
          jobId,
          item.resolvedCase.datasetItemId,
          retrySourceItemIds[item.resolvedCase.datasetItemId] || null,
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

    if (retryOfJobId) {
      await client.query(
        `
          UPDATE generation_job_items
          SET resolution_status = 'retrying',
              resolution_by = $2,
              resolution_at = now(),
              updated_at = now()
          WHERE id = ANY($1::text[])
        `,
        [sourceItemIds, user.id],
      );
      await client.query(
        `
          INSERT INTO generation_job_events (
            id, organization_id, job_id, action, item_ids_json, actor_id, actor_name, details_json
          )
          VALUES ($1, $2, $3, 'retry_created', $4::jsonb, $5, $6, $7::jsonb)
        `,
        [
          `gen-event-${randomUUID()}`,
          user.organizationId,
          retryOfJobId,
          JSON.stringify(sourceItemIds),
          user.id,
          user.displayName,
          JSON.stringify({
            retryJobId: jobId,
            costEstimate: preflight.result.costEstimate || {},
            duplicateBillingRiskConfirmed: preflight.payload.retryDuplicateBillingRiskConfirmed === true,
          }),
        ],
      );
    }
    await client.query(
      `
        INSERT INTO generation_job_events (
          id, organization_id, job_id, action, item_ids_json, actor_id, actor_name, details_json
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
      `,
      [
        `gen-event-${randomUUID()}`,
        user.organizationId,
        jobId,
        retryOfJobId ? 'retry_batch_created' : 'batch_created',
        JSON.stringify([]),
        user.id,
        user.displayName,
        JSON.stringify(retryOfJobId ? { retryOfJobId } : {}),
      ],
    );

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
  targetMode: job.controls_json?.targetMode,
  selectionSummary: job.controls_json?.selectionSummary,
  inputMapping: job.input_mapping_json || {},
  controls: job.controls_json || {},
  costEstimate: job.cost_estimate_json || {},
  total: job.total,
  succeeded: job.succeeded,
  failed: job.failed,
  retryOfJobId: job.retry_of_job_id || undefined,
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
    retryOfItemId: item.retry_of_item_id || undefined,
    resolutionStatus: item.resolution_status || undefined,
    resolutionBy: item.resolution_by || undefined,
    resolutionAt: toTimestamp(item.resolution_at),
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
    submissionStartedAt: toTimestamp(item.submission_started_at),
    reconciliationStartedAt: toTimestamp(item.reconciliation_started_at),
    reconciliationDeadlineAt: toTimestamp(item.reconciliation_deadline_at),
    lastPollSucceededAt: toTimestamp(item.last_poll_succeeded_at),
    consecutivePollFailures: Number(item.consecutive_poll_failures || 0),
    timeoutAt: toTimestamp(item.submission_started_at)
      ? toTimestamp(item.submission_started_at)! + serverConfig.generationTaskTimeoutMs : undefined,
  })),
});

export const getGenerationBatch = async (jobId: string, organizationId?: string) => {
  const [jobResult, itemResult] = await Promise.all([
    dbPool.query(
      `
        SELECT job.*
        FROM generation_jobs job
        JOIN datasets dataset ON dataset.id = job.dataset_id
        WHERE job.id = $1
          AND ($2::text IS NULL OR dataset.organization_id = $2)
      `,
      [jobId, organizationId || null],
    ),
    dbPool.query(
      'SELECT * FROM generation_job_items WHERE job_id = $1 ORDER BY row_index, id',
      [jobId],
    ),
  ]);
  if (!jobResult.rows[0]) return null;
  return mapBatch(jobResult.rows[0], itemResult.rows);
};

export type GenerationClaimPurpose = 'any' | 'submit' | 'poll';

export const claimNextGenerationItem = async (
  modality: 'image' | 'video',
  owner: string,
  purpose: GenerationClaimPurpose = 'any',
): Promise<ClaimedGenerationItem | null> => {
  const videoPolicies = modality === 'video'
    ? await loadGenerationVideoPolicies()
    : new Map<string, GenerationConcurrencyPolicy>();
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`manueval:generation:${modality}`],
    );

    let row: any;
    let schedulerLog: Record<string, unknown> | undefined;
    if (purpose !== 'submit') {
      const due = await client.query(
        `
          SELECT item.id
          FROM generation_job_items item
          JOIN generation_jobs job ON job.id = item.job_id
          WHERE job.model_config_json->>'outputModality' = $1
            AND item.status IN ('submitting', 'submitted', 'processing', 'reconciling', 'archiving')
            AND (item.next_poll_at IS NULL OR item.next_poll_at <= now())
            AND (item.lease_expires_at IS NULL OR item.lease_expires_at < now())
          ORDER BY item.next_poll_at NULLS FIRST, item.created_at, item.id
          FOR UPDATE OF item SKIP LOCKED
          LIMIT 1
        `,
        [modality],
      );
      if (due.rows[0]) {
        const claimed = await client.query(
          `
            UPDATE generation_job_items
            SET lease_owner = $2,
                lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
                updated_at = now()
            WHERE id = $1
            RETURNING *
          `,
          [due.rows[0].id, owner, serverConfig.generationLeaseMs],
        );
        row = claimed.rows[0];
      }
    }

    if (!row && purpose !== 'poll') {
      const activeResult = await client.query(
        `
          SELECT item.request_json, job.model_config_json
          FROM generation_job_items item
          JOIN generation_jobs job ON job.id = item.job_id
          WHERE job.model_config_json->>'outputModality' = $1
            AND (
              item.status IN ('submitting', 'submitted', 'processing')
              OR (item.status = 'pending' AND item.lease_expires_at > now())
            )
        `,
        [modality],
      );
      const providerActive = activeResult.rowCount || 0;
      if (modality === 'image' && providerActive >= serverConfig.generationImageConcurrency) {
        await client.query('COMMIT');
        return null;
      }
      const activeByCapacityKey = new Map<string, number>();
      const activeByModelName = new Map<string, number>();
      if (modality === 'video') {
        for (const activeRow of activeResult.rows) {
          const descriptor = generationCapacityDescriptor(
            activeRow.model_config_json || {},
            activeRow.request_json || {},
          );
          activeByCapacityKey.set(
            descriptor.capacityKey,
            (activeByCapacityKey.get(descriptor.capacityKey) || 0) + 1,
          );
          const normalizedModelName = descriptor.modelName.trim().toLowerCase();
          activeByModelName.set(
            normalizedModelName,
            (activeByModelName.get(normalizedModelName) || 0) + 1,
          );
        }
      }
      const candidates = await client.query(
        `
          WITH organization_load AS (
            SELECT
              dataset.organization_id,
              count(*) FILTER (
                WHERE item.status IN ('submitting', 'submitted', 'processing')
                  OR (item.status = 'pending' AND item.lease_expires_at > now())
              )::int AS active_count,
              max(item.submission_started_at) AS last_served_at
            FROM generation_jobs job
            JOIN datasets dataset ON dataset.id = job.dataset_id
            JOIN generation_job_items item ON item.job_id = job.id
            WHERE job.model_config_json->>'outputModality' = $1
            GROUP BY dataset.organization_id
          ),
          dataset_load AS (
            SELECT
              job.dataset_id,
              count(*) FILTER (
                WHERE item.status IN ('submitting', 'submitted', 'processing')
                  OR (item.status = 'pending' AND item.lease_expires_at > now())
              )::int AS active_count,
              max(item.submission_started_at) AS last_served_at
            FROM generation_jobs job
            JOIN generation_job_items item ON item.job_id = job.id
            WHERE job.model_config_json->>'outputModality' = $1
            GROUP BY job.dataset_id
          ),
          job_load AS (
            SELECT
              job.id AS job_id,
              count(*) FILTER (
                WHERE item.status IN ('submitting', 'submitted', 'processing')
                  OR (item.status = 'pending' AND item.lease_expires_at > now())
              )::int AS active_count,
              max(item.submission_started_at) AS last_served_at
            FROM generation_jobs job
            JOIN generation_job_items item ON item.job_id = job.id
            WHERE job.model_config_json->>'outputModality' = $1
            GROUP BY job.id
          )
          SELECT
            item.id,
            item.request_json,
            job.model_config_json,
            job.dataset_id,
            job.id AS job_id,
            dataset.organization_id
          FROM generation_job_items item
          JOIN generation_jobs job ON job.id = item.job_id
          JOIN datasets dataset ON dataset.id = job.dataset_id
          LEFT JOIN organization_load ON organization_load.organization_id = dataset.organization_id
          LEFT JOIN dataset_load ON dataset_load.dataset_id = job.dataset_id
          LEFT JOIN job_load ON job_load.job_id = job.id
          WHERE job.model_config_json->>'outputModality' = $1
            AND item.status = 'pending'
            AND (item.next_poll_at IS NULL OR item.next_poll_at <= now())
            AND (item.lease_expires_at IS NULL OR item.lease_expires_at < now())
            AND job.cancel_requested = false
          ORDER BY
            COALESCE(organization_load.active_count, 0),
            organization_load.last_served_at NULLS FIRST,
            COALESCE(dataset_load.active_count, 0),
            dataset_load.last_served_at NULLS FIRST,
            COALESCE(job_load.active_count, 0),
            job_load.last_served_at NULLS FIRST,
            item.row_index,
            item.created_at,
            item.id
          FOR UPDATE OF item SKIP LOCKED
          LIMIT 100
        `,
        [modality],
      );

      let selected: any;
      let capacityReservation: Awaited<ReturnType<typeof reserveAdaptiveVideoCapacity>> | undefined;
      for (const candidate of candidates.rows) {
        if (modality === 'image') {
          selected = candidate;
          break;
        }
        const descriptor = generationCapacityDescriptor(
          candidate.model_config_json || {},
          candidate.request_json || {},
        );
        const bucketActive = activeByCapacityKey.get(descriptor.capacityKey) || 0;
        const legacyModelActive = activeByModelName.get(descriptor.modelName.trim().toLowerCase()) || 0;
        const reservation = await reserveAdaptiveVideoCapacity(
          client,
          descriptor,
          bucketActive,
          providerActive,
        );
        if (!reservation.enforced) {
          const modelPolicy = policyForModel(videoPolicies, descriptor.modelName);
          if (providerActive >= serverConfig.generationVideoConcurrency
            || legacyModelActive >= modelPolicy.effectiveLimit) {
            continue;
          }
        } else if (!reservation.allowed) {
          continue;
        }
        selected = candidate;
        capacityReservation = reservation;
        schedulerLog = {
          modality,
          capacityKey: descriptor.capacityKey,
          modelName: descriptor.modelName,
          generationType: descriptor.generationType,
          organizationId: candidate.organization_id,
          datasetId: candidate.dataset_id,
          batchId: candidate.job_id,
          adaptiveEnforced: reservation.enforced,
          globalActive: providerActive,
          globalLimit: reservation.enforced
            ? reservation.globalLimit
            : serverConfig.generationVideoConcurrency,
          bucketActive: reservation.enforced ? bucketActive : legacyModelActive,
          bucketLimit: reservation.enforced
            ? reservation.bucketLimit
            : policyForModel(videoPolicies, descriptor.modelName).effectiveLimit,
          bucketProbe: reservation.bucketProbe,
          globalProbe: reservation.globalProbe,
        };
        break;
      }
      if (selected) {
        const params: any[] = [selected.id, owner, serverConfig.generationLeaseMs];
        let capacityAssignments = '';
        if (modality === 'video' && capacityReservation) {
          params.push(
            capacityReservation.capacityKey,
            (activeByCapacityKey.get(capacityReservation.capacityKey) || 0) + 1,
            capacityReservation.enforced
              ? capacityReservation.bucketLimit
              : policyForModel(videoPolicies, String(selected.model_config_json?.modelName || selected.model_config_json?.name || '')).effectiveLimit,
            providerActive + 1,
            capacityReservation.enforced
              ? capacityReservation.globalLimit
              : serverConfig.generationVideoConcurrency,
            String(selected.model_config_json?.configFingerprint || ''),
            capacityReservation.bucketProbe,
            capacityReservation.globalProbe,
          );
          capacityAssignments = `,
            capacity_bucket_key = $4,
            capacity_active_at_submit = $5,
            capacity_limit_at_submit = $6,
            capacity_global_active_at_submit = $7,
            capacity_global_limit_at_submit = $8,
            capacity_config_fingerprint = NULLIF($9, ''),
            capacity_probe = $10,
            capacity_global_probe = $11`;
        }
        const claimed = await client.query(
          `
            UPDATE generation_job_items
            SET lease_owner = $2,
                lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
                updated_at = now()
                ${capacityAssignments}
            WHERE id = $1
            RETURNING *
          `,
          params,
        );
        row = claimed.rows[0];
      }
    }

    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    const jobResult = await client.query(
      `
        SELECT job.*, dataset.organization_id
        FROM generation_jobs job
        JOIN datasets dataset ON dataset.id = job.dataset_id
        WHERE job.id = $1
      `,
      [row.job_id],
    );
    const job = jobResult.rows[0];
    await client.query('COMMIT');
    if (!job) return null;

    if (schedulerLog) console.info('[generation-scheduler] pending item claimed', schedulerLog);
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
      reconciliationStartedAt: toTimestamp(row.reconciliation_started_at),
      reconciliationDeadlineAt: toTimestamp(row.reconciliation_deadline_at),
      lastPollSucceededAt: toTimestamp(row.last_poll_succeeded_at),
      consecutivePollFailures: Number(row.consecutive_poll_failures || 0),
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
  resolutionStatus: 'resolution_status',
  resolutionBy: 'resolution_by',
  resolutionAt: 'resolution_at',
  reconciliationStartedAt: 'reconciliation_started_at',
  reconciliationDeadlineAt: 'reconciliation_deadline_at',
  lastPollSucceededAt: 'last_poll_succeeded_at',
  consecutivePollFailures: 'consecutive_poll_failures',
  archivedAssetId: 'archived_asset_id',
  leaseOwner: 'lease_owner',
  leaseExpiresAt: 'lease_expires_at',
};

export const updateGenerationItem = async (itemId: string, values: Record<string, any>) => {
  const nextValues = { ...values };
  if (!Object.prototype.hasOwnProperty.call(nextValues, 'resolutionStatus')) {
    if (['failed', 'submission_unknown'].includes(nextValues.status)) {
      nextValues.resolutionStatus = 'open';
    } else if (['succeeded', 'completed', 'cancelled'].includes(nextValues.status)) {
      nextValues.resolutionStatus = 'resolved';
    }
  }
  const entries = Object.entries(nextValues).filter(([key]) => ITEM_COLUMNS[key]);
  if (!entries.length) return;
  const assignments = entries.map(([key], index) => {
    const column = ITEM_COLUMNS[key];
    if (['request', 'result', 'error'].includes(key)) return `${column} = $${index + 2}::jsonb`;
    if (['nextPollAt', 'submissionStartedAt', 'startedAt', 'finishedAt', 'reconciliationStartedAt', 'reconciliationDeadlineAt', 'lastPollSucceededAt', 'leaseExpiresAt', 'resolutionAt'].includes(key)) {
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
          WHERE status IN ('pending', 'submitting', 'submitted', 'processing', 'reconciling', 'archiving')
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
export const isGenerationBatchInOrganization = async (jobId: string, organizationId: string) => {
  const result = await dbPool.query(
    `
      SELECT 1
      FROM generation_jobs job
      JOIN datasets dataset ON dataset.id = job.dataset_id
      WHERE job.id = $1 AND dataset.organization_id = $2
    `,
    [jobId, organizationId],
  );
  return Boolean(result.rows[0]);
};

export const isGenerationDatasetInOrganization = async (datasetId: string, organizationId: string) => {
  const result = await dbPool.query(
    `
      SELECT 1 FROM datasets
      WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL
    `,
    [datasetId, organizationId],
  );
  return Boolean(result.rows[0]);
};
export const getGenerationQueueState = async (organizationId?: string) => {
  const [result, adaptiveSnapshot, videoPolicies] = await Promise.all([
    dbPool.query(
      `
        SELECT
          job.model_config_json->>'outputModality' AS modality,
          count(*) FILTER (
            WHERE item.status IN ('submitting', 'submitted', 'processing')
          )::int AS active,
          count(*) FILTER (
            WHERE item.status = 'pending' AND job.cancel_requested = false
          )::int AS pending,
          count(*) FILTER (
            WHERE item.status = 'reconciling'
          )::int AS reconciling
        FROM generation_jobs job
        JOIN generation_job_items item ON item.job_id = job.id
        WHERE job.model_config_json->>'outputModality' IN ('image', 'video')
        GROUP BY job.model_config_json->>'outputModality'
      `,
    ),
    getAdaptiveVideoCapacitySnapshot(organizationId),
    loadGenerationVideoPolicies(),
  ]);
  const counts = new Map(result.rows.map(row => [row.modality, row]));
  const lane = (modality: 'image' | 'video', limit: number) => ({
    limit,
    active: Number(counts.get(modality)?.active || 0),
    pending: Number(counts.get(modality)?.pending || 0),
    reconciling: Number(counts.get(modality)?.reconciling || 0),
  });
  const bucketsByModel = new Map<string, typeof adaptiveSnapshot.buckets>();
  for (const bucket of adaptiveSnapshot.buckets) {
    const buckets = bucketsByModel.get(bucket.modelName) || [];
    buckets.push(bucket);
    bucketsByModel.set(bucket.modelName, buckets);
  }
  return {
    image: lane('image', serverConfig.generationImageConcurrency),
    video: {
      ...lane(
        'video',
        adaptiveSnapshot.enforced
          ? adaptiveSnapshot.globalState.currentWindow
          : serverConfig.generationVideoConcurrency,
      ),
      hardLimit: adaptiveSnapshot.hardLimit,
      recommendedLimit: adaptiveSnapshot.globalState.currentWindow,
      strategy: adaptiveSnapshot.strategy,
      optimisticWaves: adaptiveSnapshot.optimisticWaves,
      adaptiveEnabled: adaptiveSnapshot.enabled,
      adaptiveEnforced: adaptiveSnapshot.enforced,
      phase: adaptiveSnapshot.globalState.phase,
      submitRatePerMinute: serverConfig.generationVideoAdaptivePolicy.globalSubmitRatePerSecond * 60,
      submitWorkers: serverConfig.generationVideoAdaptivePolicy.submitWorkers,
      pollWorkers: serverConfig.generationVideoAdaptivePolicy.pollWorkers,
      models: [...bucketsByModel.entries()].map(([modelName, buckets]) => {
        const legacyPolicy = policyForModel(videoPolicies, modelName);
        const effectiveLimit = adaptiveSnapshot.enforced
          ? buckets.reduce((total, bucket) => total + bucket.state.currentWindow, 0)
          : legacyPolicy.effectiveLimit;
        const phases = new Set(buckets.map(bucket => bucket.state.phase));
        const phase = phases.has('circuit_open') ? 'circuit_open'
          : phases.has('cooling') ? 'cooling'
            : phases.has('rate_limited') ? 'rate_limited'
              : phases.has('slow_start') ? 'slow_start'
                : 'stable';
        const mode = ['circuit_open', 'cooling', 'rate_limited'].includes(phase)
          ? 'minimum'
          : phase === 'stable' ? 'maximum' : 'ramping';
        return {
          modelName,
          modelNames: [...new Set(buckets.flatMap(bucket => bucket.modelNames || [bucket.modelName]))],
          active: buckets.reduce((total, bucket) => total + bucket.active, 0),
          pending: buckets.reduce((total, bucket) => total + bucket.pending, 0),
          organizationActive: buckets.reduce((total, bucket) => total + bucket.organizationActive, 0),
          organizationPending: buckets.reduce((total, bucket) => total + bucket.organizationPending, 0),
          minLimit: 1,
          initialLimit: serverConfig.generationVideoAdaptivePolicy.coldStartLimit,
          maxLimit: serverConfig.generationVideoAdaptivePolicy.hardLimit,
          effectiveLimit,
          successStreak: buckets.reduce((total, bucket) => total + bucket.state.acceptedInWave, 0),
          lastCapacityFailureAt: Math.max(0, ...buckets.map(bucket => bucket.state.lastEvidenceAt || 0)) || undefined,
          reconciling: buckets.reduce((total, bucket) => total + bucket.reconciling, 0),
          sampleSize: 0,
          capacityFailures: 0,
          capacityFailureRate: 0,
          mode,
          phase,
          reason: adaptiveSnapshot.enforced
            ? 'Optimistic waves expand on accepted Aion task IDs and share capacity across generation modes.'
            : 'Optimistic waves are disabled; the legacy global-eight limit is enforced.',
          buckets: buckets.map(bucket => ({
            capacityKey: bucket.capacityKey,
            modelConfigId: bucket.modelConfigId,
            modelConfigIds: bucket.modelConfigIds,
            groupId: bucket.groupId,
            generationType: bucket.generationType,
            generationTypes: bucket.generationTypes,
            active: bucket.active,
            pending: bucket.pending,
            organizationActive: bucket.organizationActive,
            organizationPending: bucket.organizationPending,
            currentLimit: bucket.state.currentWindow,
            nextLimit: bucket.nextWindow,
            acceptedInWave: bucket.state.acceptedInWave,
            requiredAcceptances: bucket.requiredAcceptances,
            verifiedLimit: bucket.state.currentWindow,
            submitRatePerMinute: serverConfig.generationVideoAdaptivePolicy.globalSubmitRatePerSecond * 60,
            phase: bucket.state.phase,
            cooldownUntil: bucket.state.cooldownUntil,
            circuitOpenUntil: bucket.state.circuitOpenUntil,
            lastEvidence: bucket.state.lastEvidence,
            lastEvidenceAt: bucket.state.lastEvidenceAt,
            nextProbeRequires: bucket.requiredAcceptances,
            saturatedSuccesses: bucket.state.acceptedInWave,
            probeInFlight: false,
          })),
        };
      }),
    },
    taskTimeoutMs: serverConfig.generationTaskTimeoutMs,
    updatedAt: Date.now(),
  };
};
const insertGenerationEvent = async (
  client: Pick<typeof dbPool, 'query'>,
  jobId: string,
  organizationId: string,
  action: string,
  itemIds: string[],
  user: RequestUser,
  details: Record<string, any> = {},
) => {
  await client.query(
    `
      INSERT INTO generation_job_events (
        id, organization_id, job_id, action, item_ids_json, actor_id, actor_name, details_json
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)
    `,
    [
      `gen-event-${randomUUID()}`,
      organizationId,
      jobId,
      action,
      JSON.stringify(itemIds),
      user.id,
      user.displayName,
      JSON.stringify(details),
    ],
  );
};

export const listGenerationJobEvents = async (jobId: string, organizationId: string) => {
  const result = await dbPool.query(
    `
      SELECT event.*
      FROM generation_job_events event
      WHERE event.job_id = $1 AND event.organization_id = $2
      ORDER BY event.created_at DESC, event.id DESC
    `,
    [jobId, organizationId],
  );
  return result.rows.map(row => ({
    id: row.id,
    jobId: row.job_id,
    action: row.action,
    itemIds: Array.isArray(row.item_ids_json) ? row.item_ids_json : [],
    actorId: row.actor_id || undefined,
    actorName: row.actor_name || undefined,
    details: row.details_json || {},
    createdAt: toTimestamp(row.created_at) || Date.now(),
  }));
};

export const skipGenerationItems = async (
  jobId: string,
  itemIds: string[],
  user: RequestUser,
) => {
  const uniqueItemIds = [...new Set(itemIds.filter(Boolean))];
  if (!uniqueItemIds.length) throw conflict('Select at least one case to skip.');
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const jobResult = await client.query(
      `
        SELECT job.id
        FROM generation_jobs job
        JOIN datasets dataset ON dataset.id = job.dataset_id
        WHERE job.id = $1 AND dataset.organization_id = $2
        FOR UPDATE OF job
      `,
      [jobId, user.organizationId],
    );
    if (!jobResult.rows[0]) throw conflict('Generation batch is unavailable.');
    const itemResult = await client.query(
      `
        SELECT id, status
        FROM generation_job_items
        WHERE job_id = $1 AND id = ANY($2::text[])
        FOR UPDATE
      `,
      [jobId, uniqueItemIds],
    );
    const invalid = itemResult.rows.filter(row =>
      !['pending', 'failed', 'submission_unknown'].includes(row.status));
    if (itemResult.rowCount !== uniqueItemIds.length || invalid.length) {
      throw conflict('Case status changed. Refresh the task before trying again.', {
        invalid: invalid.map(row => ({ id: row.id, status: row.status })),
      });
    }
    await client.query(
      `
        UPDATE generation_job_items
        SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
            resolution_status = 'skipped',
            resolution_by = $3,
            resolution_at = now(),
            finished_at = CASE WHEN status = 'pending' THEN now() ELSE finished_at END,
            updated_at = now()
        WHERE job_id = $1 AND id = ANY($2::text[])
      `,
      [jobId, uniqueItemIds, user.id],
    );
    await insertGenerationEvent(
      client,
      jobId,
      user.organizationId,
      'items_skipped',
      uniqueItemIds,
      user,
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};


export const requestGenerationCancellation = async (jobId: string, user: RequestUser) => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
        UPDATE generation_jobs job
        SET cancel_requested = true, status = 'running', updated_at = now()
        FROM datasets dataset
        WHERE job.id = $1 AND job.status IN ('queued', 'running')
          AND dataset.id = job.dataset_id
          AND dataset.organization_id = $2
        RETURNING job.id
      `,
      [jobId, user.organizationId],
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `
        UPDATE generation_job_items
        SET status = 'cancelled', resolution_status = 'resolved',
            resolution_by = $2, resolution_at = now(),
            finished_at = now(), updated_at = now()
        WHERE job_id = $1 AND status = 'pending'
      `,
      [jobId, user.id],
    );
    await insertGenerationEvent(
      client,
      jobId,
      user.organizationId,
      'batch_cancelled',
      [],
      user,
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
  await dbPool.query(
    `
      UPDATE generation_jobs child
      SET writeback_status = 'conflict',
          status = 'writeback_conflict',
          execution_error_json = jsonb_build_object(
            'code', 'PARENT_WRITEBACK_BLOCKED',
            'message', 'The retry parent could not be written back safely.'
          ),
          updated_at = now()
      FROM generation_jobs parent
      WHERE child.retry_of_job_id = parent.id
        AND child.writeback_status IN ('pending', 'running')
        AND parent.writeback_status IN ('conflict', 'failed')
    `,
  );
  const result = await dbPool.query(
    `
      SELECT job.id
      FROM generation_jobs job
      LEFT JOIN generation_jobs parent ON parent.id = job.retry_of_job_id
      WHERE job.status IN ('completed', 'partial', 'failed', 'cancelled')
        AND (
          job.writeback_status = 'pending'
          OR (job.writeback_status = 'running' AND job.updated_at < now() - ($1::bigint * interval '1 millisecond'))
        )
        AND (job.retry_of_job_id IS NULL OR parent.writeback_status = 'completed')
      ORDER BY job.updated_at, job.created_at
      LIMIT 1
    `,
    [serverConfig.generationLeaseMs * 5],
  );
  return result.rows[0]?.id as string | undefined;
};

export const claimGenerationWriteback = async (jobId: string) => {
  const result = await dbPool.query(
    `
      UPDATE generation_jobs job
      SET writeback_status = 'running', updated_at = now()
      WHERE job.id = $1
        AND status IN ('completed', 'partial', 'failed', 'cancelled')
        AND (
          job.writeback_status = 'pending'
          OR (job.writeback_status = 'running' AND job.updated_at < now() - ($2::bigint * interval '1 millisecond'))
        )
        AND (
          job.retry_of_job_id IS NULL
          OR EXISTS (
            SELECT 1 FROM generation_jobs parent
            WHERE parent.id = job.retry_of_job_id AND parent.writeback_status = 'completed'
          )
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
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `
        UPDATE generation_jobs
        SET writeback_status = $2,
            writeback_dataset_version = $3,
            execution_error_json = $4::jsonb,
            status = CASE WHEN $2 = 'conflict' THEN 'writeback_conflict' ELSE status END,
            updated_at = now()
        WHERE id = $1
        RETURNING retry_of_job_id
      `,
      [jobId, status, datasetVersion || null, JSON.stringify(error || {})],
    );
    if (result.rows[0]?.retry_of_job_id) {
      await client.query(
        `
          UPDATE generation_job_items source
          SET resolution_status = 'resolved', updated_at = now()
          WHERE source.id IN (
            SELECT retry.retry_of_item_id
            FROM generation_job_items retry
            WHERE retry.job_id = $1 AND retry.retry_of_item_id IS NOT NULL
          )
        `,
        [jobId],
      );
    }
    await client.query(
      `
        INSERT INTO generation_job_events (
          id, organization_id, job_id, action, item_ids_json, details_json
        )
        SELECT $1, dataset.organization_id, job.id, 'writeback_finished', '[]'::jsonb, $3::jsonb
        FROM generation_jobs job
        JOIN datasets dataset ON dataset.id = job.dataset_id
        WHERE job.id = $2
      `,
      [
        `gen-event-${randomUUID()}`,
        jobId,
        JSON.stringify({ status, datasetVersion, error: error || {} }),
      ],
    );
    await client.query('COMMIT');
  } catch (writebackError) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw writebackError;
  } finally {
    client.release();
  }
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
      SELECT id, relative_path, file_name, content_type
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
    contentType: row.content_type ? String(row.content_type) : undefined,
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
