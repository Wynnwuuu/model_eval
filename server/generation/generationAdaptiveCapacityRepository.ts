import type { PoolClient } from 'pg';

import { serverConfig } from '../config.ts';
import { dbPool } from '../db/client.ts';
import {
  admitGenerationCapacity,
  applyGenerationCapacityEvidence,
  capacityBucketKey,
  classifyGenerationCapacityEvidence,
  consumeGenerationSubmitToken,
  createInitialGenerationCapacityState,
  markGenerationCapacitySubmissionAccepted,
  refreshGenerationCapacityState,
  requiredGenerationCapacityAcceptances,
  type GenerationCapacityOutcome,
  type GenerationCapacityState,
} from './generationAdaptiveCapacity.ts';

const GLOBAL_CAPACITY_KEY = '__video_global__';
const VIDEO_ACTIVE_STATUSES = ['submitting', 'submitted', 'processing'];

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
  bucketProbe: false;
  globalProbe: false;
  bucketState: GenerationCapacityState;
  globalState: GenerationCapacityState;
};

type CapacityStateRecord = {
  capacityKey: string;
  scope: 'global' | 'bucket';
  state: GenerationCapacityState;
};

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
    acceptedInWave: Math.max(0, Number(value?.acceptedInWave || 0)),
    availabilityFailureTimes: Array.isArray(value?.availabilityFailureTimes)
      ? value.availabilityFailureTimes.map(Number).filter(Number.isFinite)
      : [],
  };
};

export const generationCapacityDescriptor = (
  model: Record<string, any>,
  request: Record<string, any>,
): GenerationCapacityDescriptor => {
  const modelName = String(model.modelName || model.name || model.id || 'unknown-video-model');
  const modelConfigId = String(model.configId || model.id || modelName);
  const groupId = model.groupId ? String(model.groupId) : undefined;
  const generationType = String(
    request.generationType
    || request.resolvedInputs?.generationType
    || 'unknown_generation',
  );
  return {
    capacityKey: capacityBucketKey(modelConfigId, groupId),
    modelConfigId,
    modelName,
    groupId,
    generationType,
    configFingerprint: groupId
      ? `group:${groupId}`
      : model.configFingerprint ? String(model.configFingerprint) : undefined,
  };
};

const mapStateRow = (row: any, initialWindow: number, now: number): CapacityStateRecord => ({
  capacityKey: row.capacity_key,
  scope: row.scope,
  state: hydrateState(row.state_json, initialWindow, now),
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
          group_id = COALESCE($5, group_id),
          generation_type = COALESCE($6, generation_type),
          config_fingerprint = COALESCE($7, config_fingerprint),
          policy_version = $8,
          enforce_after = now(),
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
      descriptor ? 'shared' : null,
      descriptor?.configFingerprint || null,
      serverConfig.generationVideoAdaptivePolicy.policyVersion,
      record.state.lastActivityAt,
    ],
  );
};

const createGlobalState = (now: number) => {
  const policy = serverConfig.generationVideoAdaptivePolicy;
  const state = createInitialGenerationCapacityState(policy, now, policy.initialGlobalLimit);
  state.submitTokens = policy.globalSubmitBurst;
  state.submitTokenUpdatedAt = now;
  state.configFingerprint = `policy-${policy.policyVersion}`;
  return state;
};

const ensureGlobalState = async (
  client: PoolClient,
  now: number,
): Promise<CapacityStateRecord> => {
  const policy = serverConfig.generationVideoAdaptivePolicy;
  const inserted = createGlobalState(now);
  await client.query(
    `
      INSERT INTO generation_capacity_states (
        capacity_key, scope, state_json, config_fingerprint, policy_version,
        enforce_after, last_activity_at
      )
      VALUES ($1, 'global', $2::jsonb, $3, $4, now(), to_timestamp($5 / 1000.0))
      ON CONFLICT (capacity_key) DO NOTHING
    `,
    [GLOBAL_CAPACITY_KEY, JSON.stringify(inserted), inserted.configFingerprint, policy.policyVersion, now],
  );
  const result = await client.query(
    'SELECT * FROM generation_capacity_states WHERE capacity_key = $1 FOR UPDATE',
    [GLOBAL_CAPACITY_KEY],
  );
  if (Number(result.rows[0]?.policy_version || 0) !== policy.policyVersion) {
    const reset = createGlobalState(now);
    await client.query(
      `
        UPDATE generation_capacity_states
        SET state_json = $2::jsonb,
            config_fingerprint = $3,
            policy_version = $4,
            enforce_after = now(),
            last_activity_at = to_timestamp($5 / 1000.0),
            updated_at = now()
        WHERE capacity_key = $1
      `,
      [GLOBAL_CAPACITY_KEY, JSON.stringify(reset), reset.configFingerprint, policy.policyVersion, now],
    );
    return { capacityKey: GLOBAL_CAPACITY_KEY, scope: 'global', state: reset };
  }
  const record = mapStateRow(result.rows[0], policy.initialGlobalLimit, now);
  record.state = refreshGenerationCapacityState(
    record.state,
    `policy-${policy.policyVersion}`,
    now,
    policy,
  );
  record.state.currentWindow = policy.initialGlobalLimit;
  record.state.phase = record.state.cooldownUntil && record.state.cooldownUntil > now ? 'cooling' : 'stable';
  await saveState(client, record);
  return record;
};

export const initializeAdaptiveGenerationCapacity = async () => {
  if (!serverConfig.generationVideoAdaptiveEnabled) return;
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
    const state = createInitialGenerationCapacityState(policy, now);
    state.configFingerprint = descriptor.configFingerprint;
    await client.query(
      `
        INSERT INTO generation_capacity_states (
          capacity_key, scope, model_config_id, model_name, group_id, generation_type,
          config_fingerprint, state_json, policy_version, enforce_after, last_activity_at
        )
        VALUES ($1, 'bucket', $2, $3, $4, 'shared', $5, $6::jsonb, $7, now(), to_timestamp($8 / 1000.0))
        ON CONFLICT (capacity_key) DO NOTHING
      `,
      [
        descriptor.capacityKey,
        descriptor.modelConfigId,
        descriptor.modelName,
        descriptor.groupId || null,
        descriptor.configFingerprint || null,
        JSON.stringify(state),
        policy.policyVersion,
        now,
      ],
    );
    result = await client.query(
      'SELECT * FROM generation_capacity_states WHERE capacity_key = $1 FOR UPDATE',
      [descriptor.capacityKey],
    );
  }
  const persistedVersion = Number(result.rows[0]?.policy_version || 0);
  const record = mapStateRow(result.rows[0], policy.coldStartLimit, now);
  record.state = persistedVersion === policy.policyVersion
    ? refreshGenerationCapacityState(record.state, descriptor.configFingerprint, now, policy)
    : {
        ...createInitialGenerationCapacityState(policy, now),
        configFingerprint: descriptor.configFingerprint,
      };
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
  const enforced = serverConfig.generationVideoAdaptiveEnabled;
  const common = {
    adaptive: serverConfig.generationVideoAdaptiveEnabled,
    enforced,
    capacityKey: descriptor.capacityKey,
    bucketLimit: bucket.state.currentWindow,
    globalLimit: global.state.currentWindow,
    bucketProbe: false as const,
    globalProbe: false as const,
    bucketState: bucket.state,
    globalState: global.state,
  };
  if (!enforced) return { ...common, allowed: true };

  const globalAdmission = admitGenerationCapacity(global.state, globalActive, now);
  if (!globalAdmission.admitted) {
    return { ...common, allowed: false, reason: `global_${globalAdmission.reason || 'capacity'}` };
  }
  const bucketAdmission = admitGenerationCapacity(bucket.state, active, now);
  if (!bucketAdmission.admitted) {
    return { ...common, allowed: false, reason: `bucket_${bucketAdmission.reason || 'capacity'}` };
  }
  const globalToken = consumeGenerationSubmitToken(
    global.state,
    policy.globalSubmitRatePerSecond * 60,
    policy.globalSubmitBurst,
    now,
  );
  global.state = globalToken.state;
  await saveState(client, global);
  if (!globalToken.allowed) {
    return { ...common, allowed: false, reason: 'global_rate', globalState: global.state };
  }
  return { ...common, allowed: true, globalState: global.state };
};

const withCapacityTransaction = async <T>(work: (client: PoolClient) => Promise<T>) => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['manueval:generation:video']);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const markAdaptiveGenerationSubmissionAccepted = async (itemId: string) => {
  if (!serverConfig.generationVideoAdaptiveEnabled) return;
  await withCapacityTransaction(async client => {
    const result = await client.query(
      `
        SELECT item.*, job.model_config_json
        FROM generation_job_items item
        JOIN generation_jobs job ON job.id = item.job_id
        WHERE item.id = $1
          AND job.model_config_json->>'outputModality' = 'video'
        FOR UPDATE OF item
      `,
      [itemId],
    );
    const row = result.rows[0];
    if (!row || row.capacity_result_class === 'accepted') return;
    const now = Date.now();
    const descriptor = generationCapacityDescriptor(row.model_config_json || {}, row.request_json || {});
    if (row.capacity_bucket_key !== descriptor.capacityKey) return;
    const bucket = await ensureBucketState(client, descriptor, now);
    bucket.state = markGenerationCapacitySubmissionAccepted(
      bucket.state,
      now,
      serverConfig.generationVideoAdaptivePolicy,
    );
    await saveState(client, bucket, descriptor);
    await client.query(
      `
        UPDATE generation_job_items
        SET capacity_bucket_key = COALESCE(capacity_bucket_key, $2),
            capacity_result_class = 'accepted',
            capacity_observed_at = now(),
            capacity_probe = false,
            capacity_global_probe = false,
            updated_at = now()
        WHERE id = $1
      `,
      [itemId, descriptor.capacityKey],
    );
    console.info('[generation-capacity] submission accepted', {
      capacityKey: descriptor.capacityKey,
      window: bucket.state.currentWindow,
      acceptedInWave: bucket.state.acceptedInWave,
    });
  });
};

export const recordAdaptiveGenerationSubmissionOutcome = async (
  itemId: string,
  outcome: GenerationCapacityOutcome,
) => {
  if (!serverConfig.generationVideoAdaptiveEnabled) return 'neutral' as const;
  return withCapacityTransaction(async client => {
    const result = await client.query(
      `
        SELECT item.*, job.model_config_json
        FROM generation_job_items item
        JOIN generation_jobs job ON job.id = item.job_id
        WHERE item.id = $1
          AND job.model_config_json->>'outputModality' = 'video'
        FOR UPDATE OF item
      `,
      [itemId],
    );
    const row = result.rows[0];
    if (!row || row.capacity_result_class === 'accepted') return 'neutral' as const;
    const now = Date.now();
    const descriptor = generationCapacityDescriptor(row.model_config_json || {}, row.request_json || {});
    if (row.capacity_bucket_key !== descriptor.capacityKey) return 'neutral' as const;
    const classified = classifyGenerationCapacityEvidence(outcome);
    if (classified.kind !== 'neutral') {
      const bucket = await ensureBucketState(client, descriptor, now);
      bucket.state = applyGenerationCapacityEvidence(bucket.state, {
        ...classified,
        observedAt: now,
        activeAtSubmit: Number(row.capacity_active_at_submit || 1),
        limitAtSubmit: Number(row.capacity_limit_at_submit || bucket.state.currentWindow),
      }, serverConfig.generationVideoAdaptivePolicy);
      const availability = classified.kind === 'submission_unknown'
        ? classifyGenerationCapacityEvidence({ status: 'failed', error: outcome.error })
        : { kind: 'neutral' as const };
      if (availability.kind === 'availability') {
        bucket.state = applyGenerationCapacityEvidence(bucket.state, {
          ...availability,
          observedAt: now,
          activeAtSubmit: Number(row.capacity_active_at_submit || 1),
          limitAtSubmit: Number(row.capacity_limit_at_submit || bucket.state.currentWindow),
        }, serverConfig.generationVideoAdaptivePolicy);
      }
      await saveState(client, bucket, descriptor);
      if (classified.kind === 'submission_unknown') {
        const global = await ensureGlobalState(client, now);
        global.state = {
          ...global.state,
          phase: 'cooling',
          cooldownUntil: now + serverConfig.generationVideoAdaptivePolicy.globalSubmissionUnknownCooldownMs,
          lastEvidence: 'submission_unknown',
          lastEvidenceAt: now,
          lastActivityAt: now,
        };
        await saveState(client, global);
      }
      console.info('[generation-capacity] submission feedback', {
        capacityKey: descriptor.capacityKey,
        result: availability.kind === 'availability'
          ? `${classified.kind}+availability`
          : classified.kind,
        window: bucket.state.currentWindow,
        activeAtSubmit: Number(row.capacity_active_at_submit || 1),
      });
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
    return classified.kind;
  });
};

export const getAdaptiveVideoCapacitySnapshot = async (organizationId?: string) => {
  await initializeAdaptiveGenerationCapacity();
  const policy = serverConfig.generationVideoAdaptivePolicy;
  const [stateResult, countResult] = await Promise.all([
    dbPool.query('SELECT * FROM generation_capacity_states WHERE policy_version = $1', [policy.policyVersion]),
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
  const globalState = globalRow
    ? mapStateRow(globalRow, policy.initialGlobalLimit, now).state
    : createGlobalState(now);
  const aggregated = new Map<string, any>();
  for (const row of countResult.rows) {
    const descriptor = generationCapacityDescriptor({
      configId: row.model_config_id,
      modelName: row.model_name,
      groupId: row.group_id,
      configFingerprint: row.config_fingerprint,
    }, { generationType: row.generation_type });
    const aggregateKey = descriptor.capacityKey;
    const existing = aggregated.get(aggregateKey) || {
      ...descriptor,
      modelNames: [],
      modelConfigIds: [],
      generationTypes: [],
      active: 0,
      pending: 0,
      organizationActive: 0,
      organizationPending: 0,
      reconciling: 0,
    };
    existing.modelNames.push(descriptor.modelName);
    existing.modelConfigIds.push(descriptor.modelConfigId);
    existing.generationTypes.push(descriptor.generationType);
    existing.active += Number(row.active || 0);
    existing.pending += Number(row.pending || 0);
    existing.organizationActive += Number(row.organization_active || 0);
    existing.organizationPending += Number(row.organization_pending || 0);
    existing.reconciling += Number(row.reconciling || 0);
    aggregated.set(aggregateKey, existing);
  }
  return {
    strategy: 'optimistic_waves' as const,
    enabled: serverConfig.generationVideoAdaptiveEnabled,
    enforced: serverConfig.generationVideoAdaptiveEnabled,
    hardLimit: policy.hardLimit,
    optimisticWaves: policy.optimisticWaves,
    globalState,
    buckets: [...aggregated.values()].map(bucket => {
      const stateRow = states.get(bucket.capacityKey);
      const persistedState = stateRow
        ? mapStateRow(stateRow, policy.coldStartLimit, now).state
        : createInitialGenerationCapacityState(policy, now);
      const state = refreshGenerationCapacityState(
        persistedState,
        bucket.configFingerprint,
        now,
        policy,
      );
      const requiredAcceptances = requiredGenerationCapacityAcceptances(state, policy);
      return {
        ...bucket,
        modelNames: [...new Set(bucket.modelNames)],
        modelConfigIds: [...new Set(bucket.modelConfigIds)],
        modelName: [...new Set(bucket.modelNames)].join(' / '),
        modelConfigId: [...new Set(bucket.modelConfigIds)].join(', '),
        generationTypes: [...new Set(bucket.generationTypes)],
        generationType: [...new Set(bucket.generationTypes)].join(', '),
        nextWindow: policy.optimisticWaves.find(value => value > state.currentWindow),
        requiredAcceptances,
        state,
      };
    }),
  };
};
