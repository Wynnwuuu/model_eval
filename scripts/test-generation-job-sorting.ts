import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { closeDatabase, dbPool } from '../server/db/client.ts';
import { listGenerationJobs } from '../server/generation/generationRepository.ts';

const suffix = randomUUID();
const organizationId = `generation-sort-org-${suffix}`;
const datasetIds = {
  alpha: `generation-sort-dataset-alpha-${suffix}`,
  zulu: `generation-sort-dataset-zulu-${suffix}`,
};
const userIds = {
  alice: `generation-sort-user-alice-${suffix}`,
  zoe: `generation-sort-user-zoe-${suffix}`,
};
const baseTime = Date.UTC(2026, 0, 1, 0, 0, 0);

type SortDirection = 'asc' | 'desc';

const listSorted = (sortBy: string, sortDirection: SortDirection, page = 1, limit = 100) =>
  listGenerationJobs({
    organizationId,
    sortBy,
    sortDirection,
    page,
    limit,
  } as any);

const assertMonotonic = (
  values: number[],
  direction: SortDirection,
  message: string,
) => {
  for (let index = 1; index < values.length; index += 1) {
    if (direction === 'asc') {
      assert.ok(values[index - 1] <= values[index], message);
    } else {
      assert.ok(values[index - 1] >= values[index], message);
    }
  }
};

const statusPriority = new Map([
  ['running', 0],
  ['queued', 1],
  ['writeback_conflict', 2],
  ['failed', 3],
  ['partial', 4],
  ['completed', 5],
  ['cancelled', 6],
  ['draft', 7],
]);

const roots = [
  { id: `generation-sort-01-${suffix}`, datasetId: datasetIds.zulu, status: 'queued', model: 'Zulu Model', target: 'result_z', creator: userIds.zoe },
  { id: `generation-sort-02-${suffix}`, datasetId: datasetIds.alpha, status: 'running', model: 'Alpha Model', target: 'result_z', creator: userIds.alice },
  { id: `generation-sort-03-${suffix}`, datasetId: datasetIds.alpha, status: 'writeback_conflict', model: 'Zulu Model', target: 'result_a', creator: userIds.zoe, writebackStatus: 'conflict' },
  { id: `generation-sort-04-${suffix}`, datasetId: datasetIds.zulu, status: 'failed', model: 'Alpha Model', target: 'result_a', creator: userIds.alice },
  { id: `generation-sort-05-${suffix}`, datasetId: datasetIds.alpha, status: 'partial', model: 'Zulu Model', target: 'result_m', creator: userIds.zoe },
  { id: `generation-sort-06-${suffix}`, datasetId: datasetIds.zulu, status: 'completed', model: 'Alpha Model', target: 'result_m', creator: userIds.alice },
  { id: `generation-sort-07-${suffix}`, datasetId: datasetIds.alpha, status: 'cancelled', model: 'Zulu Model', target: 'result_n', creator: userIds.zoe },
  { id: `generation-sort-08-${suffix}`, datasetId: datasetIds.zulu, status: 'draft', model: '', target: 'result_n', creator: null },
  { id: `generation-sort-tie-a-${suffix}`, datasetId: datasetIds.alpha, status: 'draft', model: 'Alpha Model', target: 'result_tie', creator: userIds.alice, tied: true },
  { id: `generation-sort-tie-b-${suffix}`, datasetId: datasetIds.alpha, status: 'draft', model: 'Alpha Model', target: 'result_tie', creator: userIds.alice, tied: true },
];

try {
  await dbPool.query(
    `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
    [organizationId, 'Generation sorting test organization'],
  );
  await dbPool.query(
    `INSERT INTO users (id, email, display_name) VALUES
      ($1, $2, 'Alice Sorter'),
      ($3, $4, 'Zoe Sorter')`,
    [
      userIds.alice,
      `generation-sort-alice-${suffix}@example.com`,
      userIds.zoe,
      `generation-sort-zoe-${suffix}@example.com`,
    ],
  );
  await dbPool.query(
    `INSERT INTO datasets (id, organization_id, name) VALUES
      ($1, $3, 'Alpha Dataset'),
      ($2, $3, 'Zulu Dataset')`,
    [datasetIds.alpha, datasetIds.zulu, organizationId],
  );

  for (const [index, root] of roots.entries()) {
    const createdAt = root.tied ? baseTime + 90_000 : baseTime + index * 10_000;
    const updatedAt = root.tied ? baseTime + 90_000 : baseTime + (roots.length - index) * 11_000;
    await dbPool.query(
      `INSERT INTO generation_jobs (
        id, dataset_id, status, model_config_json, target_column, created_by,
        writeback_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7,
        to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0)
      )`,
      [
        root.id,
        root.datasetId,
        root.status,
        JSON.stringify(root.model ? { modelName: root.model.toLowerCase().replaceAll(' ', '-'), displayName: root.model } : {}),
        root.target,
        root.creator,
        root.writebackStatus || 'pending',
        createdAt,
        updatedAt,
      ],
    );
  }

  const retryId = `generation-sort-retry-${suffix}`;
  await dbPool.query(
    `INSERT INTO generation_jobs (
      id, dataset_id, status, model_config_json, target_column, created_by,
      retry_of_job_id, created_at, updated_at
    ) VALUES (
      $1, $2, 'completed', $3::jsonb, 'result_z', $4, $5,
      to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0)
    )`,
    [
      retryId,
      datasetIds.zulu,
      JSON.stringify({ modelName: 'zulu-model', displayName: 'Zulu Model' }),
      userIds.zoe,
      roots[0].id,
      baseTime + 120_000,
      baseTime + 300_000,
    ],
  );

  const defaultOrder = await listGenerationJobs({ organizationId, limit: 100 });
  assert.equal(defaultOrder.total, roots.length, 'retry children must remain collapsed into their root task');
  assert.deepEqual(
    new Set(defaultOrder.jobs.slice(0, 2).map(job => job.status)),
    new Set(['running', 'queued']),
    'the unsorted view must preserve active-task priority',
  );
  const retriedRoot = defaultOrder.jobs.find(job => job.id === roots[0].id);
  assert.equal(retriedRoot?.physicalBatchCount, 2);
  assert.equal(retriedRoot?.updatedAt, baseTime + 300_000);
  assert.ok(!defaultOrder.jobs.some(job => job.id === retryId));

  for (const direction of ['asc', 'desc'] as const) {
    const created = await listSorted('createdAt', direction);
    assertMonotonic(created.jobs.map(job => job.createdAt), direction, `createdAt ${direction} must be monotonic`);

    const updated = await listSorted('updatedAt', direction);
    assertMonotonic(updated.jobs.map(job => job.updatedAt), direction, `updatedAt ${direction} must be monotonic`);

    const statuses = await listSorted('status', direction);
    assertMonotonic(
      statuses.jobs.map(job => statusPriority.get(job.status) ?? Number.MAX_SAFE_INTEGER),
      direction,
      `status ${direction} must use the documented operational priority`,
    );

    const datasets = await listSorted('dataset', direction);
    const datasetKeys = datasets.jobs.map(job => `${job.datasetName}\u0000${job.targetColumn}`.toLowerCase());
    assert.deepEqual(datasetKeys, [...datasetKeys].sort((left, right) => direction === 'asc'
      ? left.localeCompare(right)
      : right.localeCompare(left)));

    const models = await listSorted('model', direction);
    assert.equal(models.jobs.at(-1)?.id, roots[7].id, 'blank model names must sort last in both directions');
    const modelKeys = models.jobs.slice(0, -1).map(job => String(job.modelConfig.displayName || job.modelConfig.modelName).toLowerCase());
    assert.deepEqual(modelKeys, [...modelKeys].sort((left, right) => direction === 'asc'
      ? left.localeCompare(right)
      : right.localeCompare(left)));

    const creators = await listSorted('creator', direction);
    assert.equal(creators.jobs.at(-1)?.id, roots[7].id, 'blank creators must sort last in both directions');
    const creatorKeys = creators.jobs.slice(0, -1).map(job => String(job.createdBy).toLowerCase());
    assert.deepEqual(creatorKeys, [...creatorKeys].sort((left, right) => direction === 'asc'
      ? left.localeCompare(right)
      : right.localeCompare(left)));
  }

  const fullCreatedOrder = await listSorted('createdAt', 'asc');
  const firstCreatedPage = await listSorted('createdAt', 'asc', 1, 3);
  const secondCreatedPage = await listSorted('createdAt', 'asc', 2, 3);
  assert.deepEqual(firstCreatedPage.jobs.map(job => job.id), fullCreatedOrder.jobs.slice(0, 3).map(job => job.id));
  assert.deepEqual(secondCreatedPage.jobs.map(job => job.id), fullCreatedOrder.jobs.slice(3, 6).map(job => job.id));

  const tiedJobs = fullCreatedOrder.jobs.filter(job => job.id.includes('generation-sort-tie-'));
  assert.deepEqual(
    tiedJobs.map(job => job.id),
    [roots[9].id, roots[8].id],
    'identical sort values must use task id descending as a deterministic tie-break',
  );

  console.log('Generation job sorting integration tests passed.');
} finally {
  await dbPool.query('DELETE FROM datasets WHERE organization_id = $1', [organizationId]).catch(() => undefined);
  await dbPool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[userIds.alice, userIds.zoe]]).catch(() => undefined);
  await dbPool.query('DELETE FROM organizations WHERE id = $1', [organizationId]).catch(() => undefined);
  await closeDatabase();
}
