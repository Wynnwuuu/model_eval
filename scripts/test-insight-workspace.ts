import assert from 'node:assert/strict';
import { buildAbInsights, buildRankInsights } from '../src/analysisInsights';
import { buildCaseEvidenceViewModels } from '../src/caseEvidence';
import { insightMediaLoadScheduler, MediaLoadScheduler } from '../src/mediaLoadScheduler';
import { LatestRequestGate } from '../src/latestRequestGate';
import { buildPairwiseInsights, buildScoreInsights } from '../src/scoringInsights';
import type { EvaluationConfig, EvaluationItem, VoteRecord } from '../src/types';

const scheduler = new MediaLoadScheduler(2);
const started: string[] = [];
const cancelA = scheduler.enqueue('a', () => started.push('a'));
scheduler.enqueue('b', () => started.push('b'));
scheduler.enqueue('c', () => started.push('c'));

assert.deepEqual(started, ['a', 'b'], 'media initialization must respect the concurrency limit');
assert.deepEqual(scheduler.getSnapshot(), { active: 2, queued: 1, limit: 2 });
scheduler.complete('a');
assert.deepEqual(started, ['a', 'b', 'c'], 'completing one request must immediately start the next visible media');
cancelA();
scheduler.complete('b');
scheduler.complete('c');
assert.deepEqual(scheduler.getSnapshot(), { active: 0, queued: 0, limit: 2 });
assert.equal(insightMediaLoadScheduler.getSnapshot().limit, 6, 'the shared insight media scheduler must cap initialization at six');

const requestGate = new LatestRequestGate();
const staleRequest = requestGate.begin();
const latestRequest = requestGate.begin();
assert.equal(staleRequest.controller.signal.aborted, true, 'starting a new result request must abort the previous request');
assert.equal(requestGate.isCurrent(staleRequest), false, 'an obsolete response must not be allowed to update the page');
assert.equal(requestGate.isCurrent(latestRequest), true);
requestGate.finish(latestRequest);
assert.equal(requestGate.isCurrent(latestRequest), false, 'a completed request must leave the active slot');

const models = [
  { id: 'a', name: '模型 A' },
  { id: 'b', name: '模型 B' },
];
const items: EvaluationItem[] = [
  {
    id: 'case-later',
    itemOrder: 2,
    prompt: '后一个 case',
    dimensionValues: { 场景: '室外' },
    modelA_Url: 'https://example.com/a-later.mp4',
    modelB_Url: 'https://example.com/b-later.mp4',
    modelOutputs: models.map(model => ({ modelId: model.id, modelName: model.name, url: `https://example.com/${model.id}-later.mp4` })),
    type: 'video',
  },
  {
    id: 'case-first',
    itemOrder: 1,
    prompt: '第一个 case',
    dimensionValues: { 场景: '室内' },
    modelA_Url: 'https://example.com/a-first.mp4',
    modelB_Url: 'https://example.com/b-first.mp4',
    modelOutputs: models.map(model => ({ modelId: model.id, modelName: model.name, url: `https://example.com/${model.id}-first.mp4` })),
    type: 'video',
  },
];

const abVotes: VoteRecord[] = [
  { itemId: 'case-first', vote: 'A', timestamp: 1, user: '评委一', reviewerKey: 'reviewer-1' },
  { itemId: 'case-later', vote: 'B', timestamp: 2, user: '评委二', reviewerKey: 'reviewer-2' },
];
const abEvidence = buildCaseEvidenceViewModels({
  bundle: buildAbInsights({ items, votes: abVotes, modelNames: { a: '模型 A', b: '模型 B' } }),
  items,
  votes: abVotes,
});
assert.deepEqual(abEvidence.map(item => item.itemId), ['case-first', 'case-later'], 'case evidence must follow the material order');
assert.equal(abEvidence[0].outputs.length, 2);
assert.equal(abEvidence[0].reviews[0].reviewer, '评委一');

const arrayOrderedItems = items.map(item => ({ ...item, itemOrder: undefined }));
const arrayOrderedEvidence = buildCaseEvidenceViewModels({
  bundle: buildAbInsights({ items: arrayOrderedItems, votes: abVotes, modelNames: { a: '模型 A', b: '模型 B' } }),
  items: arrayOrderedItems,
  votes: abVotes,
});
assert.deepEqual(arrayOrderedEvidence.map(item => item.itemId), ['case-later', 'case-first'], 'items without itemOrder must keep their source array order');

const rankVotes: VoteRecord[] = [{
  itemId: 'case-first',
  method: 'rank_order',
  timestamp: 3,
  user: '评委一',
  reviewerKey: 'reviewer-1',
  ranking: [
    { modelId: 'b', modelName: '模型 B', rank: 1 },
    { modelId: 'a', modelName: '模型 A', rank: 2 },
  ],
}];
const rankEvidence = buildCaseEvidenceViewModels({
  bundle: buildRankInsights({ items, votes: rankVotes, models }),
  items,
  votes: rankVotes,
});
assert.equal(rankEvidence[0].outputs[0].modelName, '模型 B', 'Arena-rank outputs must follow consensus order');
assert.match(rankEvidence[0].reviews[0].summary, /模型 B/);

const scoreConfig: EvaluationConfig = {
  method: 'direct_score',
  dimensions: [{ id: 'quality', name: '整体质量', description: '', type: 'star_rating' }],
};
const scoreVotes: VoteRecord[] = [{
  itemId: 'case-first',
  method: 'direct_score',
  timestamp: 4,
  user: '评委一',
  reviewerKey: 'reviewer-1',
  rubricResponses: {
    a: { modelId: 'a', modelName: '模型 A', scores: { quality: 4 }, reason: '稳定' },
    b: { modelId: 'b', modelName: '模型 B', scores: { quality: 5 }, reason: '细节更好' },
  },
}];
const scoreEvidence = buildCaseEvidenceViewModels({
  bundle: buildScoreInsights({ items, votes: scoreVotes, models, config: scoreConfig }),
  items,
  votes: scoreVotes,
});
assert.equal(scoreEvidence[0].method, 'score');
assert.match(scoreEvidence[0].reviews[0].details.join(' '), /细节更好/);

const pairwiseVotes: VoteRecord[] = [{
  itemId: 'case-first',
  method: 'pairwise',
  vote: 'B',
  timestamp: 5,
  user: '评委二',
  reviewerKey: 'reviewer-2',
  pairContext: {
    modelAId: 'a',
    modelAName: '模型 A',
    modelBId: 'b',
    modelBName: '模型 B',
  } as any,
}];
const pairwiseEvidence = buildCaseEvidenceViewModels({
  bundle: buildPairwiseInsights({ items, votes: pairwiseVotes, models }),
  items,
  votes: pairwiseVotes,
});
assert.equal(pairwiseEvidence[0].method, 'pairwise');
assert.equal(pairwiseEvidence[0].reviews[0].summary, '选择 模型 B');

console.log('Unified insight workspace regression checks passed.');
