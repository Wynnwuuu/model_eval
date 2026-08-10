import type { PoolClient } from 'pg';

import { serverConfig } from '../config.ts';
import { dbPool } from '../db/client.ts';
import {
  admitGenerationCapacityProbe,
  applyGenerationCapacityEvidence,
  capacityBucketKey,
  classifyGenerationCapacityEvidence,
  consumeGenerationSubmitToken,
  createInitialGenerationCapacityState,
  generationGlobalCapacityPolicy,
  markGenerationCapacityProbeAccepted,
  refreshGenerationCapacityState,
  type GenerationCapacityState,
} from './generationAdaptiveCapacity.ts';

const GLOBAL_CAPACITY_KEY = '__video_global__';
const VIDEO_ACTIVE_STATUSES = ['submitting', 'submitted', 'processing'];
const VIDEO_TERMINAL_STATUSES = ['succeeded', 'completed', 'failed', 'submission_unknown', 'cancelled'];

export type GenerationCapacityDescriptor = {
  capacityKey: string;
  modelConfigId: string;
  modelName: string;
  groupId?: string;
  generationType: string;
  configFingerprint?: string;
};

export type GenerationCapacityReservation = {
  adaptive: boolean;
  enforced: boolean;
  allowed: boolean;
  reason?: string;
  capacityKey: string;
  bucketLimit: number;
  globalLimit: number;
  bucketProbe: boolean;
  globalProbe: boolean;
  shadowEndsAt?: number;
  bucketState: GenerationCapacityState;
  globalState: GenerationCapacityState;
};

type CapacityStateRecord = {
  capacityKey: string;
  scope: 'global' | 'bucket';
  state: GenerationCapacityState;
  enforceAfter?: number;
};

const toTimestamp = (value: Date | string | number | null | undefined) =>
  value ? new Date(value).getTime() : undefined;

const hydrateState = (
  value: Record<string, unknown> | null | undefined,
  initialWindow: number,
  now: number,
): GenerationCapacityState => {
  const initial = createInitialGenerationCapacityState(
    serverConfig.generationVideoAdaptivePolicy,
    now,
    initialWindow,
  );
  return {
    ...initial,
    ...(value || {}),
    availabilityFailureTimes: Array.isArray(value?.availabilityFailureTimes)
      ? value.availabilityFailureTimes.map(Number).filter(Number.isFinite)
      : [],
    recentSaturatedOutcomes: Array.isArray(value?.recentSaturatedOutcomes)
      ? value.recentSaturatedOutcomes.filter(item => item === 'success' || item === 'timeout') as Array<'success' | 'timeout'>
      : [],
  };
};

export const generationCapacityDescriptor = (
  model: Record<string, any>,
  request: Record<string, any>,
): GenerationCapacityDescriptor => {
  const modelName = String(model.modelName || model.name || model.id || 'unknown-video-model');
  const modelConfigId = String(model.configId || model.id || modelName);
  const generationType = String(
    request.generationType
    || request.resolvedInputs?.generationType
    || 'unknown_generation',
  );
  return {
    capacityKey: capacityBucketKey(modelConfigId, generationType),
    modelConfigId,
    modelName,
    groupId: model.groupId ? String(model.groupId) : undefined,
    generationType,
    configFingerprint: model.configFingerprint ? String(model.configFingerprint) : undefined,
  };
};

const mapStateRow = (row: any, initialWindow: number, now: number): CapacityStateRecord => ({
  capacityKey: row.capacity_key,
  scope: row.scope,
  state: hydrateState(row.state_json, initialWindow, now),
  enforceAfter: toTimestamp(row.enforce_after),
});

const saveState = async (
  client: PoolClient,
  record: CapacityStateRecord,
  descriptor?: GenerationCapacityDescriptor,
) => {
  await client.query(
    `
      UPDATE generation_capacity_states
      SET state_json = $2::jsonb,
          model_config_id = COALESCE($3, model_config_id),
          model_name = COALESCE($4, model_name),
          group_id = $5,
          generation_type = COALESCE($6, generation_type),
          config_fingerprint = COALESCE($7, config_fingerprint),
          policy_version = $8,
          last_activity_at = to_timestamp($9 / 1000.0),
          updated_at = now()
      WHERE capacity_key = $1
    `,
    [
      record.capacityKey,
      JSON.stringify(record.state),
      descriptor?.modelConfigId || null,
      descriptor?.modelName || null,
      descriptor?.groupId || null,
      descriptor?.generationType || null,
      descriptor?.configFingerprint || null,
      serverConfig.generationVideoAdaptivePolicy.policyVersion,
      record.state.lastActivityAt,
    ],
  );
};

const ensureGlobalState = async (
  client: PoolClient,
  now: number,
): Promise<CapacityStateRecord> => {
  const policy = serverConfig.generationVideoAdaptivePolicy;
  const inserted = createInitialGenerationCapacityState(policy, now, policy.initialGlobalLimit);
  inserted.submitRatePerMinute = policy.globalSubmitRatePerSecond * 60;
  inserted.submitTokens = policy.globalSubmitBurst;
  inserted.configFingerprint = `policy-${policy.policyVersion}`;
  await client.query(
    `
      INSERT INTO generation_capacity_states (
        capacity_key, scope, state_json, config_fingerprint, policy_version,
        enforce_after, last_activity_at
      )
      VALUES (
        $1, 'global', $2::jsonb, $3, $4,
        to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0)
      )
      ON CONFLICT (capacity_key) DO NOTHING
    `,
    [
      GLOBAL_CAPACITY_KEY,
      JSON.stringify(inserted),
      inserted.configFingerprint,
      policy.policyVersion,
      now + policy.shadowMs,
      now,
    ],
  );
  const result = await client.query(
    'SELECT * FROM generation_capacity_states WHERE capacity_key = $1 FOR UPDATE',
    [GLOBAL_CAPACITY_KEY],
  );
  if (Number(result.rows[0]?.policy_version || 0) !== policy.policyVersion
    || !result.rows[0]?.enforce_after) {
    const reset = createInitialGenerationCapacityState(policy, now, policy.initialGlobalLimit);
    reset.submitRatePerMinute = policy.globalSubmitRatePerSecond * 60;
    reset.submitTokens = policy.globalSubmitBurst;
    reset.configFingerprint = `policy-${policy.policyVersion}`;
    const enforceAfter = now + policy.shadowMs;
    await client.query(
      `
        UPDATE generation_capacity_states
        SET state_json = $2::jsonb,
            config_fingerprint = $3,
            policy_version = $4,
            enforce_after = to_timestamp($5 / 1000.0),
            last_activity_at = to_timestamp($6 / 1000.0),
            updated_at = now()
        WHERE capacity_key = $1
      `,
      [GLOBAL_CAPACITY_KEY, JSON.stringify(reset), reset.configFingerprint, policy.policyVersion, enforceAfter, now],
    );
    return {
      capacityKey: GLOBAL_CAPACITY_KEY,
      scope: 'global',
      state: reset,
      enforceAfter,
    };
  }
  const record = mapStateRow(result.rows[0], policy.initialGlobalLimit, now);
  const refreshed = refreshGenerationCapacityState(
    record.state,
    `policy-${policy.policyVersion}`,
    now,
    policy,
  );
  if (refreshed !== record.state) {
    record.state = refreshed;
    await saveState(client, record);
  }
  return record;
};

export const initializeAdaptiveGenerationCapacity = async () => {
  if (!serverConfig.generationVideoAdaptiveEnabled) return;
  const existing = await dbPool.query(
    'SELECT policy_version, enforce_after FROM generation_capacity_states WHERE capacity_key = $1',
    [GLOBAL_CAPACITY_KEY],
  );
  if (Number(existing.rows[0]?.policy_version || 0)
    === serverConfig.generationVideoAdaptivePolicy.policyVersion
    && existing.rows[0]?.enforce_after) return;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['manueval:generation:video']);
    await ensureGlobalState(client, Date.now());
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

const replayBucketHistory = async (
  client: PoolClient,
  descriptor: GenerationCapacityDescriptor,
  state: GenerationCapacityState,
  now: number,
) => {
  const policy = serverConfig.generationVideoAdaptivePolicy;
  const result = await client.query(
    `
      SELECT
        item.status,
        item.error_json,
        item.submission_started_at,
        item.started_at,
        item.finished_at
      FROM generation_job_items item
      JOIN generation_jobs job ON job.id = item.job_id
      WHERE job.model_config_json->>'outputModality' = 'video'
        AND COALESCE(
          NULLIF(job.model_config_json->>'configId', ''),
          NULLIF(job.model_config_json->>'id', ''),
          NULLIF(job.model_config_json->>'modelName', ''),
          NULLIF(job.model_config_json->>'name', '')
        ) = $1
        AND COALESCE(NULLIF(item.request_json->>'generationType', ''), 'unknown_generation') = $2
        AND item.status = ANY($3::text[])
        AND item.finished_at >= to_timestamp($4 / 1000.0)
      ORDER BY item.finished_at ASC, item.id
      LIMIT 500
    `,
    [descriptor.modelConfigId, descriptor.generationType, VIDEO_TERMINAL_STATUSES, now - policy.historyWindowMs],
  );
  const intervals = result.rows.map(row => ({
    ...row,
    startedAt: toTimestamp(row.submission_started_at) || toTimestamp(row.started_at),
    finishedAt: toTimestamp(row.finished_at),
  }));
  let next = state;
  for (const row of intervals) {
    if (!row.finishedAt) continue;
    const classified = classifyGenerationCapacityEvidence({ status: row.status, error: row.error_json || {} });
    if (classified.kind === 'neutral') continue;
    const activeAtSubmit = row.startedAt
      ? intervals.filter(other => other.startedAt
        && other.startedAt <= row.startedAt
        && (!other.finishedAt || other.finishedAt >= row.startedAt)).length
      : 1;
    next = applyGenerationCapacityEvidence(next, {
      ...classified,
      observedAt: row.finishedAt,
      activeAtSubmit,
      limitAtSubmit: Math.max(next.currentWindow, activeAtSubmit),
    }, policy);
  }
  return refreshGenerationCapacityState(next, descriptor.configFingerprint, now, policy);
};

const ensureBucketState = async (
  client: PoolClient,
  descriptor: GenerationCapacityDescriptor,
  now: number,
): Promise<CapacityStateRecord> => {
  const policy = serverConfig.generationVideoAdaptivePolicy;
  let result = await client.query(
    'SELECT * FROM generation_capacity_states WHERE capacity_key = $1 FOR UPDATE',
    [descriptor.capacityKey],
  );
  if (!result.rows[0]) {
    let initialWindow = policy.coldStartLimit;
    if (descriptor.groupId) {
      const warm = await client.query(
        `
          SELECT state_json
          FROM generation_capacity_states
          WHERE scope = 'bucket'
            AND group_id = $1
            AND generation_type = $2
            AND capacity_key <> $3
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [descriptor.groupId, descriptor.generationType, descriptor.capacityKey],
      );
      const inherited = Number(warm.rows[0]?.state_json?.verifiedWindow || 0);
      if (inherited > 0) initialWindow = Math.min(policy.warmStartLimit, inherited);
    }
    let state = createInitialGenerationCapacityState(policy, now, initialWindow);
    state.configFingerprint = descriptor.configFingerprint;
    state = await replayBucketHistory(client, descriptor, state, now);
    await client.query(
      `
        INSERT INTO generation_capacity_states (
          capacity_key, scope, model_config_id, model_name, group_id, generation_type,
          config_fingerprint, state_json, policy_version, last_activity_at
        )
        VALUES ($1, 'bucket', $2, $3, $4, $5, $6, $7::jsonb, $8, to_timestamp($9 / 1000.0))
        ON CONFLICT (capacity_key) DO NOTHING
      `,
      [
        descriptor.capacityKey,
        descriptor.modelConfigId,
        descriptor.modelName,
        descriptor.groupId || null,
        descriptor.generationType,
        descriptor.configFingerprint || null,
        JSON.stringify(state),
        policy.policyVersion,
        state.lastActivityAt,
      ],
    );
    result = await client.query(
      'SELECT * FROM generation_capacity_states WHERE capacity_key = $1 FOR UPDATE',
      [descriptor.capacityKey],
    );
  }
  const record = mapStateRow(result.rows[0], policy.coldStartLimit, now);
  const refreshed = refreshGenerationCapacityState(
    record.state,
    descriptor.configFingerprint,
    now,
    policy,
  );
  record.state = refreshed;
  await saveState(client, record, descriptor);
  return record;
};

export const reserveAdaptiveVideoCapacity = async (
  client: PoolClient,
  descriptor: GenerationCapacityDescriptor,
  active: number,
  globalActive: number,
  now = Date.now(),
): Promise<GenerationCapacityReservation> => {
  const policy = serverConfig.generationVideoAdaptivePolicy;
  const global = await ensureGlobalState(client, now);
  const bucket = await ensureBucketState(client, descriptor, now);
  const enforced = serverConfig.generationVideoAdaptiveEnabled
    && Boolean(global.enforceAfter && now >= global.enforceAfter);
  const common = {
    adaptive: serverConfig.generationVideoAdaptiveEnabled,
    enforced,
    capacityKey: descriptor.capacityKey,
    bucketLimit: bucket.state.currentWindow,
    globalLimit: global.state.currentWindow,
    bucketState: bucket.state,
    globalState: global.state,
    shadowEndsAt: global.enforceAfter,
  };
  if (!enforced) {
    return { ...common, allowed: true, bucketProbe: false, globalProbe: false };
  }

  const globalAdmission = admitGenerationCapacityProbe(global.state, globalActive, now);
  if (!globalAdmission.admitted) {
    return {
      ...common,
      allowed: false,
      reason: `global_${globalAdmission.reason || 'capacity'}`,
      bucketProbe: false,
      globalProbe: false,
    };
  }
  const bucketAdmission = admitGenerationCapacityProbe(bucket.state, active, now);
  if (!bucketAdmission.admitted) {
    return {
      ...common,
      allowed: false,
      reason: `bucket_${bucketAdmission.reason || 'capacity'}`,
      bucketProbe: false,
      globalProbe: false,
    };
  }
  const bucketToken = consumeGenerationSubmitToken(
    bucketAdmission.state,
    bucket.state.submitRatePerMinute,
    1,
    now,
  );
  if (!bucketToken.allowed) {
    return {
      ...common,
      allowed: false,
      reason: 'bucket_rate',
      bucketProbe: false,
      globalProbe: false,
      bucketState: bucketToken.state,
    };
  }
  const globalToken = consumeGenerationSubmitToken(
    globalAdmission.state,
    policy.globalSubmitRatePerSecond * 60,
    policy.globalSubmitBurst,
    now,
  );
  if (!globalToken.allowed) {
    return {
      ...common,
      allowed: false,
      reason: 'global_rate',
      bucketProbe: false,
      globalProbe: false,
      globalState: globalToken.state,
    };
  }
  bucket.state = bucketToken.state;
  global.state = globalToken.state;
  await saveState(client, bucket, descriptor);
  await saveState(client, global);
  return {
    ...common,
    allowed: true,
    bucketProbe: bucketAdmission.probing,
    globalProbe: globalAdmission.probing,
    bucketState: bucket.state,
    globalState: global.state,
  };
};

export const markAdaptiveGenerationSubmissionAccepted = async (itemId: string) => {
  if (!serverConfig.generationVideoAdaptiveEnabled) return;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['manueval:generation:video']);
    const result = await client.query(
      `
        SELECT item.*, job.model_config_json
        FROM generation_job_items item
        JOIN generation_jobs job ON job.id = item.job_id
        WHERE item.id = $1
          AND (item.capacity_probe = true OR item.capacity_global_probe = true)
        FOR UPDATE OF item
      `,
      [itemId],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return;
    }
    const now = Date.now();
    if (row.capacity_probe) {
      const descriptor = generationCapacityDescriptor(row.model_config_json || {}, row.request_json || {});
      const bucket = await ensureBucketState(client, descriptor, now);
      bucket.state = markGenerationCapacityProbeAccepted(bucket.state, now);
      await saveState(client, bucket, descriptor);
    }
    if (row.capacity_global_probe) {
      const global = await ensureGlobalState(client, now);
      global.state = markGenerationCapacityProbeAccepted(global.state, now);
      await saveState(client, global);
    }
    await client.query(
      `
        UPDATE generation_job_items
        SET capacity_probe = false,
            capacity_global_probe = false,
            updated_at = now()
        WHERE id = $1
      `,
      [itemId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const observeAdaptiveGenerationOutcome = async (itemId: string) => {
  if (!serverConfig.generationVideoAdaptiveEnabled) return;
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['manueval:generation:video']);
    const result = await client.query(
      `
        SELECT item.*, job.model_config_json
        FROM generation_job_items item
        JOIN generation_jobs job ON job.id = item.job_id
        WHERE item.id = $1
          AND job.model_config_json->>'outputModality' = 'video'
          AND item.capacity_observed_at IS NULL
          AND item.status = ANY($2::text[])
        FOR UPDATE OF item
      `,
      [itemId, VIDEO_TERMINAL_STATUSES],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return;
    }
    const now = toTimestamp(row.finished_at) || Date.now();
    const descriptor = generationCapacityDescriptor(row.model_config_json || {}, row.request_json || {});
    const classified = classifyGenerationCapacityEvidence({ status: row.status, error: row.error_json || {} });
    if (classified.kind !== 'neutral') {
      const bucket = await ensureBucketState(client, descriptor, now);
      const global = await ensureGlobalState(client, now);
      if (row.capacity_probe) bucket.state.probeInFlight = false;
      if (row.capacity_global_probe) global.state.probeInFlight = false;
      const evidence = {
        ...classified,
        observedAt: now,
        activeAtSubmit: Number(row.capacity_active_at_submit || 1),
        limitAtSubmit: Number(row.capacity_limit_at_submit || bucket.state.currentWindow),
      };
      bucket.state = applyGenerationCapacityEvidence(bucket.state, evidence, serverConfig.generationVideoAdaptivePolicy);
      if (classified.kind === 'success') {
        const globalPolicy = generationGlobalCapacityPolicy(serverConfig.generationVideoAdaptivePolicy);
        global.state = applyGenerationCapacityEvidence(global.state, {
          ...evidence,
          activeAtSubmit: Number(row.capacity_global_active_at_submit || 1),
          limitAtSubmit: Number(row.capacity_global_limit_at_submit || global.state.currentWindow),
        }, globalPolicy);
      }

      if (classified.kind === 'availability') {
        const affected = await client.query(
          `
            SELECT count(*)::int AS affected
            FROM generation_capacity_states
            WHERE scope = 'bucket'
              AND state_json->>'lastEvidence' = 'availability'
              AND (state_json->>'lastEvidenceAt')::bigint >= $1
          `,
          [now - serverConfig.generationVideoAdaptivePolicy.availabilityFailureWindowMs],
        );
        if (Number(affected.rows[0]?.affected || 0) >= 2) {
          const reduced = Math.max(1, Math.floor(global.state.currentWindow / 2));
          global.state = {
            ...global.state,
            currentWindow: reduced,
            verifiedWindow: Math.min(global.state.verifiedWindow, reduced),
            phase: 'circuit_open',
            circuitOpenUntil: now + serverConfig.generationVideoAdaptivePolicy.bucketCircuitMs,
            probeInFlight: false,
          };
        }
      }
      await saveState(client, bucket, descriptor);
      await saveState(client, global);
    } else if (row.capacity_probe || row.capacity_global_probe) {
      if (row.capacity_probe) {
        const bucket = await ensureBucketState(client, descriptor, now);
        bucket.state.probeInFlight = false;
        await saveState(client, bucket, descriptor);
      }
      if (row.capacity_global_probe) {
        const global = await ensureGlobalState(client, now);
        global.state.probeInFlight = false;
        await saveState(client, global);
      }
    }
    await client.query(
      `
        UPDATE generation_job_items
        SET capacity_bucket_key = COALESCE(capacity_bucket_key, $2),
            capacity_result_class = $3,
            capacity_observed_at = now(),
            capacity_probe = false,
            capacity_global_probe = false,
            updated_at = now()
        WHERE id = $1
      `,
      [itemId, descriptor.capacityKey, classified.kind],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

let lastReconciledAt = 0;
export const reconcileAdaptiveGenerationOutcomes = async () => {
  if (!serverConfig.generationVideoAdaptiveEnabled || Date.now() - lastReconciledAt < 2_000) return;
  lastReconciledAt = Date.now();
  const result = await dbPool.query(
    `
      SELECT item.id
      FROM generation_job_items item
      JOIN generation_jobs job ON job.id = item.job_id
      WHERE job.model_config_json->>'outputModality' = 'video'
        AND item.capacity_observed_at IS NULL
        AND (
          item.capacity_bucket_key IS NOT NULL
          OR item.finished_at >= now() - interval '1 day'
        )
        AND item.status = ANY($1::text[])
      ORDER BY item.finished_at, item.id
      LIMIT 100
    `,
    [VIDEO_TERMINAL_STATUSES],
  );
  for (const row of result.rows) await observeAdaptiveGenerationOutcome(row.id);
};

export const getAdaptiveVideoCapacitySnapshot = async (organizationId?: string) => {
  await initializeAdaptiveGenerationCapacity();
  const policy = serverConfig.generationVideoAdaptivePolicy;
  const [stateResult, countResult] = await Promise.all([
    dbPool.query('SELECT * FROM generation_capacity_states'),
    dbPool.query(
      `
        SELECT
          COALESCE(
            NULLIF(job.model_config_json->>'configId', ''),
            NULLIF(job.model_config_json->>'id', ''),
            NULLIF(job.model_config_json->>'modelName', ''),
            NULLIF(job.model_config_json->>'name', ''),
            'unknown-video-model'
          ) AS model_config_id,
          COALESCE(
            NULLIF(job.model_config_json->>'modelName', ''),
            NULLIF(job.model_config_json->>'name', ''),
            'unknown-video-model'
          ) AS model_name,
          NULLIF(job.model_config_json->>'groupId', '') AS group_id,
          NULLIF(job.model_config_json->>'configFingerprint', '') AS config_fingerprint,
          COALESCE(NULLIF(item.request_json->>'generationType', ''), 'unknown_generation') AS generation_type,
          count(*) FILTER (WHERE item.status = ANY($2::text[]))::int AS active,
          count(*) FILTER (WHERE item.status = 'pending' AND job.cancel_requested = false)::int AS pending,
          count(*) FILTER (
            WHERE item.status = ANY($2::text[])
              AND ($1::text IS NULL OR dataset.organization_id = $1)
          )::int AS organization_active,
          count(*) FILTER (
            WHERE item.status = 'pending'
              AND job.cancel_requested = false
              AND ($1::text IS NULL OR dataset.organization_id = $1)
          )::int AS organization_pending,
          count(*) FILTER (WHERE item.status = 'reconciling')::int AS reconciling
        FROM generation_jobs job
        JOIN datasets dataset ON dataset.id = job.dataset_id
        JOIN generation_job_items item ON item.job_id = job.id
        WHERE job.model_config_json->>'outputModality' = 'video'
        GROUP BY model_config_id, model_name, group_id, config_fingerprint, generation_type
        HAVING count(*) FILTER (
          WHERE item.status IN ('pending', 'submitting', 'submitted', 'processing', 'reconciling')
            AND ($1::text IS NULL OR dataset.organization_id = $1)
        ) > 0
        ORDER BY model_name, generation_type
      `,
      [organizationId || null, VIDEO_ACTIVE_STATUSES],
    ),
  ]);
  const now = Date.now();
  const states = new Map(stateResult.rows.map(row => [row.capacity_key, row]));
  const globalRow = states.get(GLOBAL_CAPACITY_KEY);
  const global = globalRow
    ? mapStateRow(globalRow, policy.initialGlobalLimit, now)
    : {
        capacityKey: GLOBAL_CAPACITY_KEY,
        scope: 'global' as const,
        state: createInitialGenerationCapacityState(policy, now, policy.initialGlobalLimit),
        enforceAfter: now + policy.shadowMs,
      };
  const enforced = serverConfig.generationVideoAdaptiveEnabled
    && Boolean(global.enforceAfter && now >= global.enforceAfter);
  return {
    enabled: serverConfig.generationVideoAdaptiveEnabled,
    enforced,
    shadowEndsAt: global.enforceAfter,
    hardLimit: policy.hardLimit,
    globalState: global.state,
    buckets: countResult.rows.map(row => {
      const descriptor = generationCapacityDescriptor({
        configId: row.model_config_id,
        modelName: row.model_name,
        groupId: row.group_id,
        configFingerprint: row.config_fingerprint,
      }, { generationType: row.generation_type });
      const stateRow = states.get(descriptor.capacityKey);
      const state = stateRow
        ? mapStateRow(stateRow, policy.coldStartLimit, now).state
        : createInitialGenerationCapacityState(policy, now);
      return {
        ...descriptor,
        active: Number(row.active || 0),
        pending: Number(row.pending || 0),
        organizationActive: Number(row.organization_active || 0),
        organizationPending: Number(row.organization_pending || 0),
        reconciling: Number(row.reconciling || 0),
        state,
      };
    }),
  };
};
