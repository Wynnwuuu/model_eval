import assert from 'node:assert/strict';

import {
  GENERATION_WORKER_HEARTBEAT_TTL_MS,
  summarizeGenerationWorkerInstances,
  type GenerationWorkerInstanceRecord,
} from '../server/generation/generationWorkerRegistry.ts';

const now = Date.parse('2026-08-31T08:00:00.000Z');
const instance = (
  id: string,
  status: GenerationWorkerInstanceRecord['status'],
  ageMs: number,
  buildVersion = 'build-a',
): GenerationWorkerInstanceRecord => ({
  instanceId: id,
  status,
  startedAt: now - 60_000,
  lastHeartbeatAt: now - ageMs,
  buildVersion,
});

const healthy = summarizeGenerationWorkerInstances([
  instance('worker-a', 'ready', 1_000),
  instance('worker-b', 'ready', 4_000, 'build-b'),
], now);
assert.equal(healthy.workerAvailable, true);
assert.equal(healthy.activeWorkerCount, 2);
assert.equal(healthy.workerHeartbeatAgeMs, 1_000);
assert.deepEqual(healthy.workerVersions, ['build-a', 'build-b']);

const draining = summarizeGenerationWorkerInstances([
  instance('worker-a', 'draining', 1_000),
], now);
assert.equal(draining.workerAvailable, false, 'draining workers must stop batch admission');
assert.equal(draining.activeWorkerCount, 0);

const stale = summarizeGenerationWorkerInstances([
  instance('worker-a', 'ready', GENERATION_WORKER_HEARTBEAT_TTL_MS + 1),
], now);
assert.equal(stale.workerAvailable, false, 'stale ready heartbeats must not admit paid work');
assert.equal(stale.activeWorkerCount, 0);

const newestReadyHeartbeat = summarizeGenerationWorkerInstances([
  instance('worker-a', 'ready', 19_000),
  instance('worker-b', 'draining', 100),
], now);
assert.equal(newestReadyHeartbeat.workerHeartbeatAgeMs, 19_000,
  'reported heartbeat age must describe the newest ready worker, not a draining process');

console.log('Generation worker runtime tests passed.');
