import assert from 'node:assert/strict';

import {
  GENERATION_JOB_SORT_DIRECTIONS,
  GENERATION_JOB_SORT_FIELDS,
  GENERATION_JOB_STATUS_SORT_ORDER,
  isGenerationJobSortDirection,
  isGenerationJobSortField,
  nextGenerationJobSort,
} from '../src/features/generation/generationJobSorting.ts';
import { buildGenerationJobOrderBy } from '../server/generation/generationRepository.ts';

assert.deepEqual(GENERATION_JOB_SORT_FIELDS, [
  'dataset',
  'model',
  'status',
  'creator',
  'createdAt',
  'updatedAt',
]);
assert.deepEqual(GENERATION_JOB_SORT_DIRECTIONS, ['asc', 'desc']);
assert.deepEqual(GENERATION_JOB_STATUS_SORT_ORDER, [
  'running',
  'queued',
  'writeback_conflict',
  'failed',
  'partial',
  'completed',
  'cancelled',
  'draft',
]);

for (const field of GENERATION_JOB_SORT_FIELDS) assert.equal(isGenerationJobSortField(field), true);
for (const invalid of ['', 'caseCount', 'updated_at', null, 1]) assert.equal(isGenerationJobSortField(invalid), false);
for (const direction of GENERATION_JOB_SORT_DIRECTIONS) assert.equal(isGenerationJobSortDirection(direction), true);
for (const invalid of ['', 'ascending', 'DESC', null, 1]) assert.equal(isGenerationJobSortDirection(invalid), false);

const ascending = nextGenerationJobSort({}, 'createdAt');
assert.deepEqual(ascending, { sortBy: 'createdAt', sortDirection: 'asc' });
const descending = nextGenerationJobSort(ascending, 'createdAt');
assert.deepEqual(descending, { sortBy: 'createdAt', sortDirection: 'desc' });
assert.deepEqual(nextGenerationJobSort(descending, 'createdAt'), {});
assert.deepEqual(nextGenerationJobSort(descending, 'status'), { sortBy: 'status', sortDirection: 'asc' });

const defaultOrder = buildGenerationJobOrderBy();
assert.match(defaultOrder, /logical_status IN \('queued', 'running'\)/);
assert.match(defaultOrder, /family_updated_at DESC/);

const datasetOrder = buildGenerationJobOrderBy('dataset', 'asc');
assert.match(datasetOrder, /dataset_name/);
assert.match(datasetOrder, /target_column/);
assert.match(datasetOrder, /ASC NULLS LAST/);

const statusOrder = buildGenerationJobOrderBy('status', 'desc');
assert.ok(
  GENERATION_JOB_STATUS_SORT_ORDER.every((status, index) =>
    statusOrder.includes(`WHEN '${status}' THEN ${index}`)),
  'the SQL status order must come from the shared business-priority contract',
);
assert.match(statusOrder, /END DESC/);

assert.throws(
  () => buildGenerationJobOrderBy('created_at' as any, 'asc'),
  /must be provided together/,
);
assert.throws(
  () => buildGenerationJobOrderBy('createdAt', 'ascending' as any),
  /must be provided together/,
);

console.log('Generation task sorting contract tests passed.');
