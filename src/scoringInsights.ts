import { EvalDimension, EvaluationConfig, EvaluationItem, ModelOutput, VoteRecord } from './types';
import { getDimensionValuesForItem } from './dimensionUtils';
import { getModelOutputsForItem, resolveEvaluationItemPrompt } from './rankingUtils';
import { normalizeDimensions, scoreDimensionWeightTotal } from './evaluationMethods';

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
  };
  models: PairwiseModelSummary[];
  matchups: PairwiseMatchupSummary[];
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
  const scoreDimensions = getScoreDimensions(config);
  const rationaleDimensions = getRationaleDimensions(config);
  const itemMap = new Map(items.map(item => [item.id, item]));
  const voters = new Set(votes.map(vote => vote.user || 'Anonymous'));
  const modelScores = new Map<string, number[]>();
  const modelDimensionScores = new Map<string, Map<string, number[]>>();
  const caseMap = new Map<string, ScoreCaseSummary>();

  models.forEach(model => {
    modelScores.set(model.id, []);
    modelDimensionScores.set(model.id, new Map(scoreDimensions.map(dimension => [dimension.id, []])));
  });

  votes.forEach(vote => {
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

export const buildPairwiseInsights = ({
  items,
  votes,
  models
}: {
  items: Array<Partial<EvaluationItem> & { id: string }>;
  votes: VoteRecord[];
  models: { id: string; name: string }[];
}): PairwiseInsightBundle => {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const modelStats = new Map<string, PairwiseModelSummary>();
  const matchups = new Map<string, PairwiseMatchupSummary>();
  const cases = new Map<string, PairwiseInsightBundle['cases'][number]>();
  const voters = new Set(votes.map(vote => vote.user || 'Anonymous'));

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

  votes.forEach(vote => {
    const pair = vote.pairContext;
    if (!pair || !vote.vote) return;
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

    if (vote.vote === 'A') {
      matchup.modelAWins += 1;
      leftStat.wins += 1;
      rightStat.losses += 1;
    } else if (vote.vote === 'B') {
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
    caseRow.votes[vote.vote] += 1;
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
      comparisonCount: votes.filter(vote => vote.pairContext && vote.vote).length,
      topModelName: modelsSorted[0]?.modelName || '-',
      topWinRate: modelsSorted[0]?.nonTieWinRate || 0
    },
    models: modelsSorted,
    matchups: Array.from(matchups.values()).sort((a, b) => b.total - a.total),
    cases: Array.from(cases.values()).sort((a, b) => a.itemId.localeCompare(b.itemId))
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
    ['ModelID', 'ModelName', 'Wins', 'Losses', 'Ties', 'Total', 'WinRate', 'NonTieWinRate'],
    bundle.models.map(model => [
      model.modelId,
      model.modelName,
      model.wins,
      model.losses,
      model.ties,
      model.total,
      model.winRate.toFixed(4),
      model.nonTieWinRate.toFixed(4)
    ])
  );

export const buildPairwiseCaseCsv = (bundle: PairwiseInsightBundle) =>
  rowsToCsv(
    ['ItemID', 'OriginalItemID', 'Prompt', 'ModelA', 'ModelB', 'Votes_A', 'Votes_B', 'Votes_Tie', 'Winner'],
    bundle.cases.map(item => [
      item.itemId,
      item.originalItemId,
      item.prompt,
      item.modelAName,
      item.modelBName,
      item.votes.A,
      item.votes.B,
      item.votes.Tie,
      item.winner
    ])
  );
