import { AggregatedResult, EvaluationItem, ModelOutput, RankingEntry, VoteRecord, VoteType } from './types';
import { DimensionValues, getDimensionEntries, getDimensionValuesForItem } from './dimensionUtils';
import {
  ArenaRankPromptItem,
  calculateRankPairwiseStats,
  calculateRankingAgreement,
  calculateArenaRankModelStats,
  formatRanking,
  getArenaRankModelOutputUrl,
  getRankingTieSummary,
  getModelOutputsForItem,
  isArenaRankVote,
  kendallTauBForRankings,
  resolveEvaluationItemPrompt,
  sortRanking
} from './rankingUtils';
import { countUniqueReviewers } from './taskResults';

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

export interface InsightModelNames {
  a: string;
  b: string;
}

export interface RawAbVoteRow {
  itemId: string;
  vote: VoteType;
  timestamp?: number;
  user?: string;
  reviewerKey?: string;
}

export interface AnalysisEvidence {
  itemId: string;
  prompt: string;
  dimensionValues: DimensionValues;
  mediaType?: EvaluationItem['type'];
  humanVotes: Array<{
    user: string;
    vote: VoteType;
    voteLabel: string;
    timestamp?: number;
  }>;
  aiJudgeRationale?: string;
  representativeOutputs: ModelOutput[];
  referenceUrls: string[];
  metrics: Record<string, number | string | null>;
}

export interface AbCaseInsight extends AnalysisEvidence {
  mode: 'ab';
  votes: Record<VoteType, number>;
  voters: string[];
  voterCount: number;
  winnerSide: VoteType;
  winnerLabel: string;
  agreementRate: number;
  marginVotes: number;
  marginRate: number;
  modelA: ModelOutput;
  modelB: ModelOutput;
}

export interface AbDimensionInsight {
  mode: 'ab';
  dimensionKey: string;
  dimensionValue: string;
  itemCount: number;
  totalVotes: number;
  votes: Record<VoteType, number>;
  winnerSide: VoteType;
  winnerLabel: string;
  agreementRate: number;
  marginRate: number;
  aShare: number;
  bShare: number;
  tieRate: number;
  nonTieAShare: number;
  confidenceInterval: ConfidenceInterval;
  pValue: number | null;
  smallSample: boolean;
}

export interface AbInsightBundle {
  mode: 'ab';
  models: InsightModelNames;
  summary: {
    itemCount: number;
    totalVotes: number;
    nonTieVotes: number;
    voterCount: number;
    votes: Record<VoteType, number>;
    winnerSide: VoteType;
    winnerLabel: string;
    winnerVotes: number;
    winnerRate: number;
    conclusion: string;
    aShare: number;
    bShare: number;
    tieRate: number;
    nonTieAShare: number;
    nonTieBShare: number;
    confidenceInterval: ConfidenceInterval;
    pValue: number | null;
    marginVotes: number;
    marginRate: number;
    averageAgreement: number | null;
    lowConsensusCount: number;
    krippendorffAlpha: number | null;
    smallSample: boolean;
  };
  cases: AbCaseInsight[];
  dimensions: AbDimensionInsight[];
  trend: Array<{ timestamp: number; aShare: number; bShare: number; tieRate: number; totalVotes: number }>;
}

export interface RankModelInsight {
  modelId: string;
  modelName: string;
  totalScore: number;
  normalizedScore: number;
  averageRank: number;
  firstPlaceCount: number;
  outrightFirstCount: number;
  coFirstCount: number;
  firstPlaceCredit: number;
  tieCount: number;
  tieRate: number;
  rankedCount: number;
  firstPlaceRate: number;
  topTierRate: number;
  confidenceInterval: ConfidenceInterval;
}

export interface PairwiseComparisonStat {
  modelAId: string;
  modelAName: string;
  modelBId: string;
  modelBName: string;
  aWins: number;
  bWins: number;
  ties: number;
  total: number;
  decisiveTotal: number;
  aShare: number;
  decisiveAShare: number;
  tieRate: number;
  confidenceInterval: ConfidenceInterval;
  pValue: number | null;
}

export interface RankCaseInsight extends AnalysisEvidence {
  mode: 'rank';
  voterCount: number;
  rankings: RankingEntry[][];
  consensusRanking: RankModelInsight[];
  kendallTau: number | null;
  relationAgreement: number | null;
  distinctionRate: number;
  tieBallots: number;
  allTieBallots: number;
  consensusLeaders: string[];
}

export interface RankDimensionInsight {
  mode: 'rank';
  dimensionKey: string;
  dimensionValue: string;
  itemCount: number;
  rankingRecords: number;
  modelStats: RankModelInsight[];
  leadingModel: string;
  leadingModels: string[];
  agreement: number | null;
  kendallTauB: number | null;
  distinctionRate: number;
  tieBallotRate: number;
  smallSample: boolean;
}

export interface RankInsightBundle {
  mode: 'rank';
  models: RankModelInsight[];
  summary: {
    itemCount: number;
    rankingRecords: number;
    voterCount: number;
    bestModel: string;
    bestModels: string[];
    averageKendallTau: number | null;
    averageRelationAgreement: number | null;
    averageDistinctionRate: number;
    tieBallots: number;
    allTieBallots: number;
    tieBallotRate: number;
    allTieBallotRate: number;
    averageTieGroupSize: number;
    lowConsensusCount: number;
    lowDistinctionCount: number;
    smallSample: boolean;
  };
  cases: RankCaseInsight[];
  dimensions: RankDimensionInsight[];
  pairwise: PairwiseComparisonStat[];
  trend: Array<{ timestamp: number; leaderScore: number; totalRankings: number }>;
}

export type InsightBundle = AbInsightBundle | RankInsightBundle;

const DEFAULT_MODELS: InsightModelNames = { a: 'Model A', b: 'Model B' };

export const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const safeDivide = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : 0;

export const formatPercent = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || Number.isNaN(value)
    ? '-'
    : `${(value * 100).toFixed(digits)}%`;

export const formatNumber = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || Number.isNaN(value) ? '-' : value.toFixed(digits);

export const formatPValue = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '样本不足';
  if (value < 0.001) return '<0.001';
  return value.toFixed(3);
};

export const getSignificanceLabel = (pValue: number | null | undefined) => {
  if (pValue === null || pValue === undefined || Number.isNaN(pValue)) return '样本不足';
  if (pValue < 0.01) return '差异高度显著';
  if (pValue < 0.05) return '差异显著';
  if (pValue < 0.1) return '存在趋势信号';
  return '未见显著差异';
};

export const wilsonInterval = (successes: number, total: number, z = 1.96): ConfidenceInterval => {
  if (total <= 0) return { lower: 0, upper: 0 };
  const phat = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return {
    lower: clamp01((centre - margin) / denominator),
    upper: clamp01((centre + margin) / denominator)
  };
};

const logChoose = (n: number, k: number) => {
  const effectiveK = Math.min(k, n - k);
  let value = 0;
  for (let i = 1; i <= effectiveK; i += 1) {
    value += Math.log(n - effectiveK + i) - Math.log(i);
  }
  return value;
};

export const binomialSignTestTwoSided = (winsA: number, winsB: number) => {
  const total = winsA + winsB;
  if (total <= 0) return null;
  const tail = Math.min(winsA, winsB);
  let probability = 0;
  for (let k = 0; k <= tail; k += 1) {
    probability += Math.exp(logChoose(total, k) - total * Math.log(2));
  }
  return Math.min(1, probability * 2);
};

const getWinnerSide = (votes: Record<VoteType, number>): VoteType => {
  const maxVotes = Math.max(votes.A, votes.B, votes.Tie);
  const winners = [
    votes.A === maxVotes ? 'A' : null,
    votes.B === maxVotes ? 'B' : null,
    votes.Tie === maxVotes ? 'Tie' : null
  ].filter(Boolean);
  return winners.length === 1 && winners[0] !== 'Tie' ? winners[0] as VoteType : 'Tie';
};

export const getVoteLabel = (vote: VoteType, models: InsightModelNames) => {
  if (vote === 'A') return models.a;
  if (vote === 'B') return models.b;
  return '平局';
};

const getAbConclusion = ({
  winnerSide,
  winnerLabel,
  pValue,
  smallSample
}: {
  winnerSide: VoteType;
  winnerLabel: string;
  pValue: number | null;
  smallSample: boolean;
}) => {
  if (smallSample) return '样本不足，当前结果只能作为方向信号';
  if (winnerSide === 'Tie') return '当前没有明确胜出模型';
  if (pValue !== null && pValue < 0.05) return `${winnerLabel} 显著胜出`;
  if (pValue !== null && pValue < 0.1) return `${winnerLabel} 呈现领先趋势`;
  return `${winnerLabel} 暂时领先，但未达到统计显著`;
};

const makeEmptyOutput = (modelId: string, modelName: string): ModelOutput => ({
  modelId,
  modelName,
  url: ''
});

export const getAbModelOutputs = (
  item: (Partial<EvaluationItem> & { id: string }) | undefined,
  models: InsightModelNames
) => {
  if (!item) {
    return {
      a: makeEmptyOutput('model-a', models.a),
      b: makeEmptyOutput('model-b', models.b)
    };
  }

  const outputs = getModelOutputsForItem(item as EvaluationItem, [
    { id: 'model-a', name: models.a },
    { id: 'model-b', name: models.b }
  ]);
  const normalize = (value?: string) => String(value || '').trim().toLowerCase();
  const byA = outputs.find(output => normalize(output.modelName) === normalize(models.a) || normalize(output.modelId) === 'model-a');
  const byB = outputs.find(output => normalize(output.modelName) === normalize(models.b) || normalize(output.modelId) === 'model-b');
  const outputA = byA || outputs[0] || makeEmptyOutput('model-a', models.a);
  const outputB = byB || outputs.find(output => output !== outputA) || outputs[1] || makeEmptyOutput('model-b', models.b);

  return {
    a: {
      modelId: outputA.modelId || 'model-a',
      modelName: outputA.modelName || models.a,
      url: outputA.url || (item as EvaluationItem).modelA_Url || ''
    },
    b: {
      modelId: outputB.modelId || 'model-b',
      modelName: outputB.modelName || models.b,
      url: outputB.url || (item as EvaluationItem).modelB_Url || ''
    }
  };
};

const getTimestamp = (value?: number) => (Number.isFinite(value) && value ? value as number : Date.now());

const buildKrippendorffAlphaNominal = (rows: RawAbVoteRow[]) => {
  const validRows = rows.filter(row => row.vote);
  if (validRows.length < 2) return null;

  const perItem = new Map<string, VoteType[]>();
  validRows.forEach(row => {
    perItem.set(row.itemId, [...(perItem.get(row.itemId) || []), row.vote]);
  });

  let observedDisagreements = 0;
  let observedPairs = 0;
  perItem.forEach(values => {
    for (let i = 0; i < values.length; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        observedPairs += 1;
        if (values[i] !== values[j]) observedDisagreements += 1;
      }
    }
  });
  if (observedPairs === 0) return null;

  const totals: Record<VoteType, number> = { A: 0, B: 0, Tie: 0 };
  validRows.forEach(row => {
    totals[row.vote] += 1;
  });
  const totalAnnotations = validRows.length;
  const expectedAgreement = Object.values(totals)
    .reduce((sum, count) => sum + Math.pow(count / totalAnnotations, 2), 0);
  const expectedDisagreement = 1 - expectedAgreement;
  if (expectedDisagreement <= 0) return null;

  return 1 - (observedDisagreements / observedPairs) / expectedDisagreement;
};

const buildAbTrend = (rows: RawAbVoteRow[]) => {
  const sortedRows = [...rows]
    .filter(row => row.vote)
    .sort((a, b) => getTimestamp(a.timestamp) - getTimestamp(b.timestamp));
  const counts: Record<VoteType, number> = { A: 0, B: 0, Tie: 0 };
  return sortedRows.map(row => {
    counts[row.vote] += 1;
    const total = counts.A + counts.B + counts.Tie;
    return {
      timestamp: getTimestamp(row.timestamp),
      aShare: safeDivide(counts.A, total),
      bShare: safeDivide(counts.B, total),
      tieRate: safeDivide(counts.Tie, total),
      totalVotes: total
    };
  });
};

const normalizeAggregatedCases = (
  items: Array<Partial<EvaluationItem> & { id: string }>,
  votes: VoteRecord[] = [],
  aggregatedData: AggregatedResult[] = [],
  rawVoteRows: RawAbVoteRow[] = [],
  modelNames: InsightModelNames
) => {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const rows: RawAbVoteRow[] = rawVoteRows.length
    ? rawVoteRows
    : votes
        .filter(vote => vote.vote)
        .map(vote => ({
          itemId: vote.itemId,
          vote: vote.vote as VoteType,
          timestamp: vote.timestamp,
          user: vote.user,
          reviewerKey: vote.reviewerKey,
        }));

  const aggregateMap = new Map<string, AggregatedResult>();
  aggregatedData.forEach(item => aggregateMap.set(item.itemId, item));

  if (!aggregateMap.size) {
    const grouped = new Map<string, AggregatedResult>();
    rows.forEach(row => {
      const current = grouped.get(row.itemId) || {
        itemId: row.itemId,
        prompt: resolveEvaluationItemPrompt(itemMap.get(row.itemId)),
        dimensionValues: getDimensionValuesForItem(itemMap.get(row.itemId) as any),
        votes: { A: 0, B: 0, Tie: 0 },
        voters: []
      };
      current.votes[row.vote] += 1;
      current.voters.push(row.user || 'Anonymous');
      grouped.set(row.itemId, current);
    });
    grouped.forEach((item, itemId) => aggregateMap.set(itemId, item));
  }

  items.forEach(item => {
    if (!aggregateMap.has(item.id) && rows.some(row => row.itemId === item.id)) {
      aggregateMap.set(item.id, {
        itemId: item.id,
        prompt: resolveEvaluationItemPrompt(item),
        dimensionValues: getDimensionValuesForItem(item as any),
        votes: { A: 0, B: 0, Tie: 0 },
        voters: []
      });
    }
  });

  const cases = Array.from(aggregateMap.values()).map(aggregate => {
    const item = itemMap.get(aggregate.itemId);
    const outputs = getAbModelOutputs(item, modelNames);
    const itemRows = rows.filter(row => row.itemId === aggregate.itemId);
    const voters = Array.from(new Set([
      ...(aggregate.voters || []),
      ...itemRows.map(row => row.user || 'Anonymous')
    ].filter(Boolean)));
    const reviewerKeys = itemRows.length
      ? Array.from(new Set(itemRows.map(row => row.reviewerKey || row.user || 'Anonymous')))
      : Array.from(new Set((aggregate.reviewerKeys?.length ? aggregate.reviewerKeys : aggregate.voters) || []));
    const dimensionValues = {
      ...(aggregate.dimensionValues || {}),
      ...getDimensionValuesForItem(item as any)
    };
    const total = aggregate.votes.A + aggregate.votes.B + aggregate.votes.Tie;
    const maxVotes = Math.max(aggregate.votes.A, aggregate.votes.B, aggregate.votes.Tie);
    const winnerSide = getWinnerSide(aggregate.votes);
    const marginVotes = Math.abs(aggregate.votes.A - aggregate.votes.B);
    const representativeOutputs = [outputs.a, outputs.b].filter(output => output.url);
    const humanVotes = itemRows.map(row => ({
      user: row.user || 'Anonymous',
      vote: row.vote,
      voteLabel: getVoteLabel(row.vote, modelNames),
      timestamp: row.timestamp
    }));

    return {
      mode: 'ab' as const,
      itemId: aggregate.itemId,
      prompt: aggregate.prompt || resolveEvaluationItemPrompt(item) || '',
      dimensionValues,
      mediaType: (item as EvaluationItem | undefined)?.type,
      humanVotes,
      aiJudgeRationale: '',
      representativeOutputs,
      referenceUrls: (item as EvaluationItem | undefined)?.referenceUrls || [],
      metrics: {
        totalVotes: total,
        agreementRate: safeDivide(maxVotes, total),
        marginRate: safeDivide(marginVotes, total)
      },
      votes: aggregate.votes,
      voters,
      voterCount: reviewerKeys.length,
      winnerSide,
      winnerLabel: getVoteLabel(winnerSide, modelNames),
      agreementRate: safeDivide(maxVotes, total),
      marginVotes,
      marginRate: safeDivide(marginVotes, total),
      modelA: outputs.a,
      modelB: outputs.b
    };
  });

  return { cases, rows };
};

export const buildAbInsights = ({
  items,
  votes = [],
  aggregatedData = [],
  rawVoteRows = [],
  modelNames = DEFAULT_MODELS
}: {
  items: Array<Partial<EvaluationItem> & { id: string }>;
  votes?: VoteRecord[];
  aggregatedData?: AggregatedResult[];
  rawVoteRows?: RawAbVoteRow[];
  modelNames?: InsightModelNames;
}): AbInsightBundle => {
  const models = {
    a: modelNames.a || DEFAULT_MODELS.a,
    b: modelNames.b || DEFAULT_MODELS.b
  };
  const { cases, rows } = normalizeAggregatedCases(items, votes, aggregatedData, rawVoteRows, models);
  const totals = cases.reduce<Record<VoteType, number>>((acc, item) => {
    acc.A += item.votes.A;
    acc.B += item.votes.B;
    acc.Tie += item.votes.Tie;
    return acc;
  }, { A: 0, B: 0, Tie: 0 });
  const totalVotes = totals.A + totals.B + totals.Tie;
  const nonTieVotes = totals.A + totals.B;
  const voterCount = rows.length
    ? new Set(rows.map(row => row.reviewerKey || row.user || 'Anonymous')).size
    : new Set(cases.flatMap(item => item.voters)).size;
  const averageAgreement = cases.length
    ? cases.reduce((sum, item) => sum + item.agreementRate, 0) / cases.length
    : null;

  const dimensions = buildAbDimensionInsights(cases, models);
  const winnerSide = getWinnerSide(totals);
  const winnerLabel = getVoteLabel(winnerSide, models);
  const winnerVotes = winnerSide === 'A'
    ? totals.A
    : winnerSide === 'B'
      ? totals.B
      : Math.max(totals.A, totals.B, totals.Tie);
  const pValue = binomialSignTestTwoSided(totals.A, totals.B);
  const smallSample = cases.length < 5 || totalVotes < 10;

  return {
    mode: 'ab',
    models,
    summary: {
      itemCount: cases.length,
      totalVotes,
      nonTieVotes,
      voterCount,
      votes: totals,
      winnerSide,
      winnerLabel,
      winnerVotes,
      winnerRate: safeDivide(winnerVotes, totalVotes),
      conclusion: getAbConclusion({ winnerSide, winnerLabel, pValue, smallSample }),
      aShare: safeDivide(totals.A, totalVotes),
      bShare: safeDivide(totals.B, totalVotes),
      tieRate: safeDivide(totals.Tie, totalVotes),
      nonTieAShare: safeDivide(totals.A, nonTieVotes),
      nonTieBShare: safeDivide(totals.B, nonTieVotes),
      confidenceInterval: wilsonInterval(totals.A, nonTieVotes),
      pValue,
      marginVotes: Math.abs(totals.A - totals.B),
      marginRate: safeDivide(Math.abs(totals.A - totals.B), totalVotes),
      averageAgreement,
      lowConsensusCount: cases.filter(item => item.agreementRate < 0.6).length,
      krippendorffAlpha: buildKrippendorffAlphaNominal(rows),
      smallSample
    },
    cases: cases.sort((a, b) => a.itemId.localeCompare(b.itemId)),
    dimensions,
    trend: buildAbTrend(rows)
  };
};

const buildAbDimensionInsights = (cases: AbCaseInsight[], models: InsightModelNames): AbDimensionInsight[] => {
  const grouped = new Map<string, { key: string; value: string; cases: AbCaseInsight[] }>();

  cases.forEach(item => {
    getDimensionEntries(item.dimensionValues).forEach(([dimensionKey, dimensionValue]) => {
      const groupKey = `${dimensionKey}::${dimensionValue}`;
      const group = grouped.get(groupKey) || { key: dimensionKey, value: dimensionValue, cases: [] };
      group.cases.push(item);
      grouped.set(groupKey, group);
    });
  });

  return Array.from(grouped.values())
    .map(group => {
      const votes = group.cases.reduce<Record<VoteType, number>>((acc, item) => {
        acc.A += item.votes.A;
        acc.B += item.votes.B;
        acc.Tie += item.votes.Tie;
        return acc;
      }, { A: 0, B: 0, Tie: 0 });
      const totalVotes = votes.A + votes.B + votes.Tie;
      const nonTieVotes = votes.A + votes.B;
      const winnerSide = getWinnerSide(votes);
      const maxVotes = Math.max(votes.A, votes.B, votes.Tie);

      return {
        mode: 'ab' as const,
        dimensionKey: group.key,
        dimensionValue: group.value,
        itemCount: new Set(group.cases.map(item => item.itemId)).size,
        totalVotes,
        votes,
        winnerSide,
        winnerLabel: getVoteLabel(winnerSide, models),
        agreementRate: safeDivide(maxVotes, totalVotes),
        marginRate: safeDivide(Math.abs(votes.A - votes.B), totalVotes),
        aShare: safeDivide(votes.A, totalVotes),
        bShare: safeDivide(votes.B, totalVotes),
        tieRate: safeDivide(votes.Tie, totalVotes),
        nonTieAShare: safeDivide(votes.A, nonTieVotes),
        confidenceInterval: wilsonInterval(votes.A, nonTieVotes),
        pValue: binomialSignTestTwoSided(votes.A, votes.B),
        smallSample: group.cases.length < 5 || totalVotes < 10
      };
    })
    .sort((a, b) => a.dimensionKey.localeCompare(b.dimensionKey) || b.totalVotes - a.totalVotes);
};

const toRankModelInsights = (votes: VoteRecord[]): RankModelInsight[] => {
  const stats = calculateArenaRankModelStats(votes);
  return stats.map(stat => ({
    ...stat,
    firstPlaceRate: safeDivide(stat.firstPlaceCredit, stat.rankedCount),
    topTierRate: safeDivide(stat.firstPlaceCount, stat.rankedCount),
    confidenceInterval: wilsonInterval(stat.firstPlaceCount, stat.rankedCount)
  }));
};

export const kendallTauForRankings = kendallTauBForRankings;

const buildPairwiseStats = (votes: VoteRecord[], models: { id: string; name: string }[]) => {
  return calculateRankPairwiseStats(votes, models).map(pair => ({
    ...pair,
    aShare: pair.dominanceScore,
    confidenceInterval: wilsonInterval(pair.aWins, pair.decisiveTotal),
    pValue: pair.decisiveTotal ? binomialSignTestTwoSided(pair.aWins, pair.bWins) : null
  }));
};

const buildRankTrend = (votes: VoteRecord[]) => {
  const sorted = [...votes].filter(isArenaRankVote).sort((a, b) => getTimestamp(a.timestamp) - getTimestamp(b.timestamp));
  const running: VoteRecord[] = [];
  return sorted.map(vote => {
    running.push(vote);
    const leader = calculateArenaRankModelStats(running)[0];
    return {
      timestamp: getTimestamp(vote.timestamp),
      leaderScore: (leader?.normalizedScore || 0) * 100,
      totalRankings: running.length
    };
  });
};

export const buildRankInsights = ({
  items,
  votes = [],
  models = []
}: {
  items: ArenaRankPromptItem[];
  votes?: VoteRecord[];
  models?: { id: string; name: string }[];
}): RankInsightBundle => {
  const rankVotes = votes.filter(isArenaRankVote);
  const modelStats = toRankModelInsights(rankVotes);
  const modelList = models.length
    ? models
    : modelStats.map(stat => ({ id: stat.modelId, name: stat.modelName }));
  const itemMap = new Map(items.map(item => [item.id, item]));
  const groupedVotes = new Map<string, VoteRecord[]>();
  rankVotes.forEach(vote => groupedVotes.set(vote.itemId, [...(groupedVotes.get(vote.itemId) || []), vote]));

  const cases: RankCaseInsight[] = Array.from(groupedVotes.entries()).map(([itemId, itemVotes]) => {
    const item = itemMap.get(itemId);
    const rankings = itemVotes.map(vote => sortRanking(vote.ranking));
    const consensusRanking = toRankModelInsights(itemVotes);
    const representativeOutputs = consensusRanking
      .map(entry => ({
        modelId: entry.modelId,
        modelName: entry.modelName,
        url: getArenaRankModelOutputUrl(item, entry, modelList)
      }))
      .filter(output => output.url);
    const agreement = calculateRankingAgreement(rankings);
    const tieSummaries = rankings.map(getRankingTieSummary);
    const leaderScore = consensusRanking[0]?.normalizedScore;
    const consensusLeaders = leaderScore === undefined
      ? []
      : consensusRanking
          .filter(model => Math.abs(model.normalizedScore - leaderScore) < 1e-9)
          .map(model => model.modelName);

    return {
      mode: 'rank',
      itemId,
      prompt: resolveEvaluationItemPrompt(item) || '',
      dimensionValues: getDimensionValuesForItem(item as any),
      mediaType: (item as EvaluationItem | undefined)?.type,
      humanVotes: itemVotes.map(vote => ({
        user: vote.user || 'Anonymous',
        vote: 'Tie' as VoteType,
        voteLabel: formatRanking(vote.ranking),
        timestamp: vote.timestamp
      })),
      aiJudgeRationale: '',
      representativeOutputs,
      referenceUrls: (item as EvaluationItem | undefined)?.referenceUrls || [],
      metrics: {
        voterCount: countUniqueReviewers(itemVotes),
        kendallTauB: agreement.kendallTauB,
        relationAgreement: agreement.relationAgreement,
        distinctionRate: agreement.distinctionRate,
        topModel: consensusLeaders.join(' = ')
      },
      voterCount: countUniqueReviewers(itemVotes),
      rankings,
      consensusRanking,
      kendallTau: agreement.kendallTauB,
      relationAgreement: agreement.relationAgreement,
      distinctionRate: agreement.distinctionRate,
      tieBallots: tieSummaries.filter(summary => summary.hasTie).length,
      allTieBallots: tieSummaries.filter(summary => summary.allTied).length,
      consensusLeaders,
    };
  });

  const dimensions = buildRankDimensionInsights(cases, rankVotes);
  const validTaus = cases.map(item => item.kendallTau).filter((value): value is number => value !== null);
  const validRelations = cases.map(item => item.relationAgreement).filter((value): value is number => value !== null);
  const ballotTieSummaries = rankVotes.map(vote => getRankingTieSummary(vote.ranking));
  const tiedTierSizes = rankVotes.flatMap(vote =>
    sortRanking(vote.ranking).reduce<number[]>((sizes, entry, index, ranking) => {
      if (index > 0 && ranking[index - 1].rank === entry.rank) return sizes;
      const size = ranking.filter(candidate => candidate.rank === entry.rank).length;
      if (size > 1) sizes.push(size);
      return sizes;
    }, []),
  );
  const bestScore = modelStats[0]?.normalizedScore;
  const bestModels = bestScore === undefined
    ? []
    : modelStats.filter(model => Math.abs(model.normalizedScore - bestScore) < 1e-9).map(model => model.modelName);

  return {
    mode: 'rank',
    models: modelStats,
    summary: {
      itemCount: cases.length,
      rankingRecords: rankVotes.length,
      voterCount: countUniqueReviewers(rankVotes),
      bestModel: bestModels.join(' = '),
      bestModels,
      averageKendallTau: validTaus.length ? validTaus.reduce((sum, value) => sum + value, 0) / validTaus.length : null,
      averageRelationAgreement: validRelations.length ? validRelations.reduce((sum, value) => sum + value, 0) / validRelations.length : null,
      averageDistinctionRate: cases.length ? cases.reduce((sum, item) => sum + item.distinctionRate, 0) / cases.length : 0,
      tieBallots: ballotTieSummaries.filter(summary => summary.hasTie).length,
      allTieBallots: ballotTieSummaries.filter(summary => summary.allTied).length,
      tieBallotRate: safeDivide(ballotTieSummaries.filter(summary => summary.hasTie).length, rankVotes.length),
      allTieBallotRate: safeDivide(ballotTieSummaries.filter(summary => summary.allTied).length, rankVotes.length),
      averageTieGroupSize: tiedTierSizes.length ? tiedTierSizes.reduce((sum, size) => sum + size, 0) / tiedTierSizes.length : 0,
      lowConsensusCount: cases.filter(item => item.relationAgreement !== null && item.relationAgreement < 0.6).length,
      lowDistinctionCount: cases.filter(item => item.distinctionRate < 0.5).length,
      smallSample: cases.length < 5 || rankVotes.length < 10
    },
    cases: cases.sort((a, b) => a.itemId.localeCompare(b.itemId)),
    dimensions,
    pairwise: buildPairwiseStats(rankVotes, modelList),
    trend: buildRankTrend(rankVotes)
  };
};

const buildRankDimensionInsights = (cases: RankCaseInsight[], votes: VoteRecord[]): RankDimensionInsight[] => {
  const grouped = new Map<string, { key: string; value: string; cases: RankCaseInsight[]; votes: VoteRecord[] }>();

  cases.forEach(item => {
    getDimensionEntries(item.dimensionValues).forEach(([dimensionKey, dimensionValue]) => {
      const groupKey = `${dimensionKey}::${dimensionValue}`;
      const group = grouped.get(groupKey) || { key: dimensionKey, value: dimensionValue, cases: [], votes: [] };
      group.cases.push(item);
      group.votes.push(...votes.filter(vote => vote.itemId === item.itemId));
      grouped.set(groupKey, group);
    });
  });

  return Array.from(grouped.values())
    .map(group => {
      const modelStats = toRankModelInsights(group.votes);
      const taus = group.cases.map(item => item.kendallTau).filter((value): value is number => value !== null);
      const relations = group.cases.map(item => item.relationAgreement).filter((value): value is number => value !== null);
      const leaderScore = modelStats[0]?.normalizedScore;
      const leadingModels = leaderScore === undefined
        ? []
        : modelStats.filter(model => Math.abs(model.normalizedScore - leaderScore) < 1e-9).map(model => model.modelName);
      return {
        mode: 'rank' as const,
        dimensionKey: group.key,
        dimensionValue: group.value,
        itemCount: group.cases.length,
        rankingRecords: group.votes.length,
        modelStats,
        leadingModel: leadingModels.join(' = '),
        leadingModels,
        agreement: relations.length ? relations.reduce((sum, value) => sum + value, 0) / relations.length : null,
        kendallTauB: taus.length ? taus.reduce((sum, value) => sum + value, 0) / taus.length : null,
        distinctionRate: group.cases.length ? group.cases.reduce((sum, item) => sum + item.distinctionRate, 0) / group.cases.length : 0,
        tieBallotRate: safeDivide(group.cases.reduce((sum, item) => sum + item.tieBallots, 0), group.votes.length),
        smallSample: group.cases.length < 5 || group.votes.length < 10
      };
    })
    .sort((a, b) => a.dimensionKey.localeCompare(b.dimensionKey) || b.rankingRecords - a.rankingRecords);
};

export const csvEscape = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const rowsToCsv = (headers: string[], rows: any[][]) =>
  [headers.join(','), ...rows.map(row => row.map(csvEscape).join(','))].join('\n');

export const buildInsightSummaryCsv = (bundle: InsightBundle) => {
  if (bundle.mode === 'rank') {
    return rowsToCsv(
      ['Model', 'NormalizedBorda', 'TotalScore', 'AverageMidRank', 'OutrightFirstCount', 'CoFirstCount', 'FirstPlaceCredit', 'FirstPlaceShare', 'TopTierCount', 'TieCount', 'TieRate', 'RankedCount', 'CI95_Lower', 'CI95_Upper'],
      bundle.models.map(model => [
        model.modelName,
        model.normalizedScore.toFixed(4),
        model.totalScore,
        model.averageRank.toFixed(4),
        model.outrightFirstCount,
        model.coFirstCount,
        model.firstPlaceCredit.toFixed(4),
        model.firstPlaceRate.toFixed(4),
        model.firstPlaceCount,
        model.tieCount,
        model.tieRate.toFixed(4),
        model.rankedCount,
        model.confidenceInterval.lower.toFixed(4),
        model.confidenceInterval.upper.toFixed(4)
      ])
    );
  }

  return rowsToCsv(
    ['Metric', 'Value'],
    [
      ['ModelA', bundle.models.a],
      ['ModelB', bundle.models.b],
      ['WinnerModelName', bundle.summary.winnerLabel],
      ['WinnerSide', bundle.summary.winnerSide],
      ['WinnerVotes', bundle.summary.winnerVotes],
      ['WinnerRate', bundle.summary.winnerRate.toFixed(4)],
      ['Conclusion', bundle.summary.conclusion],
      ['ItemCount', bundle.summary.itemCount],
      ['TotalVotes', bundle.summary.totalVotes],
      ['NonTieVotes', bundle.summary.nonTieVotes],
      ['Votes_A', bundle.summary.votes.A],
      ['Votes_B', bundle.summary.votes.B],
      ['Votes_Tie', bundle.summary.votes.Tie],
      ['NonTie_A_Share', bundle.summary.nonTieAShare.toFixed(4)],
      ['NonTie_B_Share', bundle.summary.nonTieBShare.toFixed(4)],
      ['Wilson95_Lower', bundle.summary.confidenceInterval.lower.toFixed(4)],
      ['Wilson95_Upper', bundle.summary.confidenceInterval.upper.toFixed(4)],
      ['SignTestPValue', bundle.summary.pValue ?? ''],
      ['Significance', getSignificanceLabel(bundle.summary.pValue)],
      ['AverageAgreement', bundle.summary.averageAgreement ?? ''],
      ['KrippendorffAlpha', bundle.summary.krippendorffAlpha ?? ''],
      ['SmallSample', bundle.summary.smallSample ? 'yes' : 'no']
    ]
  );
};

export const buildInsightDimensionCsv = (bundle: InsightBundle) => {
  if (bundle.mode === 'rank') {
    return rowsToCsv(
      ['Dimension', 'Value', 'ItemCount', 'RankingRecords', 'LeadingModels', 'RelationAgreement', 'KendallTauB', 'DistinctionRate', 'TieBallotRate', 'SmallSample', 'ModelStats'],
      bundle.dimensions.map(item => [
        item.dimensionKey,
        item.dimensionValue,
        item.itemCount,
        item.rankingRecords,
        item.leadingModel,
        item.agreement ?? '',
        item.kendallTauB ?? '',
        item.distinctionRate.toFixed(4),
        item.tieBallotRate.toFixed(4),
        item.smallSample ? 'yes' : 'no',
        item.modelStats.map(stat => `${stat.modelName}: normalized=${stat.normalizedScore.toFixed(4)}, score=${stat.totalScore}, avgMidRank=${stat.averageRank.toFixed(4)}, outrightFirst=${stat.outrightFirstCount}, coFirst=${stat.coFirstCount}`).join(' | ')
      ])
    );
  }

  return rowsToCsv(
    ['Dimension', 'Value', 'ItemCount', 'TotalVotes', 'Votes_A', 'Votes_B', 'Votes_Tie', 'Winner', 'AgreementRate', 'MarginRate', 'NonTie_A_Share', 'CI95_Lower', 'CI95_Upper', 'PValue', 'SmallSample'],
    bundle.dimensions.map(item => [
      item.dimensionKey,
      item.dimensionValue,
      item.itemCount,
      item.totalVotes,
      item.votes.A,
      item.votes.B,
      item.votes.Tie,
      item.winnerLabel,
      item.agreementRate.toFixed(4),
      item.marginRate.toFixed(4),
      item.nonTieAShare.toFixed(4),
      item.confidenceInterval.lower.toFixed(4),
      item.confidenceInterval.upper.toFixed(4),
      item.pValue ?? '',
      item.smallSample ? 'yes' : 'no'
    ])
  );
};

export const buildRankPairwiseCsv = (bundle: RankInsightBundle) => rowsToCsv(
  [
    'ModelA',
    'ModelB',
    'Wins_A',
    'Ties',
    'Wins_B',
    'TotalRelations',
    'DecisiveRelations',
    'DominanceScore',
    'Decisive_A_Share',
    'TieRate',
    'Wilson95_Lower',
    'Wilson95_Upper',
    'SignTestPValue'
  ],
  bundle.pairwise.map(pair => [
    pair.modelAName,
    pair.modelBName,
    pair.aWins,
    pair.ties,
    pair.bWins,
    pair.total,
    pair.decisiveTotal,
    pair.aShare.toFixed(4),
    pair.decisiveAShare.toFixed(4),
    pair.tieRate.toFixed(4),
    pair.decisiveTotal ? pair.confidenceInterval.lower.toFixed(4) : '',
    pair.decisiveTotal ? pair.confidenceInterval.upper.toFixed(4) : '',
    pair.pValue ?? ''
  ])
);

export const buildEvidenceJson = (bundle: InsightBundle) =>
  JSON.stringify({
    exportedAt: new Date().toISOString(),
    mode: bundle.mode,
    summary: bundle.summary,
    dimensions: bundle.dimensions,
    pairwise: bundle.mode === 'rank' ? bundle.pairwise : undefined,
    cases: bundle.cases.map(item => ({
      itemId: item.itemId,
      prompt: item.prompt,
      dimensionValues: item.dimensionValues,
      humanVotes: item.humanVotes,
      aiJudgeRationale: item.aiJudgeRationale || null,
      representativeOutputs: item.representativeOutputs,
      referenceUrls: item.referenceUrls,
      metrics: item.metrics
    }))
  }, null, 2);
