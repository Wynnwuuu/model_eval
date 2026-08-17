import assert from 'node:assert/strict';
import {
  MODEL_FEEDBACK_MAX_LENGTH,
  applyModelFeedbackToVote,
  buildModelFeedbackSummaries,
  getModelFeedbackDraft,
  getVoteModelFeedbackDetails,
  hasModelFeedbackChanged,
  resolveModelFeedbackCandidates,
} from '../src/modelFeedback';
import type { EvaluationItem, VoteRecord } from '../src/types';

const models = [
  { id: 'model-a', name: 'Current Model A' },
  { id: 'model-b', name: 'Current Model B' },
  { id: 'model-c', name: 'Current Model C' },
];

const abItem: EvaluationItem = {
  id: 'case-ab',
  modelA_Url: 'https://example.com/a.mp4',
  modelB_Url: 'https://example.com/b.mp4',
  type: 'video',
};

assert.deepEqual(
  resolveModelFeedbackCandidates(abItem, models, 'ab_preference').map(candidate => ({
    id: candidate.modelId,
    name: candidate.modelName,
    url: candidate.url,
  })),
  [
    { id: 'model-a', name: 'Current Model A', url: 'https://example.com/a.mp4' },
    { id: 'model-b', name: 'Current Model B', url: 'https://example.com/b.mp4' },
  ],
  'A/B feedback must use stable task model identities',
);

const pairItem: EvaluationItem = {
  ...abItem,
  id: 'case-pair',
  pairContext: {
    modelAId: 'model-c',
    modelAName: 'Pair Model C',
    modelBId: 'model-a',
    modelBName: 'Pair Model A',
  },
};
assert.deepEqual(
  resolveModelFeedbackCandidates(pairItem, models, 'pairwise').map(candidate => candidate.modelId),
  ['model-c', 'model-a'],
  'Pairwise feedback must follow the assigned pair rather than the first two task models',
);

const rankItem: EvaluationItem = {
  ...abItem,
  id: 'case-rank',
  modelOutputs: models.map((model, index) => ({
    modelId: model.id,
    modelName: `Snapshot ${model.name}`,
    url: `https://example.com/${index}.mp4`,
  })),
};
assert.deepEqual(
  resolveModelFeedbackCandidates(rankItem, models, 'rank_order').map(candidate => candidate.modelId),
  models.map(model => model.id),
);

const existingScoreVote: VoteRecord = {
  itemId: 'case-score',
  method: 'rubric_score',
  timestamp: 1,
  rubricResponses: {
    'model-a': {
      modelId: 'model-a',
      modelName: 'Old Model A',
      scores: { quality: 4 },
      answers: { defect: 'Minor flicker' },
      reason: 'Old note',
    },
  },
  reason: 'Old note',
};

const longNote = `  ${'x'.repeat(MODEL_FEEDBACK_MAX_LENGTH + 20)}  `;
const updatedScoreVote = applyModelFeedbackToVote(
  existingScoreVote,
  [{ modelId: 'model-a', modelName: 'Current Model A', url: '' }],
  { 'model-a': longNote },
);
assert.equal(updatedScoreVote.rubricResponses?.['model-a'].reason?.length, MODEL_FEEDBACK_MAX_LENGTH);
assert.deepEqual(updatedScoreVote.rubricResponses?.['model-a'].scores, { quality: 4 });
assert.deepEqual(updatedScoreVote.rubricResponses?.['model-a'].answers, { defect: 'Minor flicker' });
assert.equal(updatedScoreVote.rubricResponses?.['model-a'].modelName, 'Current Model A');
assert.equal(updatedScoreVote.reason, 'x'.repeat(MODEL_FEEDBACK_MAX_LENGTH));

const clearedScoreVote = applyModelFeedbackToVote(
  updatedScoreVote,
  [{ modelId: 'model-a', modelName: 'Current Model A', url: '' }],
  { 'model-a': '   ' },
);
assert.deepEqual(clearedScoreVote.rubricResponses?.['model-a'].scores, { quality: 4 });
assert.equal(clearedScoreVote.rubricResponses?.['model-a'].reason, undefined);
assert.equal(clearedScoreVote.reason, undefined);

const rankVote = applyModelFeedbackToVote(
  {
    itemId: 'case-rank',
    method: 'rank_order',
    timestamp: 2,
    user: 'reviewer-one',
    ranking: models.map((model, index) => ({ modelId: model.id, modelName: model.name, rank: index + 1 })),
  },
  resolveModelFeedbackCandidates(rankItem, models, 'rank_order'),
  { 'model-a': 'Great motion', 'model-b': '', 'model-c': 'Visible artifact' },
);
assert.equal(rankVote.reason, undefined, 'comparison and rank notes stay in per-model responses');
assert.deepEqual(Object.keys(rankVote.rubricResponses || {}).sort(), ['model-a', 'model-c']);
assert.deepEqual(getModelFeedbackDraft(rankVote), {
  'model-a': 'Great motion',
  'model-c': 'Visible artifact',
});
assert.equal(hasModelFeedbackChanged(rankVote, getModelFeedbackDraft(rankVote)), false);
assert.equal(hasModelFeedbackChanged(rankVote, { ...getModelFeedbackDraft(rankVote), 'model-a': 'Changed' }), true);

const scoreVote: VoteRecord = {
  itemId: 'case-score',
  method: 'direct_score',
  timestamp: 3,
  user: 'reviewer-two',
  rubricResponses: {
    'model-a': {
      modelId: 'model-a',
      modelName: 'Historical Model A',
      scores: { quality: 5 },
      reason: 'Legacy score reason',
    },
  },
};
const skippedVote: VoteRecord = {
  itemId: 'case-skipped',
  method: 'rank_order',
  choice: 'skipped',
  timestamp: 4,
  user: 'reviewer-three',
  rubricResponses: {
    'model-a': {
      modelId: 'model-a',
      modelName: 'Historical Model A',
      scores: {},
      reason: 'Must not be counted',
    },
  },
};

const summaries = buildModelFeedbackSummaries({ votes: [rankVote, scoreVote, skippedVote], models });
assert.deepEqual(summaries.map(summary => summary.modelId), models.map(model => model.id));
const modelASummary = summaries.find(summary => summary.modelId === 'model-a');
assert(modelASummary);
assert.equal(modelASummary.modelName, 'Current Model A', 'current task model name wins over vote snapshots');
assert.equal(modelASummary.feedbackCount, 2);
assert.equal(modelASummary.caseCount, 2);
assert.equal(modelASummary.reviewerCount, 2);
assert.deepEqual(modelASummary.entries.map(entry => entry.reason), ['Great motion', 'Legacy score reason']);
assert.equal(summaries.find(summary => summary.modelId === 'model-b')?.feedbackCount, 0);
assert.deepEqual(getVoteModelFeedbackDetails(rankVote), ['Current Model A：Great motion', 'Current Model C：Visible artifact']);

const mineOnly = buildModelFeedbackSummaries({ votes: [rankVote], models });
assert.equal(mineOnly.find(summary => summary.modelId === 'model-a')?.feedbackCount, 1);
assert.equal(mineOnly.find(summary => summary.modelId === 'model-a')?.reviewerCount, 1);

const repeatedPairCase = buildModelFeedbackSummaries({
  models,
  votes: [1, 2].map(index => ({
    itemId: `pair-assignment-${index}`,
    method: 'pairwise',
    timestamp: 10 + index,
    user: `pair-reviewer-${index}`,
    pairContext: { ...pairItem.pairContext!, originalItemId: 'pair-original-case' },
    rubricResponses: {
      'model-a': { modelId: 'model-a', modelName: 'Historical A', scores: {}, reason: `Pair note ${index}` },
    },
  })),
});
assert.equal(repeatedPairCase.find(summary => summary.modelId === 'model-a')?.caseCount, 1);

console.log('Model feedback regression checks passed.');
