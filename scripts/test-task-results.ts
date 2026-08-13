import assert from 'node:assert/strict';
import {
  buildTaskResultsPath,
  countUniqueReviewers,
  getLegacyTaskInsightsRedirect,
  getTaskResultTargetId,
  getTaskResultEntryState,
  getVoteReviewerKey,
  hasSubmittedTaskResults,
  isTaskVoteGroupForReviewer,
  withTaskVoteGroupReviewer,
} from '../src/taskResults';
import type { EvalTask, TaskVoteGroup } from '../src/types';
import { buildAbInsights, buildRankInsights } from '../src/analysisInsights';
import { buildPairwiseInsights, buildScoreInsights } from '../src/scoringInsights';

const task = (progress: Record<string, number>, status: EvalTask['status'] = 'active'): EvalTask => ({
  id: 'task 1',
  name: 'Task',
  datasetId: 'dataset',
  templateId: '',
  models: [],
  outputType: 'video',
  status,
  totalItems: 2,
  progress,
  createdAt: 1,
});

assert.equal(buildTaskResultsPath('task 1'), '/tasks/task%201/results');
assert.deepEqual(
  getLegacyTaskInsightsRedirect('/tasks/task%201/insights', new URLSearchParams('status=completed')),
  {
    taskId: 'task 1',
    redirectTo: '/tasks/task%201/results',
  },
);
assert.equal(getLegacyTaskInsightsRedirect('/projects/project-1/insights', new URLSearchParams()), null);
assert.equal(getTaskResultTargetId(['task-a'], ''), 'task-a');
assert.equal(getTaskResultTargetId(['task-a', 'task-b'], 'task-b'), 'task-b');
assert.equal(getTaskResultTargetId(['task-a', 'task-b'], 'task-outside'), 'task-a');
assert.equal(getTaskResultTargetId([], 'task-a'), undefined);

assert.equal(hasSubmittedTaskResults(task({})), false);
assert.equal(hasSubmittedTaskResults(task({ reviewer: 0 })), false);
assert.equal(hasSubmittedTaskResults(task({ reviewer: 1 })), true);
assert.equal(hasSubmittedTaskResults(task({ reviewer: 2 }, 'completed')), true);
assert.deepEqual(getTaskResultEntryState(task({ reviewer: 1 }, 'draft')), {
  visible: false,
  enabled: false,
  label: '尚无已提交结果',
});
assert.deepEqual(getTaskResultEntryState(task({}, 'active')), {
  visible: true,
  enabled: false,
  label: '尚无已提交结果',
});
assert.deepEqual(getTaskResultEntryState(task({ reviewer: 1 }, 'active')), {
  visible: true,
  enabled: true,
  label: '查看评测结果',
});
assert.deepEqual(getTaskResultEntryState(task({ reviewer: 1 }, 'completed')), {
  visible: true,
  enabled: true,
  label: '查看评测结果',
});

const sameNameGroups: TaskVoteGroup[] = [
  {
    user: 'Shared Reviewer',
    userId: 'reviewer-a',
    email: 'a@example.com',
    votes: [{ itemId: 'case-1', vote: 'A', timestamp: 1, user: 'Shared Reviewer' }],
  },
  {
    user: 'Shared Reviewer',
    userId: 'reviewer-b',
    email: 'b@example.com',
    votes: [{ itemId: 'case-1', vote: 'B', timestamp: 2, user: 'Shared Reviewer' }],
  },
];
const derivedVotes = sameNameGroups.flatMap(withTaskVoteGroupReviewer);
assert.equal(derivedVotes[0].user, 'Shared Reviewer', 'display names remain human-readable');
assert.equal(getVoteReviewerKey(derivedVotes[0]), 'reviewer-a');
assert.equal(getVoteReviewerKey(derivedVotes[1]), 'reviewer-b');
assert.equal(countUniqueReviewers(derivedVotes), 2, 'stable reviewer ids prevent same-name accounts from merging');
assert.equal(isTaskVoteGroupForReviewer(sameNameGroups[0], {
  id: 'reviewer-a',
  email: 'a@example.com',
  displayName: 'Shared Reviewer',
}), true);
assert.equal(isTaskVoteGroupForReviewer(sameNameGroups[1], {
  id: 'reviewer-a',
  email: 'a@example.com',
  displayName: 'Shared Reviewer',
}), false, 'matching display names do not overwrite a different stable reviewer');

const analysisItem = { id: 'case-1', modelA_Url: '', modelB_Url: '', type: 'video' as const };
assert.equal(buildAbInsights({
  items: [analysisItem],
  votes: derivedVotes,
  modelNames: { a: 'Model A', b: 'Model B' },
}).summary.voterCount, 2, 'A/B summaries count stable reviewer identities');

const rankVotes = derivedVotes.map((vote, index) => ({
  ...vote,
  ranking: [
    { modelId: 'model-a', modelName: 'Model A', rank: index === 0 ? 1 : 2 },
    { modelId: 'model-b', modelName: 'Model B', rank: index === 0 ? 2 : 1 },
  ],
}));
assert.equal(buildRankInsights({
  items: [analysisItem],
  votes: rankVotes,
  models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
}).summary.voterCount, 2, 'rank summaries count stable reviewer identities');

const scoreConfig = {
  method: 'direct_score' as const,
  dimensions: [{
    id: 'quality',
    name: 'Quality',
    description: 'Overall quality',
    type: 'star_rating' as const,
    weight: 1,
    aggregationRole: 'score' as const,
  }],
};
const scoreVotes = derivedVotes.map(vote => ({
  ...vote,
  method: 'direct_score' as const,
  rubricResponses: {
    'model-a': {
      modelId: 'model-a',
      modelName: 'Model A',
      scores: { quality: 4 },
    },
  },
}));
assert.equal(buildScoreInsights({
  items: [analysisItem],
  votes: scoreVotes,
  models: [{ id: 'model-a', name: 'Model A' }],
  config: scoreConfig,
}).summary.voterCount, 2, 'score summaries count stable reviewer identities');

const pairwiseVotes = derivedVotes.map(vote => ({
  ...vote,
  method: 'pairwise' as const,
  pairContext: {
    modelAId: 'model-a',
    modelAName: 'Model A',
    modelBId: 'model-b',
    modelBName: 'Model B',
    originalItemId: 'case-1',
  },
}));
assert.equal(buildPairwiseInsights({
  items: [analysisItem],
  votes: pairwiseVotes,
  models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
}).summary.voterCount, 2, 'pairwise summaries count stable reviewer identities');

console.log('Task result navigation and reviewer identity checks passed.');
