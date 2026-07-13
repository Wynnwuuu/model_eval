import { EvalDimension, EvaluationConfig, EvaluationItem, ModelOutput, VoteRecord } from './types';
import { getDimensionValuesForItem } from './dimensionUtils';
import { getModelOutputsForItem, resolveEvaluationItemPrompt } from './rankingUtils';
import { normalizeDimensions, scoreDimensionWeightTotal } from './evaluationMethods';
import { getEffectiveVotes } from './voteUtils';
import { calculateBradleyTerry, getBradleyTerryAnalysisWeight, type BradleyTerryResult } from './bradleyTerry';
import { itemFromVoteSnapshot } from './taskItemSnapshot';

const escapeCsv = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const rowsToCsv = (headers: string[], rows: any[][]) =>
  [headers.map(escapeCsv).join(','), ...rows.map(row => row.map(escapeCsv).join(','))].join('\n');

export const safeMean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export const safeMedian = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const safeStdDev = (values: number[]) => {
  if (values.length <= 1) return 0;
  const mean = safeMean(values);
  const variance = safeMean(values.map(value => (value - mean) ** 2));
  return Math.sqrt(variance);
};

export interface ScoreModelSummary {
  modelId: string;
  modelName: string;
  averageScore: number;
  medianScore: number;
  stdDev: number;
  responseCount: number;
  dimensionAverages: Record<string, number>;
}

export interface ScoreCaseSummary {
  itemId: string;
  prompt: string;
  dimensionValues: Record<string, string>;
  representativeOutputs: ModelOutput[];
  modelScores: Array<{
    modelId: string;
    modelName: string;
    outputUrl: string;
    averageScore: number;
    weightedScore: number;
    responseCount: number;
    dimensionScores: Record<string, number>;
    reasons: string[];
  }>;
}

export interface ScoreDimensionSummary {
  dimensionId: string;
  dimensionName: string;
  weight: number;
  modelAverages: Array<{
    modelId: string;
    modelName: string;
    averageScore: number;
    responseCount: number;
  }>;
}

export interface ScoreInsightBundle {
  mode: 'score';
  method: EvaluationConfig['method'];
  title: string;
  config: EvaluationConfig;
  summary: {
    itemCount: number;
    voterCount: number;
    responseCount: number;
    topModelName: string;
    topAverageScore: number;
    averageStdDev: number;
  };
  models: ScoreModelSummary[];
  dimensions: ScoreDimensionSummary[];
  cases: ScoreCaseSummary[];
}

export interface PairwiseModelSummary {
  modelId: string;
  modelName: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
  winRate: number;
  nonTieWinRate: number;
}

export interface PairwiseMatchupSummary {
  pairKey: string;
  modelAId: string;
  modelAName: string;
  modelBId: string;
  modelBName: string;
  modelAWins: number;
  modelBWins: number;
  ties: number;
  total: number;
}

export interface PairwiseInsightBundle {
  mode: 'pairwise';
  summary: {
    itemCount: number;
    voterCount: number;
    comparisonCount: number;
    topModelName: string;
    topWinRate: number;
    connected: boolean;
    pairCoverage: number;
    effectiveSampleSize: number;
    maturity: 'insufficient' | 'warming' | 'ready';
  };
  models: PairwiseModelSummary[];
  matchups: PairwiseMatchupSummary[];
  bradleyTerry: BradleyTerryResult;
  battles: Array<{
    assignmentId: string;
    pairId: string;
    itemId: string;
    originalItemId: string;
    prompt: string;
    dimensionValues: Record<string, string>;
    user: string;
    timestamp: number;
    modelAId: string;
    modelAName: string;
    modelAUrl: string;
    modelBId: string;
    modelBName: string;
    modelBUrl: string;
    leftModelId: string;
    rightModelId: string;
    vote: 'A' | 'B' | 'Tie';
    winnerModelName: string;
    samplingPhase: string;
    samplingProbability: number;
    analysisWeight: number;
    eligiblePairCount: number;
    schedulerVersion: string;
  }>;
  dimensions: Array<{
    dimension: string;
    value: string;
    itemCount: number;
    battleCount: number;
    connected: boolean;
    sufficient: boolean;
    leader: string;
    leaderScore?: number;
  }>;
  cases: Array<{
    itemId: string;
    originalItemId: string;
    prompt: string;
    dimensionValues: Record<string, string>;
    modelAName: string;
    modelBName: string;
    votes: { A: number; B: number; Tie: number };
    winner: string;
    representativeOutputs: ModelOutput[];
  }>;
}

const getScoreDimensions = (config: EvaluationConfig) =>
  normalizeDimensions(config.dimensions || [], config.method)
    .filter(dimension => dimension.type === 'star_rating' && dimension.aggregationRole !== 'rationale');

const getRationaleDimensions = (config: EvaluationConfig) =>
  normalizeDimensions(config.dimensions || [], config.method)
    .filter(dimension => dimension.type === 'text_input' || dimension.aggregationRole === 'rationale');

const weightedScore = (scores: Record<string, number>, dimensions: EvalDimension[]) => {
  const totalWeight = scoreDimensionWeightTotal(dimensions);
  if (!totalWeight) return safeMean(Object.values(scores).filter(Number.isFinite));
  return dimensions.reduce((sum, dimension) => {
    const score = Number(scores[dimension.id]);
    if (!Number.isFinite(score)) return sum;
    return sum + score * (dimension.weight ?? 1);
  }, 0) / totalWeight;
};

export const buildScoreInsights = ({
  items,
  votes,
  models,
  config
}: {
  items: Array<Partial<EvaluationItem> & { id: string }>;
  votes: VoteRecord[];
  models: { id: string; name: string }[];
  config: EvaluationConfig;
}): ScoreInsightBundle => {
  const effectiveVotes = getEffectiveVotes(votes);
  const scoreDimensions = getScoreDimensions(config);
  const rationaleDimensions = getRationaleDimensions(config);
  const itemMap = new Map(items.map(item => [item.id, item]));
  const voters = new Set(effectiveVotes.map(vote => vote.user || 'Anonymous'));
  const modelScores = new Map<string, number[]>();
  const modelDimensionScores = new Map<string, Map<string, number[]>>();
  const caseMap = new Map<string, ScoreCaseSummary>();

  models.forEach(model => {
    modelScores.set(model.id, []);
    modelDimensionScores.set(model.id, new Map(scoreDimensions.map(dimension => [dimension.id, []])));
  });

  effectiveVotes.forEach(vote => {
    const item = itemMap.get(vote.itemId);
    const responses = vote.rubricResponses || {};
    const outputs = getModelOutputsForItem(item as EvaluationItem | undefined, models);
    const currentCase = caseMap.get(vote.itemId) || {
      itemId: vote.itemId,
      prompt: resolveEvaluationItemPrompt(item as any),
      dimensionValues: getDimensionValuesForItem(item as any),
      representativeOutputs: outputs,
      modelScores: []
    };

    Object.entries(responses).forEach(([modelId, response]) => {
      const model = models.find(candidate => candidate.id === modelId) || { id: response.modelId || modelId, name: response.modelName || modelId };
      const scoreMap = response.scores || {};
      const numericScores = scoreDimensions.reduce<Record<string, number>>((acc, dimension) => {
        const score = Number(scoreMap[dimension.id]);
        if (Number.isFinite(score)) acc[dimension.id] = score;
        return acc;
      }, {});
      const scoreValues = Object.values(numericScores);
      if (!scoreValues.length) return;

      const total = weightedScore(numericScores, scoreDimensions);
      modelScores.set(model.id, [...(modelScores.get(model.id) || []), total]);
      const byDimension = modelDimensionScores.get(model.id) || new Map<string, number[]>();
      Object.entries(numericScores).forEach(([dimensionId, score]) => {
        byDimension.set(dimensionId, [...(byDimension.get(dimensionId) || []), score]);
      });
      modelDimensionScores.set(model.id, byDimension);

      const existing = currentCase.modelScores.find(row => row.modelId === model.id);
      const output = outputs.find(candidate => candidate.modelId === model.id);
      const reasons = [
        response.reason,
        ...rationaleDimensions
          .map(dimension => String(response.answers?.[dimension.id] || (scoreMap as any)[dimension.id] || '').trim())
          .filter(Boolean)
      ].filter(Boolean) as string[];

      if (existing) {
        existing.averageScore = safeMean([existing.averageScore, safeMean(scoreValues)]);
        existing.weightedScore = safeMean([existing.weightedScore, total]);
        existing.responseCount += 1;
        existing.reasons.push(...reasons);
        Object.entries(numericScores).forEach(([dimensionId, score]) => {
          existing.dimensionScores[dimensionId] = existing.dimensionScores[dimensionId]
            ? safeMean([existing.dimensionScores[dimensionId], score])
            : score;
        });
      } else {
        currentCase.modelScores.push({
          modelId: model.id,
          modelName: model.name,
          outputUrl: output?.url || '',
          averageScore: safeMean(scoreValues),
          weightedScore: total,
          responseCount: 1,
          dimensionScores: numericScores,
          reasons
        });
      }
    });

    caseMap.set(vote.itemId, currentCase);
  });

  const modelSummaries = models.map(model => {
    const scores = modelScores.get(model.id) || [];
    const byDimension = modelDimensionScores.get(model.id) || new Map<string, number[]>();
    return {
      modelId: model.id,
      modelName: model.name,
      averageScore: safeMean(scores),
      medianScore: safeMedian(scores),
      stdDev: safeStdDev(scores),
      responseCount: scores.length,
      dimensionAverages: Object.fromEntries(scoreDimensions.map(dimension => [
        dimension.id,
        safeMean(byDimension.get(dimension.id) || [])
      ]))
    };
  }).sort((a, b) => b.averageScore - a.averageScore);

  const dimensionSummaries = scoreDimensions.map(dimension => ({
    dimensionId: dimension.id,
    dimensionName: dimension.name,
    weight: dimension.weight ?? 1,
    modelAverages: models.map(model => {
      const scores = modelDimensionScores.get(model.id)?.get(dimension.id) || [];
      return {
        modelId: model.id,
        modelName: model.name,
        averageScore: safeMean(scores),
        responseCount: scores.length
      };
    }).sort((a, b) => b.averageScore - a.averageScore)
  }));

  const allScores = Array.from(modelScores.values()).flat();

  return {
    mode: 'score',
    method: config.method,
    title: config.method === 'rubric_score' ? 'Rubric 多维评分洞察' : '直接评分 / MOS 洞察',
    config,
    summary: {
      itemCount: caseMap.size,
      voterCount: voters.size,
      responseCount: allScores.length,
      topModelName: modelSummaries[0]?.modelName || '-',
      topAverageScore: modelSummaries[0]?.averageScore || 0,
      averageStdDev: safeMean(modelSummaries.map(model => model.stdDev))
    },
    models: modelSummaries,
    dimensions: dimensionSummaries,
    cases: Array.from(caseMap.values()).sort((a, b) => a.itemId.localeCompare(b.itemId))
  };
};

const pairKey = (left: string, right: string) => [left, right].sort().join('__');

interface PairwiseRawInsightBundle {
  mode: 'pairwise';
  summary: {
    itemCount: number;
    voterCount: number;
    comparisonCount: number;
    topModelName: string;
    topWinRate: number;
  };
  models: PairwiseModelSummary[];
  matchups: PairwiseMatchupSummary[];
  cases: PairwiseInsightBundle['cases'];
}

const buildPairwiseRawInsights = ({
  items,
  votes,
  models
}: {
  items: Array<Partial<EvaluationItem> & { id: string }>;
  votes: VoteRecord[];
  models: { id: string; name: string }[];
}): PairwiseRawInsightBundle => {
  const effectiveVotes = getEffectiveVotes(votes);
  const itemMap = new Map(items.map(item => [item.id, item]));
  const modelStats = new Map<string, PairwiseModelSummary>();
  const matchups = new Map<string, PairwiseMatchupSummary>();
  const cases = new Map<string, PairwiseInsightBundle['cases'][number]>();
  const voters = new Set(effectiveVotes.map(vote => vote.user || 'Anonymous'));

  models.forEach(model => {
    modelStats.set(model.id, {
      modelId: model.id,
      modelName: model.name,
      wins: 0,
      losses: 0,
      ties: 0,
      total: 0,
      winRate: 0,
      nonTieWinRate: 0
    });
  });

  effectiveVotes.forEach(vote => {
    const pair = vote.pairContext;
    const outcome = vote.vote || vote.choice;
    if (!pair || !['A', 'B', 'Tie'].includes(String(outcome))) return;
    const key = pairKey(pair.modelAId, pair.modelBId);
    const matchup = matchups.get(key) || {
      pairKey: key,
      modelAId: pair.modelAId,
      modelAName: pair.modelAName,
      modelBId: pair.modelBId,
      modelBName: pair.modelBName,
      modelAWins: 0,
      modelBWins: 0,
      ties: 0,
      total: 0
    };

    const leftStat = modelStats.get(pair.modelAId) || {
      modelId: pair.modelAId,
      modelName: pair.modelAName,
      wins: 0,
      losses: 0,
      ties: 0,
      total: 0,
      winRate: 0,
      nonTieWinRate: 0
    };
    const rightStat = modelStats.get(pair.modelBId) || {
      modelId: pair.modelBId,
      modelName: pair.modelBName,
      wins: 0,
      losses: 0,
      ties: 0,
      total: 0,
      winRate: 0,
      nonTieWinRate: 0
    };

    matchup.total += 1;
    leftStat.total += 1;
    rightStat.total += 1;

    if (outcome === 'A') {
      matchup.modelAWins += 1;
      leftStat.wins += 1;
      rightStat.losses += 1;
    } else if (outcome === 'B') {
      matchup.modelBWins += 1;
      rightStat.wins += 1;
      leftStat.losses += 1;
    } else {
      matchup.ties += 1;
      leftStat.ties += 1;
      rightStat.ties += 1;
    }

    modelStats.set(pair.modelAId, leftStat);
    modelStats.set(pair.modelBId, rightStat);
    matchups.set(key, matchup);

    const item = itemMap.get(vote.itemId);
    const outputs = getModelOutputsForItem(item as EvaluationItem | undefined, models);
    const caseRow = cases.get(vote.itemId) || {
      itemId: vote.itemId,
      originalItemId: pair.originalItemId || vote.itemId,
      prompt: resolveEvaluationItemPrompt(item as any),
      dimensionValues: getDimensionValuesForItem(item as any),
      modelAName: pair.modelAName,
      modelBName: pair.modelBName,
      votes: { A: 0, B: 0, Tie: 0 },
      winner: '',
      representativeOutputs: outputs.filter(output => output.modelId === pair.modelAId || output.modelId === pair.modelBId)
    };
    caseRow.votes[outcome as 'A' | 'B' | 'Tie'] += 1;
    const maxVotes = Math.max(caseRow.votes.A, caseRow.votes.B, caseRow.votes.Tie);
    caseRow.winner = caseRow.votes.Tie === maxVotes
      ? '平局'
      : caseRow.votes.A === maxVotes
        ? pair.modelAName
        : pair.modelBName;
    cases.set(vote.itemId, caseRow);
  });

  const modelsSorted = Array.from(modelStats.values()).map(model => {
    const nonTie = model.wins + model.losses;
    return {
      ...model,
      winRate: model.total ? model.wins / model.total : 0,
      nonTieWinRate: nonTie ? model.wins / nonTie : 0
    };
  }).sort((a, b) => b.nonTieWinRate - a.nonTieWinRate || b.wins - a.wins);

  return {
    mode: 'pairwise',
    summary: {
      itemCount: cases.size,
      voterCount: voters.size,
      comparisonCount: effectiveVotes.filter(vote =>
        vote.pairContext && ['A', 'B', 'Tie'].includes(String(vote.vote || vote.choice))
      ).length,
      topModelName: modelsSorted[0]?.modelName || '-',
      topWinRate: modelsSorted[0]?.nonTieWinRate || 0
    },
    models: modelsSorted,
    matchups: Array.from(matchups.values()).sort((a, b) => b.total - a.total),
    cases: Array.from(cases.values()).sort((a, b) => a.itemId.localeCompare(b.itemId))
  };
};

export const buildPairwiseInsights = ({
  items,
  votes,
  models
}: {
  items: Array<Partial<EvaluationItem> & { id: string }>;
  votes: VoteRecord[];
  models: { id: string; name: string }[];
}): PairwiseInsightBundle => {
  const effectiveVotes = getEffectiveVotes(votes).filter(vote =>
    !!vote.pairContext && ['A', 'B', 'Tie'].includes(String(vote.vote || vote.choice))
  );
  const legacy = buildPairwiseRawInsights({ items, votes: effectiveVotes, models });
  const itemMap = new Map<string, Partial<EvaluationItem> & { id: string }>();
  items.forEach(item => {
    itemMap.set(item.id, item);
    if (item.originalItemId) itemMap.set(item.originalItemId, item);
  });
  const caseMap = new Map<string, PairwiseInsightBundle['cases'][number]>();
  const dimensionGroups = new Map<string, {
    dimension: string;
    value: string;
    votes: VoteRecord[];
    itemIds: Set<string>;
  }>();
  const battles: PairwiseInsightBundle['battles'] = [];

  effectiveVotes.forEach(vote => {
    const pair = vote.pairContext!;
    const outcome = (vote.vote || vote.choice) as 'A' | 'B' | 'Tie';
    const originalItemId = pair.originalItemId || vote.itemId;
    const item = itemFromVoteSnapshot(vote)
      || itemMap.get(originalItemId)
      || itemMap.get(vote.itemId);
    const prompt = resolveEvaluationItemPrompt(item as any);
    const dimensionValues = getDimensionValuesForItem(item as any);
    const outputs = getModelOutputsForItem(item as EvaluationItem | undefined, models);
    const outputMap = new Map(outputs.map(output => [output.modelId, output.url]));
    const matchupKey = pairKey(pair.modelAId, pair.modelBId);
    const caseKey = `${originalItemId}::${matchupKey}`;
    const caseRow = caseMap.get(caseKey) || {
      itemId: caseKey,
      originalItemId,
      prompt,
      dimensionValues,
      modelAName: pair.modelAName,
      modelBName: pair.modelBName,
      votes: { A: 0, B: 0, Tie: 0 },
      winner: '',
      representativeOutputs: outputs.filter(output => output.modelId === pair.modelAId || output.modelId === pair.modelBId),
    };
    caseRow.votes[outcome] += 1;
    const maxVotes = Math.max(caseRow.votes.A, caseRow.votes.B, caseRow.votes.Tie);
    const tiedLeaders = [caseRow.votes.A, caseRow.votes.B, caseRow.votes.Tie]
      .filter(value => value === maxVotes).length;
    caseRow.winner = tiedLeaders > 1 || caseRow.votes.Tie === maxVotes
      ? '平局'
      : caseRow.votes.A === maxVotes ? pair.modelAName : pair.modelBName;
    caseMap.set(caseKey, caseRow);

    battles.push({
      assignmentId: pair.assignmentId || '',
      pairId: pair.pairId || pairKey(pair.modelAId, pair.modelBId),
      itemId: vote.itemId,
      originalItemId,
      prompt,
      dimensionValues,
      user: vote.user || 'Anonymous',
      timestamp: vote.timestamp,
      modelAId: pair.modelAId,
      modelAName: pair.modelAName,
      modelAUrl: outputMap.get(pair.modelAId) || item?.modelA_Url || '',
      modelBId: pair.modelBId,
      modelBName: pair.modelBName,
      modelBUrl: outputMap.get(pair.modelBId) || item?.modelB_Url || '',
      leftModelId: pair.leftModelId || pair.modelAId,
      rightModelId: pair.rightModelId || pair.modelBId,
      vote: outcome,
      winnerModelName: outcome === 'Tie' ? '平局' : outcome === 'A' ? pair.modelAName : pair.modelBName,
      samplingPhase: pair.samplingPhase || 'legacy',
      samplingProbability: pair.samplingProbability || 1,
      analysisWeight: getBradleyTerryAnalysisWeight(vote),
      eligiblePairCount: pair.eligiblePairCount || 0,
      schedulerVersion: pair.schedulerVersion || 'legacy',
    });

    Object.entries(dimensionValues).forEach(([dimension, value]) => {
      if (!String(value).trim()) return;
      const key = `${dimension}\u0000${value}`;
      const group = dimensionGroups.get(key) || {
        dimension,
        value: String(value),
        votes: [],
        itemIds: new Set<string>(),
      };
      group.votes.push(vote);
      group.itemIds.add(originalItemId);
      dimensionGroups.set(key, group);
    });
  });

  const bradleyTerry = calculateBradleyTerry(effectiveVotes, models);
  const meanAnalysisWeight = battles.length
    ? battles.reduce((sum, battle) => sum + battle.analysisWeight, 0) / battles.length
    : 1;
  battles.forEach(battle => {
    battle.analysisWeight /= meanAnalysisWeight;
  });
  const expectedPairCount = models.length > 1 ? (models.length * (models.length - 1)) / 2 : 0;
  const pairCoverage = expectedPairCount ? legacy.matchups.length / expectedPairCount : 0;
  const maturity: PairwiseInsightBundle['summary']['maturity'] = !bradleyTerry.connected
    ? 'insufficient'
    : bradleyTerry.totalBattles < Math.max(10, models.length * 3) ? 'warming' : 'ready';
  const topBtModel = bradleyTerry.connected ? bradleyTerry.models[0] : undefined;
  const topRawModel = topBtModel
    ? legacy.models.find((model: PairwiseModelSummary) => model.modelId === topBtModel.modelId)
    : undefined;
  const dimensions = Array.from(dimensionGroups.values()).map(group => {
    const result = calculateBradleyTerry(group.votes, models);
    const sufficient = group.itemIds.size >= 5 && group.votes.length >= 10 && result.connected;
    return {
      dimension: group.dimension,
      value: group.value,
      itemCount: group.itemIds.size,
      battleCount: group.votes.length,
      connected: result.connected,
      sufficient,
      leader: sufficient ? result.models[0]?.modelName || '-' : '-',
      leaderScore: sufficient ? result.models[0]?.rating : undefined,
    };
  }).sort((left, right) => left.dimension.localeCompare(right.dimension) || left.value.localeCompare(right.value));

  return {
    mode: 'pairwise',
    summary: {
      itemCount: new Set(battles.map(battle => battle.originalItemId)).size,
      voterCount: new Set(battles.map(battle => battle.user)).size,
      comparisonCount: bradleyTerry.totalBattles,
      topModelName: topBtModel?.modelName || '数据不足',
      topWinRate: topRawModel?.nonTieWinRate || 0,
      connected: bradleyTerry.connected,
      pairCoverage,
      effectiveSampleSize: bradleyTerry.effectiveSampleSize,
      maturity,
    },
    models: legacy.models,
    matchups: legacy.matchups,
    bradleyTerry,
    battles,
    dimensions,
    cases: Array.from(caseMap.values()).sort((left, right) => left.itemId.localeCompare(right.itemId)),
  };
};

export const buildScoreSummaryCsv = (bundle: ScoreInsightBundle) =>
  rowsToCsv(
    ['ModelID', 'ModelName', 'AverageScore', 'MedianScore', 'StdDev', 'ResponseCount', 'DimensionAverages'],
    bundle.models.map(model => [
      model.modelId,
      model.modelName,
      model.averageScore.toFixed(4),
      model.medianScore.toFixed(4),
      model.stdDev.toFixed(4),
      model.responseCount,
      Object.entries(model.dimensionAverages).map(([key, value]) => `${key}:${value.toFixed(4)}`).join(' | ')
    ])
  );

export const buildScoreCaseCsv = (bundle: ScoreInsightBundle) =>
  rowsToCsv(
    ['ItemID', 'Prompt', 'ModelID', 'ModelName', 'OutputURL', 'AverageScore', 'WeightedScore', 'ResponseCount', 'DimensionScores', 'Reasons'],
    bundle.cases.flatMap(item => item.modelScores.map(model => [
      item.itemId,
      item.prompt,
      model.modelId,
      model.modelName,
      model.outputUrl,
      model.averageScore.toFixed(4),
      model.weightedScore.toFixed(4),
      model.responseCount,
      Object.entries(model.dimensionScores).map(([key, value]) => `${key}:${value}`).join(' | '),
      model.reasons.join(' | ')
    ]))
  );

export const buildPairwiseSummaryCsv = (bundle: PairwiseInsightBundle) =>
  rowsToCsv(
    ['ModelID', 'ModelName', 'ArenaScore', 'CI95_Lower', 'CI95_Upper', 'Rank', 'RankRange_Lower', 'RankRange_Upper', 'Component', 'GraphConnected', 'Battles', 'CoverageBattles', 'AdaptiveBattles', 'AverageSamplingProbability', 'AverageAnalysisWeight', 'Wins', 'Losses', 'Ties', 'WinRate', 'NonTieWinRate', 'EffectiveSampleSize'],
    bundle.bradleyTerry.models.map(rating => {
      const raw = bundle.models.find(model => model.modelId === rating.modelId);
      const modelBattles = bundle.battles.filter(battle => battle.modelAId === rating.modelId || battle.modelBId === rating.modelId);
      const comparable = bundle.bradleyTerry.connected;
      return [
        rating.modelId,
        rating.modelName,
        comparable ? rating.rating.toFixed(4) : '',
        comparable ? rating.ratingLower.toFixed(4) : '',
        comparable ? rating.ratingUpper.toFixed(4) : '',
        comparable ? rating.rank : '',
        comparable ? rating.rankLower : '',
        comparable ? rating.rankUpper : '',
        rating.component,
        comparable,
        rating.battles,
        modelBattles.filter(battle => battle.samplingPhase === 'coverage').length,
        modelBattles.filter(battle => battle.samplingPhase === 'adaptive').length,
        safeMean(modelBattles.map(battle => battle.samplingProbability)).toFixed(8),
        safeMean(modelBattles.map(battle => battle.analysisWeight)).toFixed(8),
        raw?.wins || 0,
        raw?.losses || 0,
        raw?.ties || 0,
        (raw?.winRate || 0).toFixed(4),
        (raw?.nonTieWinRate || 0).toFixed(4),
        bundle.bradleyTerry.effectiveSampleSize.toFixed(4),
      ];
    })
  );

export const buildPairwiseCaseCsv = (bundle: PairwiseInsightBundle) => rowsToCsv(
  ['ItemID', 'OriginalItemID', 'Prompt', 'DimensionsJSON', 'ModelA', 'ModelA_URL', 'ModelB', 'ModelB_URL', 'Votes_A', 'Votes_B', 'Votes_Tie', 'Winner', 'SamplingPhases', 'AverageSamplingProbability', 'AverageAnalysisWeight', 'GraphConnected'],
  bundle.cases.map(item => {
    const caseBattles = bundle.battles.filter(battle =>
      battle.originalItemId === item.originalItemId
      && [battle.modelAName, battle.modelBName].includes(item.modelAName)
      && [battle.modelAName, battle.modelBName].includes(item.modelBName)
    );
    return [
      item.itemId,
      item.originalItemId,
      item.prompt,
      JSON.stringify(item.dimensionValues),
      item.modelAName,
      item.representativeOutputs.find(output => output.modelName === item.modelAName)?.url || '',
      item.modelBName,
      item.representativeOutputs.find(output => output.modelName === item.modelBName)?.url || '',
      item.votes.A,
      item.votes.B,
      item.votes.Tie,
      item.winner,
      Array.from(new Set(caseBattles.map(battle => battle.samplingPhase))).join(' | '),
      safeMean(caseBattles.map(battle => battle.samplingProbability)).toFixed(8),
      safeMean(caseBattles.map(battle => battle.analysisWeight)).toFixed(8),
      bundle.bradleyTerry.connected,
    ];
  })
);

export const buildPairwiseMatchupCsv = (bundle: PairwiseInsightBundle) =>
  rowsToCsv(
    ['PairID', 'ModelA_ID', 'ModelA_Name', 'ModelA_ArenaScore', 'ModelA_CI95_Lower', 'ModelA_CI95_Upper', 'ModelA_RankRange', 'ModelB_ID', 'ModelB_Name', 'ModelB_ArenaScore', 'ModelB_CI95_Lower', 'ModelB_CI95_Upper', 'ModelB_RankRange', 'ModelA_Wins', 'ModelB_Wins', 'Ties', 'Battles', 'CoverageBattles', 'AdaptiveBattles', 'AverageSamplingProbability', 'AverageAnalysisWeight', 'CoverageRate', 'GraphConnected'],
    bundle.matchups.map(matchup => {
      const modelA = bundle.bradleyTerry.models.find(model => model.modelId === matchup.modelAId);
      const modelB = bundle.bradleyTerry.models.find(model => model.modelId === matchup.modelBId);
      const pairBattles = bundle.battles.filter(battle => battle.pairId === matchup.pairKey || [battle.modelAId, battle.modelBId].sort().join('__') === matchup.pairKey);
      const comparable = bundle.bradleyTerry.connected;
      return [
        matchup.pairKey,
        matchup.modelAId,
        matchup.modelAName,
        comparable && modelA ? modelA.rating.toFixed(4) : '',
        comparable && modelA ? modelA.ratingLower.toFixed(4) : '',
        comparable && modelA ? modelA.ratingUpper.toFixed(4) : '',
        comparable && modelA ? `${modelA.rankLower}-${modelA.rankUpper}` : '',
        matchup.modelBId,
        matchup.modelBName,
        comparable && modelB ? modelB.rating.toFixed(4) : '',
        comparable && modelB ? modelB.ratingLower.toFixed(4) : '',
        comparable && modelB ? modelB.ratingUpper.toFixed(4) : '',
        comparable && modelB ? `${modelB.rankLower}-${modelB.rankUpper}` : '',
        matchup.modelAWins,
        matchup.modelBWins,
        matchup.ties,
        matchup.total,
        pairBattles.filter(battle => battle.samplingPhase === 'coverage').length,
        pairBattles.filter(battle => battle.samplingPhase === 'adaptive').length,
        safeMean(pairBattles.map(battle => battle.samplingProbability)).toFixed(8),
        safeMean(pairBattles.map(battle => battle.analysisWeight)).toFixed(8),
        bundle.summary.pairCoverage.toFixed(4),
        comparable,
      ];
    })
  );

export const buildPairwiseBattleCsv = (bundle: PairwiseInsightBundle) => {
  const dimensionNames = Array.from(new Set(bundle.battles.flatMap(battle => Object.keys(battle.dimensionValues))));
  return rowsToCsv(
    [
      'AssignmentID', 'PairID', 'ItemID', 'OriginalItemID', 'Prompt', ...dimensionNames.map(name => `Dimension_${name}`),
      'User', 'Timestamp', 'ModelA_ID', 'ModelA_Name', 'ModelA_URL', 'ModelB_ID', 'ModelB_Name', 'ModelB_URL',
      'LeftModelID', 'RightModelID', 'VoteSide', 'WinnerModelName', 'SamplingPhase', 'SamplingProbability',
      'UniformProbability', 'AnalysisWeight', 'EligiblePairCount', 'SchedulerVersion',
      'ModelA_ArenaScore', 'ModelA_CI95_Lower', 'ModelA_CI95_Upper', 'ModelA_RankRange',
      'ModelB_ArenaScore', 'ModelB_CI95_Lower', 'ModelB_CI95_Upper', 'ModelB_RankRange', 'GraphConnected',
    ],
    bundle.battles.map(battle => {
      const modelA = bundle.bradleyTerry.models.find(model => model.modelId === battle.modelAId);
      const modelB = bundle.bradleyTerry.models.find(model => model.modelId === battle.modelBId);
      const comparable = bundle.bradleyTerry.connected;
      return [
        battle.assignmentId,
        battle.pairId,
        battle.itemId,
        battle.originalItemId,
        battle.prompt,
        ...dimensionNames.map(name => battle.dimensionValues[name] || ''),
        battle.user,
        new Date(battle.timestamp).toISOString(),
        battle.modelAId,
        battle.modelAName,
        battle.modelAUrl,
        battle.modelBId,
        battle.modelBName,
        battle.modelBUrl,
        battle.leftModelId,
        battle.rightModelId,
        battle.vote,
        battle.winnerModelName,
        battle.samplingPhase,
        battle.samplingProbability.toFixed(8),
        battle.eligiblePairCount ? (1 / battle.eligiblePairCount).toFixed(8) : '',
        battle.analysisWeight.toFixed(8),
        battle.eligiblePairCount,
        battle.schedulerVersion,
        comparable && modelA ? modelA.rating.toFixed(4) : '',
        comparable && modelA ? modelA.ratingLower.toFixed(4) : '',
        comparable && modelA ? modelA.ratingUpper.toFixed(4) : '',
        comparable && modelA ? `${modelA.rankLower}-${modelA.rankUpper}` : '',
        comparable && modelB ? modelB.rating.toFixed(4) : '',
        comparable && modelB ? modelB.ratingLower.toFixed(4) : '',
        comparable && modelB ? modelB.ratingUpper.toFixed(4) : '',
        comparable && modelB ? `${modelB.rankLower}-${modelB.rankUpper}` : '',
        comparable,
      ];
    })
  );
};

export const buildPairwiseDimensionCsv = (bundle: PairwiseInsightBundle) =>
  rowsToCsv(
    ['Dimension', 'Value', 'ItemCount', 'BattleCount', 'GraphConnected', 'Sufficient', 'Leader', 'LeaderArenaScore'],
    bundle.dimensions.map(dimension => [
      dimension.dimension,
      dimension.value,
      dimension.itemCount,
      dimension.battleCount,
      dimension.connected,
      dimension.sufficient,
      dimension.leader,
      dimension.leaderScore?.toFixed(4) || '',
    ])
  );
