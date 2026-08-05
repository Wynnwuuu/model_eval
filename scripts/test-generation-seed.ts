import assert from 'node:assert/strict';

import {
  deriveGenerationSeed,
  generationSeedIssue,
  MAX_PORTABLE_GENERATION_SEED,
} from '../server/generation/generationPlanning.ts';

for (let index = 0; index < 1024; index += 1) {
  const seed = deriveGenerationSeed(`dataset:case-${index}:target:prompt`);
  assert.ok(Number.isInteger(seed));
  assert.ok(seed >= 0 && seed <= MAX_PORTABLE_GENERATION_SEED);
}

assert.equal(deriveGenerationSeed('same-input'), deriveGenerationSeed('same-input'));
assert.equal(generationSeedIssue(0), undefined);
assert.equal(generationSeedIssue(MAX_PORTABLE_GENERATION_SEED), undefined);
assert.equal(generationSeedIssue(MAX_PORTABLE_GENERATION_SEED + 1)?.code, 'INVALID_SEED');
assert.equal(generationSeedIssue(-1)?.code, 'INVALID_SEED');
assert.equal(generationSeedIssue(1.5)?.code, 'INVALID_SEED');
assert.equal(generationSeedIssue(Number.NaN)?.code, 'INVALID_SEED');

console.log('Generation seed tests passed.');