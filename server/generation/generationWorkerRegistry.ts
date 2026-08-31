import { dbPool } from '../db/client.ts';
import { serverConfig } from '../config.ts';

export const GENERATION_WORKER_HEARTBEAT_TTL_MS = 20_000;
const GENERATION_WORKER_STALE_RETENTION_MS = 10 * 60_000;

export type GenerationWorkerStatus = 'starting' | 'ready' | 'draining';

export type GenerationWorkerInstanceRecord = {
  instanceId: string;
  status: GenerationWorkerStatus;
  startedAt: number;
  lastHeartbeatAt: number;
  buildVersion: string;
};

export type GenerationWorkerFleetHealth = {
  workerAvailable: boolean;
  activeWorkerCount: number;
  workerHeartbeatAgeMs?: number;
  workerVersions: string[];
};

export const summarizeGenerationWorkerInstances = (
  instances: GenerationWorkerInstanceRecord[],
  now = Date.now(),
  heartbeatTtlMs = GENERATION_WORKER_HEARTBEAT_TTL_MS,
): GenerationWorkerFleetHealth => {
  const ready = instances.filter(instance =>
    instance.status === 'ready'
    && instance.lastHeartbeatAt <= now
    && now - instance.lastHeartbeatAt <= heartbeatTtlMs);
  const newestHeartbeat = ready.reduce<number | undefined>(
    (newest, instance) => newest === undefined
      ? instance.lastHeartbeatAt
      : Math.max(newest, instance.lastHeartbeatAt),
    undefined,
  );
  return {
    workerAvailable: ready.length > 0,
    activeWorkerCount: ready.length,
    ...(newestHeartbeat === undefined ? {} : { workerHeartbeatAgeMs: now - newestHeartbeat }),
    workerVersions: [...new Set(ready.map(instance => instance.buildVersion))].sort(),
  };
};

const mapWorkerInstance = (row: Record<string, any>): GenerationWorkerInstanceRecord => ({
  instanceId: String(row.instance_id),
  status: row.status as GenerationWorkerStatus,
  startedAt: new Date(row.started_at).getTime(),
  lastHeartbeatAt: new Date(row.last_heartbeat_at).getTime(),
  buildVersion: String(row.build_version || 'unknown'),
});

export const registerGenerationWorkerInstance = async (input: {
  instanceId: string;
  status: GenerationWorkerStatus;
  buildVersion: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  await dbPool.query(
    `
      INSERT INTO generation_worker_instances (
        instance_id, status, started_at, last_heartbeat_at, build_version, metadata_json
      ) VALUES ($1, $2, now(), now(), $3, $4::jsonb)
      ON CONFLICT (instance_id) DO UPDATE
      SET status = EXCLUDED.status,
          started_at = EXCLUDED.started_at,
          last_heartbeat_at = EXCLUDED.last_heartbeat_at,
          build_version = EXCLUDED.build_version,
          metadata_json = EXCLUDED.metadata_json
    `,
    [input.instanceId, input.status, input.buildVersion, JSON.stringify(input.metadata || {})],
  );
};

export const heartbeatGenerationWorkerInstance = async (
  instanceId: string,
  status: GenerationWorkerStatus,
): Promise<boolean> => {
  const result = await dbPool.query(
    `
      UPDATE generation_worker_instances
      SET status = $2, last_heartbeat_at = now()
      WHERE instance_id = $1
      RETURNING instance_id
    `,
    [instanceId, status],
  );
  return result.rowCount === 1;
};

export const getGenerationWorkerFleetHealth = async (
  now = Date.now(),
): Promise<GenerationWorkerFleetHealth> => {
  const ttlMs = serverConfig.generationWorkerHeartbeatTtlMs;
  const result = await dbPool.query(
    `
      SELECT instance_id, status, started_at, last_heartbeat_at, build_version
      FROM generation_worker_instances
      WHERE last_heartbeat_at >= $1::timestamptz
      ORDER BY last_heartbeat_at DESC, instance_id
    `,
    [new Date(now - ttlMs).toISOString()],
  );
  return summarizeGenerationWorkerInstances(result.rows.map(mapWorkerInstance), now, ttlMs);
};

export const isGenerationWorkerInstanceReady = async (
  instanceId: string,
  now = Date.now(),
): Promise<boolean> => {
  const result = await dbPool.query(
    `
      SELECT instance_id, status, started_at, last_heartbeat_at, build_version
      FROM generation_worker_instances
      WHERE instance_id = $1
    `,
    [instanceId],
  );
  return summarizeGenerationWorkerInstances(
    result.rows.map(mapWorkerInstance),
    now,
    serverConfig.generationWorkerHeartbeatTtlMs,
  ).workerAvailable;
};

export const cleanupStaleGenerationWorkerInstances = async (
  now = Date.now(),
): Promise<number> => {
  const result = await dbPool.query(
    `DELETE FROM generation_worker_instances WHERE last_heartbeat_at < $1::timestamptz`,
    [new Date(now - GENERATION_WORKER_STALE_RETENTION_MS).toISOString()],
  );
  return result.rowCount || 0;
};
