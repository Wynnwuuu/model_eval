import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const repositorySource = await readFile(new URL('../server/datasets/datasetRepository.ts', import.meta.url), 'utf8');

assert.match(
  repositorySource,
  /const selectedVersionIds = datasetResult\.rows/,
  'dataset loading must explicitly select one materialized version per dataset',
);
assert.match(
  repositorySource,
  /WHERE version_id = ANY\(\$1\)/,
  'routine dataset reads must query only selected version IDs',
);
assert.doesNotMatch(
  repositorySource,
  /FROM dataset_items\s+WHERE dataset_id = ANY\(\$1\)/,
  'routine dataset reads must never load every historical item version',
);

console.log('Dataset runtime memory regression passed.');
