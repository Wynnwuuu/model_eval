import assert from 'node:assert/strict';
import {
  assignArenaBattle,
  buildArenaReviewerQueue,
  getArenaPairKey,
  normalizeArenaSamplingConfig,
} from '../src/arenaSampling';
import { calculateBradleyTerry } from '../src/bradleyTerry';
import { getDefaultEvaluationConfig, normalizeEvaluationConfig } from '../src/evaluationMethods';
import { buildPairwiseBattleCsv, buildPairwiseInsights } from '../src/scoringInsights';
import type { EvalTask, EvaluationItem, VoteRecord } from '../src/types';

assert.equal(getDefaultEvaluationConfig('pairwise').pairwiseMode, 'arena_sampled', 'new pairwise tasks should recommend Arena');
assert.equal(
  normalizeArenaSamplingConfig(getDefaultEvaluationConfig('pairwise').arenaSampling, 100, 12).suggestedBattlesPerReviewer,
  24,
  'untouched draft configuration should resolve the default target from the model count'
);
assert.equal(normalizeEvaluationConfig({
  id: 'legacy-pairwise',
  name: 'Legacy',
  datasetId: 'dataset',
  templateId: '',
  models: [],
  outputType: 'video',
  status: 'active',
  createdAt: 1,
  evaluationConfig: { method: 'pairwise' },
} as EvalTask).pairwiseMode, 'all_pairs', 'persisted pairwise tasks without a mode must retain legacy all-pairs semantics');

const models = Array.from({ length: 5 }, (_, index) => ({
  id: `model-${index}`,
  name: `Model ${index}`,
}));

const makeItem = (index: number, missingModelId?: string): EvaluationItem => ({
  id: `case-${index}`,
  modelA_Url: `https://example.com/${index}-a.mp4`,
  modelB_Url: `https://example.com/${index}-b.mp4`,
  modelOutputs: models
    .filter(model => model.id !== missingModelId)
    .map(model => ({
      modelId: model.id,
      modelName: model.name,
      url: `https://example.com/${index}-${model.id}.mp4`,
    })),
  prompt: `Prompt ${index}`,
  type: 'video',
});

const items = Array.from({ length: 80 }, (_, index) => makeItem(index));
const config = {
  suggestedBattlesPerReviewer: 30,
  warmupBattlesPerModel: 3,
  explorationRate: 0.15,
  schedulerVersion: 'arena_v1',
  seed: 'test-seed',
};

const queueA = buildArenaReviewerQueue({
  taskId: 'task-1',
  reviewerId: 'reviewer-1',
  items,
  existingVotes: [],
  config,
});
const queueB = buildArenaReviewerQueue({
  taskId: 'task-1',
  reviewerId: 'reviewer-1',
  items,
  existingVotes: [],
  config,
});
assert.deepEqual(queueA.map(item => item.id), queueB.map(item => item.id), 'case queue must be deterministic');
assert.equal(new Set(queueA.map(item => item.id)).size, queueA.length, 'a reviewer must not repeat a case');

const missingItem = makeItem(999, 'model-4');
const missingAssignment = assignArenaBattle({
  taskId: 'task-1',
  reviewerId: 'reviewer-1',
  item: missingItem,
  models,
  votes: [],
  config,
});
assert(missingAssignment, 'an item with at least two outputs remains eligible');
assert.notEqual(missingAssignment.modelAId, 'model-4');
assert.notEqual(missingAssignment.modelBId, 'model-4');

const simulatedVotes: VoteRecord[] = [];
for (const item of queueA.slice(0, 24)) {
  const assignment = assignArenaBattle({
    taskId: 'task-1',
    reviewerId: 'reviewer-1',
    item,
    models,
    votes: simulatedVotes,
    config,
  });
  assert(assignment, 'eligible item should receive an assignment');
  simulatedVotes.push({
    itemId: item.id,
    method: 'pairwise',
    vote: 'A',
    choice: 'A',
    timestamp: Date.now() + simulatedVotes.length,
    user: 'reviewer-1',
    pairContext: assignment.pairContext,
  });
}

const coverage = calculateBradleyTerry(simulatedVotes, models);
assert.equal(coverage.connected, true, 'coverage phase should connect every model');
assert(Math.max(...coverage.models.map(model => model.battles)) - Math.min(...coverage.models.map(model => model.battles)) <= 4,
  'coverage phase should keep model exposure reasonably balanced');

const runSchedulerScaleCheck = (modelCount: 3 | 5 | 10) => {
  const scenarioModels = Array.from({ length: modelCount }, (_, index) => ({
    id: `scale-${modelCount}-model-${index}`,
    name: `Scale ${modelCount} Model ${index}`,
  }));
  const scenarioItems: EvaluationItem[] = Array.from({ length: 80 }, (_, caseIndex) => ({
    id: `scale-${modelCount}-case-${caseIndex}`,
    modelA_Url: `https://example.com/scale-${modelCount}/${caseIndex}/${scenarioModels[0].id}.mp4`,
    modelB_Url: `https://example.com/scale-${modelCount}/${caseIndex}/${scenarioModels[1].id}.mp4`,
    prompt: `Scale ${modelCount} prompt ${caseIndex}`,
    type: 'video',
    modelOutputs: scenarioModels.map(model => ({
      modelId: model.id,
      modelName: model.name,
      url: `https://example.com/scale-${modelCount}/${caseIndex}/${model.id}.mp4`,
    })),
  }));
  const scenarioConfig = normalizeArenaSamplingConfig({
    seed: `scale-${modelCount}`,
    warmupBattlesPerModel: 3,
    explorationRate: 0.15,
  }, scenarioItems.length, scenarioModels.length);
  assert.equal(
    scenarioConfig.suggestedBattlesPerReviewer,
    Math.min(scenarioItems.length, Math.max(20, 2 * modelCount)),
    `${modelCount}-model scenario should use the documented default soft target`
  );

  const scenarioQueue = buildArenaReviewerQueue({
    taskId: `scale-${modelCount}-task`,
    reviewerId: `scale-${modelCount}-reviewer`,
    items: scenarioItems,
    existingVotes: [],
    config: scenarioConfig,
    models: scenarioModels,
  });
  const scenarioVotes: VoteRecord[] = [];
  const simulationLength = Math.max(30, modelCount * 4);
  for (const item of scenarioQueue.slice(0, simulationLength)) {
    const assignment = assignArenaBattle({
      taskId: `scale-${modelCount}-task`,
      reviewerId: `scale-${modelCount}-reviewer`,
      item,
      models: scenarioModels,
      votes: scenarioVotes,
      config: scenarioConfig,
    });
    assert(assignment, `${modelCount}-model scenario should always find an eligible pair`);
    const outcome = scenarioVotes.length % 5 === 0 ? 'Tie' : scenarioVotes.length % 2 === 0 ? 'A' : 'B';
    scenarioVotes.push({
      itemId: item.id,
      method: 'pairwise',
      vote: outcome,
      choice: outcome,
      timestamp: scenarioVotes.length,
      user: `scale-${modelCount}-reviewer`,
      pairContext: assignment.pairContext,
    });
  }

  assert.equal(
    new Set(scenarioVotes.map(vote => vote.pairContext?.originalItemId || vote.itemId)).size,
    scenarioVotes.length,
    `${modelCount}-model scenario must not repeat a case for one reviewer`
  );
  const scenarioResult = calculateBradleyTerry(scenarioVotes, scenarioModels);
  assert.equal(scenarioResult.connected, true, `${modelCount}-model coverage graph should be connected`);
  assert(
    scenarioResult.models.every(model => model.battles >= scenarioConfig.warmupBattlesPerModel),
    `${modelCount}-model coverage should warm up every model`
  );
  assert(
    scenarioVotes.some(vote => vote.pairContext?.samplingPhase === 'adaptive'),
    `${modelCount}-model scheduler should enter the adaptive phase after coverage`
  );
  const exposures = scenarioResult.models.map(model => model.battles);
  assert(
    Math.max(...exposures) - Math.min(...exposures) <= Math.max(6, Math.ceil(simulationLength / modelCount)),
    `${modelCount}-model exposure should remain reasonably balanced`
  );

  const sharedCasePairs = new Set(
    Array.from({ length: 32 }, (_, reviewerIndex) => assignArenaBattle({
      taskId: `scale-${modelCount}-shared-case`,
      reviewerId: `shared-reviewer-${reviewerIndex}`,
      item: scenarioItems[0],
      models: scenarioModels,
      votes: [],
      config: scenarioConfig,
    })?.pairContext.pairId).filter(Boolean)
  );
  assert(
    modelCount === 3 ? sharedCasePairs.size >= 2 : sharedCasePairs.size >= 3,
    `${modelCount}-model shared case should cover different pairs across reviewers`
  );
};

([3, 5, 10] as const).forEach(runSchedulerScaleCheck);

const displayBalance = Array.from({ length: 100 }, (_, index) => {
  const assignment = assignArenaBattle({
    taskId: 'task-display',
    reviewerId: `reviewer-${index}`,
    item: makeItem(index),
    models: models.slice(0, 2),
    votes: [],
    config,
  });
  assert(assignment);
  return assignment.leftModelId;
});
const leftACount = displayBalance.filter(id => id === 'model-0').length;
assert(leftACount >= 35 && leftACount <= 65, 'left/right placement should be balanced across stable seeds');

const strengthVotes: VoteRecord[] = [];
const addBattles = (left: number, right: number, leftWins: number, rightWins: number, ties = 0) => {
  const pairModels = [models[left], models[right]];
  const pairId = getArenaPairKey(pairModels[0].id, pairModels[1].id);
  const outcomes: Array<'A' | 'B' | 'Tie'> = [
    ...Array(leftWins).fill('A'),
    ...Array(rightWins).fill('B'),
    ...Array(ties).fill('Tie'),
  ];
  outcomes.forEach((outcome, index) => strengthVotes.push({
    itemId: `${pairId}-${index}`,
    method: 'pairwise',
    vote: outcome,
    choice: outcome,
    timestamp: index,
    pairContext: {
      pairId,
      modelAId: pairModels[0].id,
      modelAName: pairModels[0].name,
      modelBId: pairModels[1].id,
      modelBName: pairModels[1].name,
    },
  }));
};

addBattles(0, 1, 18, 2, 2);
addBattles(1, 2, 16, 4, 2);
addBattles(2, 3, 14, 6, 2);
addBattles(3, 4, 12, 8, 2);
addBattles(0, 4, 19, 1, 2);

const ratings = calculateBradleyTerry(strengthVotes, models);
assert.equal(ratings.connected, true);
assert.equal(ratings.models[0].modelId, 'model-0', 'strongest synthetic model should lead');
assert(ratings.models.every(model => Number.isFinite(model.ratingLower) && Number.isFinite(model.ratingUpper)));

const oneBattleRatings = calculateBradleyTerry([{
  itemId: 'one-battle',
  method: 'pairwise',
  vote: 'A',
  choice: 'A',
  timestamp: 1,
  pairContext: {
    modelAId: 'model-0',
    modelAName: 'Model 0',
    modelBId: 'model-1',
    modelBName: 'Model 1',
  },
}], models.slice(0, 2));
assert(
  oneBattleRatings.models.every(model => model.rating > 400 && model.rating < 1600),
  'weak regularization must prevent separated tiny samples from producing runaway Arena scores'
);
assert(
  oneBattleRatings.models[0].ratingLower <= oneBattleRatings.models[1].ratingUpper,
  'a single battle must retain overlapping confidence intervals'
);

const reorderedRatings = calculateBradleyTerry(strengthVotes, [...models].reverse());
ratings.models.forEach(model => {
  const reordered = reorderedRatings.models.find(candidate => candidate.modelId === model.modelId);
  assert(reordered);
  assert(Math.abs(model.rating - reordered.rating) < 1e-5, 'ratings must be invariant to model ordering');
});
const insightBundle = buildPairwiseInsights({ items, votes: strengthVotes, models });
const rawBattleCsv = buildPairwiseBattleCsv(insightBundle);
['SamplingPhase', 'SamplingProbability', 'AnalysisWeight', 'LeftModelID', 'ArenaScore', 'CI95_Lower', 'RankRange']
  .forEach(header => assert(rawBattleCsv.includes(header), `raw battle export must include ${header}`));

const importedChoiceOnlyVote: VoteRecord = {
  itemId: 'imported-shared-case',
  method: 'pairwise',
  choice: 'A',
  timestamp: 1,
  user: 'imported-reviewer',
  itemSnapshot: {
    itemId: 'imported-shared-case',
    prompt: 'Imported prompt',
    modelA_Url: 'https://example.com/imported/model-2.mp4',
    modelB_Url: 'https://example.com/imported/model-4.mp4',
    modelOutputs: [
      { modelId: 'model-2', modelName: 'Model 2', url: 'https://example.com/imported/model-2.mp4' },
      { modelId: 'model-4', modelName: 'Model 4', url: 'https://example.com/imported/model-4.mp4' },
    ],
    type: 'video',
  },
  pairContext: {
    assignmentId: 'imported-assignment',
    pairId: getArenaPairKey('model-2', 'model-4'),
    originalItemId: 'imported-shared-case',
    modelAId: 'model-2',
    modelAName: 'Model 2',
    modelBId: 'model-4',
    modelBName: 'Model 4',
  },
};
const importedInsight = buildPairwiseInsights({ items: [], votes: [importedChoiceOnlyVote], models });
assert.equal(importedInsight.summary.comparisonCount, 1, 'legacy choice-only pairwise votes must remain analyzable');
assert.equal(importedInsight.models.find(model => model.modelId === 'model-2')?.wins, 1);
assert.equal(
  importedInsight.battles[0]?.modelBUrl,
  'https://example.com/imported/model-4.mp4',
  'per-vote snapshots must preserve the exact media for imported multi-model battles'
);

const reversedVotes = strengthVotes.map(vote => ({
  ...vote,
  vote: vote.vote === 'A' ? 'B' as const : vote.vote === 'B' ? 'A' as const : vote.vote,
  choice: vote.choice === 'A' ? 'B' as const : vote.choice === 'B' ? 'A' as const : vote.choice,
  pairContext: vote.pairContext ? {
    ...vote.pairContext,
    modelAId: vote.pairContext.modelBId,
    modelAName: vote.pairContext.modelBName,
    modelBId: vote.pairContext.modelAId,
    modelBName: vote.pairContext.modelAName,
  } : undefined,
}));
const reversedRatings = calculateBradleyTerry(reversedVotes, models);
ratings.models.forEach(model => {
  const reversed = reversedRatings.models.find(candidate => candidate.modelId === model.modelId);
  assert(reversed);
  assert(Math.abs(model.rating - reversed.rating) < 1e-6, 'ratings must be invariant to A/B encoding reversal');
});

const weightedVotes = strengthVotes.map((vote, index) => ({
  ...vote,
  pairContext: vote.pairContext ? {
    ...vote.pairContext,
    samplingProbability: index % 2 === 0 ? 0.05 : 0.5,
    eligiblePairCount: 10,
  } : undefined,
}));
const weightedRatings = calculateBradleyTerry(weightedVotes, models);
assert(weightedRatings.effectiveSampleSize > 0 && weightedRatings.effectiveSampleSize <= weightedRatings.totalBattles,
  'inverse-propensity weighting must report a bounded effective sample size');

const disconnected = calculateBradleyTerry(strengthVotes.filter(vote => vote.pairContext?.modelAId !== 'model-3' && vote.pairContext?.modelBId !== 'model-3'), models);
assert.equal(disconnected.connected, false, 'disconnected comparison graphs must be detected');

console.log('Arena sampling and Bradley-Terry checks passed.');
