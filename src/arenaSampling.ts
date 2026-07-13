import { calculateBradleyTerry, getExpectedInformationGain } from './bradleyTerry';
import type {
  ArenaBattleAssignment,
  ArenaSamplingConfig,
  EvaluationItem,
  ModelOutput,
  PairwiseVoteContext,
  VoteRecord,
} from './types';

export const ARENA_SCHEDULER_VERSION = 'arena_v1';

export const normalizeArenaSamplingConfig = (
  config: Partial<ArenaSamplingConfig> | undefined,
  eligibleCaseCount: number,
  modelCount: number
): ArenaSamplingConfig => ({
  suggestedBattlesPerReviewer: Math.max(1, Math.min(
    eligibleCaseCount || 1,
    config?.suggestedBattlesPerReviewer || Math.max(20, 2 * modelCount)
  )),
  warmupBattlesPerModel: Math.max(1, config?.warmupBattlesPerModel || 3),
  explorationRate: Math.min(1, Math.max(0, config?.explorationRate ?? 0.15)),
  schedulerVersion: config?.schedulerVersion || ARENA_SCHEDULER_VERSION,
  seed: config?.seed || 'eval-studio-arena',
});

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const stableRandom = (value: string) => hashString(value) / 4294967296;

export const getArenaPairKey = (modelAId: string, modelBId: string) =>
  [modelAId, modelBId].sort().join('::');

const getOutputMap = (item: EvaluationItem) => new Map(
  (item.modelOutputs || [])
    .filter(output => output.modelId && output.url)
    .map(output => [output.modelId, output])
);

const getEligiblePairs = (item: EvaluationItem, models: Array<{ id: string; name: string }>) => {
  const outputs = getOutputMap(item);
  const eligibleModels = models.filter(model => outputs.has(model.id));
  const pairs: Array<{ modelA: ModelOutput; modelB: ModelOutput; pairId: string }> = [];
  for (let left = 0; left < eligibleModels.length; left += 1) {
    for (let right = left + 1; right < eligibleModels.length; right += 1) {
      const first = outputs.get(eligibleModels[left].id)!;
      const second = outputs.get(eligibleModels[right].id)!;
      const [modelA, modelB] = first.modelId.localeCompare(second.modelId) <= 0
        ? [first, second]
        : [second, first];
      pairs.push({ modelA, modelB, pairId: getArenaPairKey(modelA.modelId, modelB.modelId) });
    }
  }
  return pairs;
};

export interface BuildArenaReviewerQueueInput {
  taskId: string;
  reviewerId: string;
  items: EvaluationItem[];
  existingVotes: VoteRecord[];
  config: Partial<ArenaSamplingConfig>;
  models?: Array<{ id: string; name: string }>;
}

export const buildArenaReviewerQueue = ({
  taskId,
  reviewerId,
  items,
  existingVotes,
  config,
  models,
}: BuildArenaReviewerQueueInput) => {
  const completedItems = new Set(existingVotes.map(vote => vote.pairContext?.originalItemId || vote.itemId));
  const seed = config.seed || 'eval-studio-arena';
  return items
    .filter(item => !completedItems.has(item.originalItemId || item.id))
    .filter(item => models
      ? getEligiblePairs(item, models).length > 0
      : (item.modelOutputs || []).filter(output => output.url).length >= 2)
    .map(item => ({
      item,
      order: stableRandom(`${seed}|${taskId}|${reviewerId}|case|${item.originalItemId || item.id}`),
    }))
    .sort((left, right) => left.order - right.order || left.item.id.localeCompare(right.item.id))
    .map(({ item }) => item);
};

const getCoverageState = (votes: VoteRecord[], models: Array<{ id: string }>) => {
  const exposure = new Map(models.map(model => [model.id, 0]));
  const pairExposure = new Map<string, number>();
  const parent = new Map(models.map(model => [model.id, model.id]));
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  votes.forEach(vote => {
    const context = vote.pairContext;
    if (!context || !['A', 'B', 'Tie'].includes(String(vote.vote || vote.choice))) return;
    if (!exposure.has(context.modelAId) || !exposure.has(context.modelBId)) return;
    exposure.set(context.modelAId, (exposure.get(context.modelAId) || 0) + 1);
    exposure.set(context.modelBId, (exposure.get(context.modelBId) || 0) + 1);
    const pairId = getArenaPairKey(context.modelAId, context.modelBId);
    pairExposure.set(pairId, (pairExposure.get(pairId) || 0) + 1);
    union(context.modelAId, context.modelBId);
  });
  const roots = new Set(models.map(model => find(model.id)));
  return { exposure, pairExposure, find, connected: roots.size <= 1 };
};

export interface AssignArenaBattleInput {
  taskId: string;
  reviewerId: string;
  item: EvaluationItem;
  models: Array<{ id: string; name: string }>;
  votes: VoteRecord[];
  config: Partial<ArenaSamplingConfig>;
}

export const assignArenaBattle = ({
  taskId,
  reviewerId,
  item,
  models,
  votes,
  config: partialConfig,
}: AssignArenaBattleInput): ArenaBattleAssignment | undefined => {
  const pairs = getEligiblePairs(item, models);
  if (!pairs.length) return undefined;
  const config = normalizeArenaSamplingConfig(partialConfig, 1, models.length);
  const coverage = getCoverageState(votes, models);
  const warmedUp = models.every(model => (coverage.exposure.get(model.id) || 0) >= config.warmupBattlesPerModel);
  const phase = coverage.connected && warmedUp ? 'adaptive' : 'coverage';
  const validVoteCount = votes.filter(vote => vote.pairContext && ['A', 'B', 'Tie'].includes(String(vote.vote || vote.choice))).length;
  const randomKey = `${config.seed}|${taskId}|${reviewerId}|${item.originalItemId || item.id}|${validVoteCount}`;
  let selected = pairs[0];
  let samplingProbability = 1;

  if (phase === 'coverage') {
    const scored = pairs.map(pair => {
      const exposureA = coverage.exposure.get(pair.modelA.modelId) || 0;
      const exposureB = coverage.exposure.get(pair.modelB.modelId) || 0;
      const connectsComponents = coverage.find(pair.modelA.modelId) !== coverage.find(pair.modelB.modelId);
      const belowWarmup = Number(exposureA < config.warmupBattlesPerModel) + Number(exposureB < config.warmupBattlesPerModel);
      const pairBattles = coverage.pairExposure.get(pair.pairId) || 0;
      const utility = (connectsComponents ? 1_000_000 : 0)
        + belowWarmup * 10_000
        - (exposureA + exposureB) * 100
        - pairBattles * 10;
      return { pair, utility };
    });
    const highestUtility = Math.max(...scored.map(entry => entry.utility));
    const priority = scored.filter(entry => entry.utility === highestUtility).map(entry => entry.pair);
    const index = Math.floor(stableRandom(`${randomKey}|coverage`) * priority.length);
    selected = priority[Math.min(index, priority.length - 1)];
    samplingProbability = 1 / priority.length;
  } else {
    const result = calculateBradleyTerry(votes, models);
    const scored = pairs
      .map(pair => ({
        pair,
        gain: Math.log1p(getExpectedInformationGain(result, pair.modelA.modelId, pair.modelB.modelId))
          - 0.75 * (
            (coverage.exposure.get(pair.modelA.modelId) || 0)
            + (coverage.exposure.get(pair.modelB.modelId) || 0)
          )
          - 0.5 * (coverage.pairExposure.get(pair.pairId) || 0),
      }))
      .sort((left, right) => right.gain - left.gain || left.pair.pairId.localeCompare(right.pair.pairId));
    const priorityCount = Math.max(1, Math.ceil(scored.length * 0.25));
    const priority = scored.slice(0, priorityCount);
    const explore = stableRandom(`${randomKey}|branch`) < config.explorationRate;
    const pool = explore ? scored : priority;
    const index = Math.floor(stableRandom(`${randomKey}|pair`) * pool.length);
    selected = pool[Math.min(index, pool.length - 1)].pair;
    samplingProbability = config.explorationRate / scored.length
      + (priority.some(entry => entry.pair.pairId === selected.pairId) ? (1 - config.explorationRate) / priority.length : 0);
  }

  const isSwapped = stableRandom(`${randomKey}|${selected.pairId}|position`) >= 0.5;
  const leftModelId = isSwapped ? selected.modelB.modelId : selected.modelA.modelId;
  const rightModelId = isSwapped ? selected.modelA.modelId : selected.modelB.modelId;
  const assignmentId = `${item.originalItemId || item.id}__${selected.pairId}__${hashString(randomKey).toString(36)}`;
  const pairContext: PairwiseVoteContext = {
    assignmentId,
    pairId: selected.pairId,
    originalItemId: item.originalItemId || item.id,
    modelAId: selected.modelA.modelId,
    modelAName: selected.modelA.modelName,
    modelBId: selected.modelB.modelId,
    modelBName: selected.modelB.modelName,
    leftModelId,
    rightModelId,
    samplingPhase: phase,
    samplingProbability,
    eligiblePairCount: pairs.length,
    schedulerVersion: config.schedulerVersion,
  };
  return {
    assignmentId,
    itemId: item.id,
    originalItemId: item.originalItemId || item.id,
    modelAId: selected.modelA.modelId,
    modelAName: selected.modelA.modelName,
    modelAUrl: selected.modelA.url,
    modelBId: selected.modelB.modelId,
    modelBName: selected.modelB.modelName,
    modelBUrl: selected.modelB.url,
    leftModelId,
    rightModelId,
    isSwapped,
    samplingPhase: phase,
    samplingProbability,
    eligiblePairCount: pairs.length,
    schedulerVersion: config.schedulerVersion,
    pairContext,
  };
};

export const applyArenaAssignmentToItem = (
  item: EvaluationItem,
  assignment: ArenaBattleAssignment
): EvaluationItem => ({
  ...item,
  originalItemId: assignment.originalItemId,
  modelA_Url: assignment.modelAUrl,
  modelB_Url: assignment.modelBUrl,
  isSwapped: assignment.isSwapped,
  pairContext: assignment.pairContext,
});

export const restoreArenaItemFromVote = (item: EvaluationItem, vote: VoteRecord): EvaluationItem => {
  const context = vote.pairContext;
  if (!context) return item;
  const outputs = getOutputMap(item);
  const modelA = outputs.get(context.modelAId);
  const modelB = outputs.get(context.modelBId);
  return {
    ...item,
    id: vote.itemId || item.id,
    originalItemId: context.originalItemId || item.originalItemId || item.id,
    modelA_Url: modelA?.url || vote.itemSnapshot?.modelA_Url || item.modelA_Url,
    modelB_Url: modelB?.url || vote.itemSnapshot?.modelB_Url || item.modelB_Url,
    isSwapped: context.leftModelId
      ? context.leftModelId === context.modelBId
      : vote.itemSnapshot?.pairContext?.leftModelId === context.modelBId,
    pairContext: { ...context },
  };
};

export interface BuildArenaSessionInput extends Omit<BuildArenaReviewerQueueInput, 'existingVotes'> {
  reviewerVotes: VoteRecord[];
  schedulingVotes: VoteRecord[];
  models: Array<{ id: string; name: string }>;
}

export const buildArenaSessionItems = ({
  taskId,
  reviewerId,
  items,
  reviewerVotes,
  schedulingVotes,
  models,
  config,
}: BuildArenaSessionInput) => {
  const sourceById = new Map<string, EvaluationItem>();
  items.forEach(item => {
    sourceById.set(item.id, item);
    sourceById.set(item.originalItemId || item.id, item);
  });
  const completed = reviewerVotes.flatMap(vote => {
    const item = sourceById.get(vote.pairContext?.originalItemId || vote.itemId);
    return item ? [restoreArenaItemFromVote(item, vote)] : [];
  });
  const remaining = buildArenaReviewerQueue({
    taskId,
    reviewerId,
    items,
    existingVotes: reviewerVotes,
    config,
    models,
  });
  if (remaining.length > 0) {
    const assignment = assignArenaBattle({
      taskId,
      reviewerId,
      item: remaining[0],
      models,
      votes: schedulingVotes,
      config,
    });
    if (assignment) remaining[0] = applyArenaAssignmentToItem(remaining[0], assignment);
  }
  return {
    items: [...completed, ...remaining],
    currentIndex: completed.length,
    remainingCount: remaining.length,
  };
};
