import assert from 'node:assert/strict';
import { buildAbInsights, buildRankInsights } from '../src/analysisInsights';
import {
  calculateVoteDimensionSummaries,
  collectDimensionOptionCatalog,
  getDimensionEntries,
  getDimensionOptionEntries,
  itemMatchesDimensionOptions,
  parseDimensionOptionValues,
  toggleDimensionOption,
} from '../src/dimensionUtils';
import { buildPairwiseInsights } from '../src/scoringInsights';
import type { EvaluationItem, VoteRecord } from '../src/types';

assert.deepEqual(parseDimensionOptionValues('visual_edit, identity_consistency'), ['visual_edit', 'identity_consistency']);
assert.deepEqual(parseDimensionOptionValues('visual_edit，audio_edit；quality_repair|camera_spatial_edit'), [
  'visual_edit',
  'audio_edit',
  'quality_repair',
  'camera_spatial_edit',
]);
assert.deepEqual(parseDimensionOptionValues(['visual_edit', ' visual_edit ', 'identity_consistency']), [
  'visual_edit',
  'identity_consistency',
]);
assert.deepEqual(parseDimensionOptionValues('  '), []);

const mixed = { signal_tags: 'visual_edit, identity_consistency', 场景: '室外' };
assert.deepEqual(getDimensionEntries(mixed), [
  ['signal_tags', 'visual_edit, identity_consistency'],
  ['场景', '室外'],
]);
assert.deepEqual(getDimensionOptionEntries(mixed), [
  ['signal_tags', 'visual_edit'],
  ['signal_tags', 'identity_consistency'],
  ['场景', '室外'],
]);

assert.equal(itemMatchesDimensionOptions(mixed, { signal_tags: ['visual_edit'] }), true);
assert.equal(itemMatchesDimensionOptions(mixed, { signal_tags: ['visual_edit', 'identity_consistency'] }), true);
assert.equal(itemMatchesDimensionOptions(mixed, { signal_tags: ['visual_edit', 'audio_edit'] }), false);
assert.deepEqual(toggleDimensionOption({}, 'signal_tags', 'visual_edit'), { signal_tags: ['visual_edit'] });
assert.deepEqual(toggleDimensionOption({ signal_tags: ['visual_edit'] }, 'signal_tags', 'visual_edit'), {});

const catalog = collectDimensionOptionCatalog([
  { dimensionValues: { 场景: '室外', signal_tags: 'visual_edit, identity_consistency' } },
  { dimensionValues: { 场景: '室外', signal_tags: 'visual_edit' } },
]);
assert.deepEqual(catalog.map(group => group.key), ['signal_tags']);
assert.deepEqual(catalog[0].options, [
  { value: 'visual_edit', count: 2 },
  { value: 'identity_consistency', count: 1 },
]);

const items: Array<Partial<EvaluationItem> & { id: string }> = [
  { id: 'case-both', dimensionValues: { signal_tags: 'visual_edit, identity_consistency' } },
  { id: 'case-visual', dimensionValues: { signal_tags: 'visual_edit' } },
  { id: 'case-audio', dimensionValues: { signal_tags: 'audio_edit' } },
];
const abVotes: VoteRecord[] = [
  { itemId: 'case-both', vote: 'B', timestamp: 1, user: 'one' },
  { itemId: 'case-visual', vote: 'A', timestamp: 2, user: 'two' },
  { itemId: 'case-audio', vote: 'B', timestamp: 3, user: 'three' },
];
const abBundle = buildAbInsights({
  items,
  votes: abVotes,
  modelNames: { a: 'Model A', b: 'Model B' },
});
assert.equal(abBundle.summary.winnerLabel, 'Model B');
assert.deepEqual(
  [...abBundle.dimensions]
    .sort((left, right) => left.dimensionValue.localeCompare(right.dimensionValue))
    .map(item => [item.dimensionKey, item.dimensionValue, item.itemCount, item.winnerLabel]),
  [
    ['signal_tags', 'audio_edit', 1, 'Model B'],
    ['signal_tags', 'identity_consistency', 1, 'Model B'],
    ['signal_tags', 'visual_edit', 2, '平局'],
  ],
);

const visualItems = items.filter(item => itemMatchesDimensionOptions(item.dimensionValues, { signal_tags: ['visual_edit'] }));
const visualBundle = buildAbInsights({
  items: visualItems,
  votes: abVotes.filter(vote => visualItems.some(item => item.id === vote.itemId)),
  modelNames: { a: 'Model A', b: 'Model B' },
});
assert.equal(visualBundle.summary.itemCount, 2);
assert.equal(visualBundle.summary.winnerLabel, '平局');

const andItems = items.filter(item => itemMatchesDimensionOptions(item.dimensionValues, {
  signal_tags: ['visual_edit', 'identity_consistency'],
}));
const andBundle = buildAbInsights({
  items: andItems,
  votes: abVotes.filter(vote => andItems.some(item => item.id === vote.itemId)),
  modelNames: { a: 'Model A', b: 'Model B' },
});
assert.deepEqual(andItems.map(item => item.id), ['case-both']);
assert.equal(andBundle.summary.winnerLabel, 'Model B');
assert.equal(andBundle.cases[0].dimensionValues.signal_tags, 'visual_edit, identity_consistency');

const voteSummaries = calculateVoteDimensionSummaries([
  { itemId: 'case-both', prompt: '', votes: { A: 0, B: 1, Tie: 0 }, voters: ['one'], dimensionValues: { signal_tags: 'visual_edit, identity_consistency' } },
  { itemId: 'case-visual', prompt: '', votes: { A: 1, B: 0, Tie: 0 }, voters: ['two'], dimensionValues: { signal_tags: 'visual_edit' } },
]);
assert.deepEqual(
  voteSummaries.map(item => [item.dimensionValue, item.itemCount, item.votes.A, item.votes.B]),
  [
    ['visual_edit', 2, 1, 1],
    ['identity_consistency', 1, 0, 1],
  ],
);

const models = [
  { id: 'a', name: 'Model A' },
  { id: 'b', name: 'Model B' },
];
const rankVotes: VoteRecord[] = [
  {
    itemId: 'case-both',
    method: 'rank_order',
    timestamp: 1,
    user: 'one',
    ranking: [
      { modelId: 'b', modelName: 'Model B', rank: 1 },
      { modelId: 'a', modelName: 'Model A', rank: 2 },
    ],
  },
  {
    itemId: 'case-visual',
    method: 'rank_order',
    timestamp: 2,
    user: 'two',
    ranking: [
      { modelId: 'a', modelName: 'Model A', rank: 1 },
      { modelId: 'b', modelName: 'Model B', rank: 2 },
    ],
  },
];
const rankBundle = buildRankInsights({ items, votes: rankVotes, models });
assert.deepEqual(
  rankBundle.dimensions.map(item => [item.dimensionValue, item.itemCount]),
  [
    ['visual_edit', 2],
    ['identity_consistency', 1],
  ],
);

const pairwiseVotes: VoteRecord[] = [
  {
    itemId: 'pair-both',
    method: 'pairwise',
    vote: 'B',
    timestamp: 1,
    user: 'one',
    pairContext: {
      originalItemId: 'case-both',
      modelAId: 'a',
      modelAName: 'Model A',
      modelBId: 'b',
      modelBName: 'Model B',
    },
  },
  {
    itemId: 'pair-visual',
    method: 'pairwise',
    vote: 'A',
    timestamp: 2,
    user: 'two',
    pairContext: {
      originalItemId: 'case-visual',
      modelAId: 'a',
      modelAName: 'Model A',
      modelBId: 'b',
      modelBName: 'Model B',
    },
  },
];
const pairwiseBundle = buildPairwiseInsights({ items, votes: pairwiseVotes, models });
assert.deepEqual(
  pairwiseBundle.dimensions.map(item => [item.dimension, item.value, item.itemCount, item.battleCount]),
  [
    ['signal_tags', 'identity_consistency', 1, 1],
    ['signal_tags', 'visual_edit', 2, 2],
  ],
);

console.log('Dimension option insight checks passed.');
