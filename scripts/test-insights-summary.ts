import assert from 'node:assert/strict';
import {
  buildAbTopSummary,
  buildPairwiseTopSummary,
  buildProjectTaskDigests,
  buildRankTopSummary,
  buildScoreTopSummary,
} from '../src/insightPresentation';
import { buildAbInsights, buildRankInsights } from '../src/analysisInsights';
import { buildPairwiseInsights, buildScoreInsights } from '../src/scoringInsights';
import type { EvalTask, TaskVoteGroup, VoteRecord } from '../src/types';

const makeTask = (patch: Partial<EvalTask>): EvalTask => ({
  id: 'task',
  name: 'Task',
  datasetId: 'dataset',
  templateId: '',
  evaluationConfig: { method: 'ab_preference' },
  models: [
    { id: 'a', name: 'Wan 3.0' },
    { id: 'b', name: 'Seedance 2.0 Pro' },
  ],
  outputType: 'video',
  totalItems: 2,
  status: 'active',
  createdAt: 1,
  ...patch,
});

const abTaskA = makeTask({ id: 'ab-a', name: 'AB A' });
const abTaskB = makeTask({ id: 'ab-b', name: 'AB B', status: 'completed' });
const scoreTask = makeTask({
  id: 'score',
  name: 'Score',
  evaluationConfig: {
    method: 'direct_score',
    dimensions: [{ id: 'quality', name: '整体质量', description: '', type: 'star_rating' }],
  },
});

const abGroups = new Map<string, TaskVoteGroup[]>([
  ['ab-a', [{
    user: 'reviewer-1',
    votes: [
      { itemId: 'case-1', vote: 'B', timestamp: 1 },
      { itemId: 'case-2', vote: 'Tie', timestamp: 2 },
    ],
  }]],
  ['ab-b', [{
    user: 'reviewer-2',
    votes: [
      { itemId: 'case-1', vote: 'B', timestamp: 3 },
      { itemId: 'case-2', vote: 'A', timestamp: 4 },
    ],
  }]],
  ['score', [{
    user: 'reviewer-1',
    votes: [{
      itemId: 'case-1',
      method: 'direct_score',
      timestamp: 5,
      rubricResponses: {
        a: { modelId: 'a', modelName: 'Wan 3.0', scores: { quality: 3 } },
        b: { modelId: 'b', modelName: 'Seedance 2.0 Pro', scores: { quality: 5 } },
      },
    }],
  }]],
]);

const digests = buildProjectTaskDigests({
  tasks: [abTaskA, abTaskB, scoreTask],
  voteGroupsByTask: abGroups,
});

assert.equal(digests.length, 3, 'each evaluation material must keep an independent digest');
const abADigest = digests.find(digest => digest.taskId === 'ab-a');
const abBDigest = digests.find(digest => digest.taskId === 'ab-b');
const scoreDigest = digests.find(digest => digest.taskId === 'score');
assert(abADigest);
assert(abBDigest);
assert(scoreDigest);
assert.equal(abADigest.validRecordCount, 2);
assert.equal(abADigest.evaluatedItemCount, 2);
assert.equal(abADigest.phase, 'in-progress');
assert.equal(abBDigest.validRecordCount, 2, 'votes from another task must never be merged');
assert.equal(abBDigest.phase, 'completed');
assert.equal(scoreDigest.method, 'direct_score');
assert.equal(scoreDigest.leaderLabel, 'Seedance 2.0 Pro');

const abVotes: VoteRecord[] = [
  { itemId: 'case-1', vote: 'B', timestamp: 1, user: 'one' },
  { itemId: 'case-1', vote: 'B', timestamp: 2, user: 'two' },
  { itemId: 'case-2', vote: 'A', timestamp: 3, user: 'one' },
  { itemId: 'case-2', vote: 'Tie', timestamp: 4, user: 'two' },
];
const abBundle = buildAbInsights({
  items: [{ id: 'case-1' }, { id: 'case-2' }],
  votes: abVotes,
  modelNames: { a: 'Wan 3.0', b: 'Seedance 2.0 Pro' },
});
const abTop = buildAbTopSummary(abBundle, 2);
assert.match(abTop.headline, /Seedance 2.0 Pro/);
assert.equal(abTop.metrics.length, 4);
assert.equal(abTop.distribution?.segments.reduce((sum, segment) => sum + segment.value, 0), 4);
assert(abTop.metrics.every(metric => metric.detail.calculation && metric.detail.inputs.length > 0));

const rankVotes: VoteRecord[] = [{
  itemId: 'case-1',
  method: 'rank_order',
  timestamp: 1,
  user: 'one',
  ranking: [
    { modelId: 'b', modelName: 'Seedance 2.0 Pro', rank: 1 },
    { modelId: 'a', modelName: 'Wan 3.0', rank: 2 },
  ],
}];
const rankTop = buildRankTopSummary(buildRankInsights({
  items: [{ id: 'case-1' }],
  votes: rankVotes,
  models: abTaskA.models,
}), 2);
assert.match(rankTop.headline, /Seedance 2.0 Pro/);
assert.equal(rankTop.metrics.length, 4);

const scoreVotes = abGroups.get('score')![0].votes;
const scoreBundle = buildScoreInsights({
  items: [{ id: 'case-1' }],
  votes: scoreVotes,
  models: scoreTask.models,
  config: scoreTask.evaluationConfig!,
});
const scoreTop = buildScoreTopSummary(scoreBundle, 2);
assert.match(scoreTop.headline, /Seedance 2.0 Pro/);
assert.equal(scoreTop.metrics.length, 4);

const pairwiseVotes: VoteRecord[] = [{
  itemId: 'case-1',
  method: 'pairwise',
  vote: 'A',
  timestamp: 1,
  user: 'one',
  pairContext: {
    modelAId: 'a',
    modelAName: 'Wan 3.0',
    modelBId: 'b',
    modelBName: 'Seedance 2.0 Pro',
  },
}];
const pairwiseTop = buildPairwiseTopSummary(buildPairwiseInsights({
  items: [{ id: 'case-1' }],
  votes: pairwiseVotes,
  models: abTaskA.models,
}), 2);
assert.equal(pairwiseTop.metrics.length, 4);
assert(pairwiseTop.metrics.some(metric => metric.id === 'pair-coverage'));

console.log('Insight summary regression checks passed.');
