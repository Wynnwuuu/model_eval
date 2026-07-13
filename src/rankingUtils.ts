import { EvaluationItem, ModelOutput, RankingEntry, VoteRecord } from './types';

export interface ArenaRankModelStat {
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
}

export interface ArenaRankCaseSummary {
  itemId: string;
  prompt?: string;
  voterCount: number;
  ranking: ArenaRankModelStat[];
  relationAgreement: number | null;
  kendallTauB: number | null;
  distinctionRate: number;
  tieBallots: number;
  allTieBallots: number;
}

export interface RankingTier {
  rank: number;
  startPosition: number;
  size: number;
  midRank: number;
  entries: RankingEntry[];
}

export interface RankingEntryMetrics {
  rank: number;
  midRank: number;
  tieSize: number;
  bordaScore: number;
  normalizedBorda: number;
}

export interface RankingTieSummary {
  hasTie: boolean;
  allTied: boolean;
  tieGroupCount: number;
  topTieSize: number;
  maxTieGroupSize: number;
  tiedModelCount: number;
  tiePairCount: number;
  totalPairCount: number;
  distinctionRate: number;
}

export interface RankPairwiseStat {
  modelAId: string;
  modelAName: string;
  modelBId: string;
  modelBName: string;
  aWins: number;
  bWins: number;
  ties: number;
  total: number;
  decisiveTotal: number;
  dominanceScore: number;
  decisiveAShare: number;
  tieRate: number;
}

export interface RankingAgreement {
  kendallTauB: number | null;
  relationAgreement: number | null;
  distinctionRate: number;
}

export interface RankingValidation {
  valid: boolean;
  ranking: RankingEntry[];
  errors: string[];
}

export type ArenaRankPromptItem = Partial<EvaluationItem> & {
  id: string;
  originalData?: Record<string, any>;
};

const PROMPT_KEYS = ['prompt', 'Prompt', 'Video Prompt', 'input', 'Input', 'question', 'Question'];

const resolvePromptFromRecord = (record?: Record<string, any>): string => {
  if (!record) return '';

  for (const key of PROMPT_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  const lowerPromptKey = Object.keys(record).find(key => {
    const normalized = key.toLowerCase();
    return normalized === 'prompt' || normalized.includes('prompt') || normalized === 'input' || normalized === 'question';
  });
  const value = lowerPromptKey ? record[lowerPromptKey] : undefined;
  return typeof value === 'string' ? value.trim() : '';
};

export const resolveEvaluationItemPrompt = (item?: Partial<EvaluationItem> & Record<string, any>): string => {
  if (!item) return '';
  if (typeof item.prompt === 'string' && item.prompt.trim()) return item.prompt.trim();

  const inputPrompt = resolvePromptFromRecord(item.inputs);
  if (inputPrompt) return inputPrompt;

  const originalPrompt = resolvePromptFromRecord(item.originalData);
  if (originalPrompt) return originalPrompt;

  return resolvePromptFromRecord(item);
};

export const getModelOutputsForItem = (
  item?: EvaluationItem,
  models: { id: string; name: string }[] = []
): ModelOutput[] => {
  if (!item) return [];
  if (item.modelOutputs?.length) {
    return item.modelOutputs
      .filter(output => output.url)
      .map((output, index) => ({
        modelId: output.modelId || models[index]?.id || `model-${index}`,
        modelName: output.modelName || models[index]?.name || `Model ${index + 1}`,
        url: output.url
      }));
  }

  const fallbackModels = models.length > 0
    ? models
    : [
        { id: 'model-a', name: 'Model A' },
        { id: 'model-b', name: 'Model B' }
      ];

  return fallbackModels
    .map((model, index) => {
      const originalData = (item as any).originalData || {};
      const url = index === 0
        ? item.modelA_Url
        : index === 1
          ? item.modelB_Url
          : originalData[model.name] || originalData[model.id] || '';

      return {
        modelId: model.id || `model-${index}`,
        modelName: model.name || `Model ${index + 1}`,
        url
      };
    })
    .filter(output => output.url);
};

const normalizeModelLookupKey = (value?: string) => String(value || '').trim().toLowerCase();

export const getArenaRankModelOutputUrl = (
  item: ArenaRankPromptItem | undefined,
  entry: Pick<RankingEntry, 'modelId' | 'modelName'> | Pick<ArenaRankModelStat, 'modelId' | 'modelName'>,
  models: { id: string; name: string }[] = []
): string => {
  if (!item) return '';

  const outputs = getModelOutputsForItem(item as EvaluationItem, models);
  const byModelId = new Map<string, string>();
  const byModelName = new Map<string, string>();

  outputs.forEach(output => {
    if (!output.url) return;
    const modelIdKey = normalizeModelLookupKey(output.modelId);
    const modelNameKey = normalizeModelLookupKey(output.modelName);
    if (modelIdKey && !byModelId.has(modelIdKey)) byModelId.set(modelIdKey, output.url);
    if (modelNameKey && !byModelName.has(modelNameKey)) byModelName.set(modelNameKey, output.url);
  });

  return (
    byModelId.get(normalizeModelLookupKey(entry.modelId)) ||
    byModelName.get(normalizeModelLookupKey(entry.modelName)) ||
    ''
  );
};

export const normalizeRanking = (ranking: RankingEntry[] = []): RankingEntry[] => {
  const seen = new Set<string>();
  const valid = ranking
    .map((entry, index) => ({ entry, index, numericRank: Number(entry.rank) }))
    .filter(({ entry, numericRank }) => {
      const modelId = String(entry.modelId || '').trim();
      if (!modelId || seen.has(modelId) || !Number.isFinite(numericRank) || numericRank <= 0) return false;
      seen.add(modelId);
      return true;
    })
    .sort((a, b) => a.numericRank - b.numericRank || a.index - b.index);

  const normalized: RankingEntry[] = [];
  let position = 0;
  for (let index = 0; index < valid.length;) {
    const rawRank = valid[index].numericRank;
    const group: typeof valid = [];
    while (index < valid.length && valid[index].numericRank === rawRank) {
      group.push(valid[index]);
      index += 1;
    }
    const competitionRank = position + 1;
    group.forEach(({ entry }) => normalized.push({
      modelId: String(entry.modelId),
      modelName: String(entry.modelName || entry.modelId),
      rank: competitionRank,
    }));
    position += group.length;
  }
  return normalized;
};

export const validateRanking = (
  ranking: RankingEntry[] = [],
  expectedModelIds: string[] = [],
): RankingValidation => {
  const errors: string[] = [];
  const rawIds = ranking.map(entry => String(entry?.modelId || '').trim()).filter(Boolean);
  const uniqueIds = new Set(rawIds);
  if (uniqueIds.size !== rawIds.length) errors.push('每个模型在排名中必须且只能出现一次');
  if (ranking.some(entry => !entry?.modelId || !Number.isFinite(Number(entry.rank)) || Number(entry.rank) <= 0)) {
    errors.push('排名包含缺失模型或非法名次');
  }

  if (expectedModelIds.length) {
    const expected = new Set(expectedModelIds.map(String));
    const missing = Array.from(expected).filter(id => !uniqueIds.has(id));
    const unexpected = Array.from(uniqueIds).filter(id => !expected.has(id));
    if (missing.length) errors.push(`排名缺少模型: ${missing.join(', ')}`);
    if (unexpected.length) errors.push(`排名包含未知模型: ${unexpected.join(', ')}`);
  }

  return { valid: errors.length === 0, ranking: normalizeRanking(ranking), errors };
};

export const sortRanking = (ranking: RankingEntry[] = []) => normalizeRanking(ranking);

export const rankingToTiers = (ranking: RankingEntry[] = []): RankingTier[] => {
  const normalized = normalizeRanking(ranking);
  const tiers: RankingTier[] = [];
  normalized.forEach(entry => {
    const current = tiers[tiers.length - 1];
    if (current?.rank === entry.rank) {
      current.entries.push(entry);
      current.size += 1;
      current.midRank = current.startPosition + (current.size - 1) / 2;
      return;
    }
    tiers.push({
      rank: entry.rank,
      startPosition: entry.rank,
      size: 1,
      midRank: entry.rank,
      entries: [entry],
    });
  });
  return tiers;
};

export const tiersToRankingEntries = (
  tiers: Array<Array<Pick<RankingEntry, 'modelId' | 'modelName'>>>,
): RankingEntry[] => {
  const entries: RankingEntry[] = [];
  let position = 0;
  tiers.filter(tier => tier.length > 0).forEach(tier => {
    const rank = position + 1;
    tier.forEach(entry => entries.push({
      modelId: String(entry.modelId),
      modelName: String(entry.modelName || entry.modelId),
      rank,
    }));
    position += tier.length;
  });
  return entries;
};

export const isArenaRankVote = (vote: VoteRecord) =>
  Array.isArray(vote.ranking) && vote.ranking.length > 0;

export const getBordaScore = (rank: number, candidateCount: number, tieSize = 1) =>
  Math.max(candidateCount - rank + 1 - (Math.max(tieSize, 1) - 1) / 2, 0);

export const getNormalizedBordaScore = (bordaScore: number, candidateCount: number) =>
  candidateCount <= 1 ? 1 : Math.max(0, Math.min(1, (bordaScore - 1) / (candidateCount - 1)));

export const getRankingEntryMetrics = (
  ranking: RankingEntry[] = [],
  modelId: string,
): RankingEntryMetrics | undefined => {
  const tiers = rankingToTiers(ranking);
  const candidateCount = tiers.reduce((sum, tier) => sum + tier.size, 0);
  const tier = tiers.find(candidate => candidate.entries.some(entry => entry.modelId === modelId));
  if (!tier) return undefined;
  const bordaScore = getBordaScore(tier.rank, candidateCount, tier.size);
  return {
    rank: tier.rank,
    midRank: tier.midRank,
    tieSize: tier.size,
    bordaScore,
    normalizedBorda: getNormalizedBordaScore(bordaScore, candidateCount),
  };
};

export const getRankingTieSummary = (ranking: RankingEntry[] = []): RankingTieSummary => {
  const tiers = rankingToTiers(ranking);
  const candidateCount = tiers.reduce((sum, tier) => sum + tier.size, 0);
  const totalPairCount = candidateCount > 1 ? candidateCount * (candidateCount - 1) / 2 : 0;
  const tiedTiers = tiers.filter(tier => tier.size > 1);
  const tiePairCount = tiedTiers.reduce((sum, tier) => sum + tier.size * (tier.size - 1) / 2, 0);
  return {
    hasTie: tiedTiers.length > 0,
    allTied: candidateCount > 1 && tiers.length === 1,
    tieGroupCount: tiedTiers.length,
    topTieSize: tiers[0]?.size || 0,
    maxTieGroupSize: tiedTiers.length ? Math.max(...tiedTiers.map(tier => tier.size)) : 1,
    tiedModelCount: tiedTiers.reduce((sum, tier) => sum + tier.size, 0),
    tiePairCount,
    totalPairCount,
    distinctionRate: totalPairCount ? (totalPairCount - tiePairCount) / totalPairCount : 0,
  };
};

export const formatRanking = (ranking: RankingEntry[] = []) =>
  rankingToTiers(ranking)
    .map(tier => tier.entries.map(entry => entry.modelName).join(' = '))
    .join(' > ');

export const formatConsensusRanking = (stats: ArenaRankModelStat[] = []) => {
  const tiers: ArenaRankModelStat[][] = [];
  stats.forEach(stat => {
    const current = tiers[tiers.length - 1];
    if (current && Math.abs(current[0].normalizedScore - stat.normalizedScore) < 1e-9) {
      current.push(stat);
    } else {
      tiers.push([stat]);
    }
  });
  return tiers.map(tier => tier.map(stat => stat.modelName).join(' = ')).join(' > ');
};

const getRankRelation = (rankA: number | undefined, rankB: number | undefined) => {
  if (rankA === undefined || rankB === undefined) return null;
  if (rankA === rankB) return 0;
  return rankA < rankB ? 1 : -1;
};

export const calculateRankPairwiseStats = (
  votes: VoteRecord[],
  models: { id: string; name: string }[] = [],
): RankPairwiseStat[] => {
  const inferredModels = new Map<string, { id: string; name: string }>();
  votes.filter(isArenaRankVote).forEach(vote => {
    normalizeRanking(vote.ranking).forEach(entry => {
      if (!inferredModels.has(entry.modelId)) {
        inferredModels.set(entry.modelId, { id: entry.modelId, name: entry.modelName });
      }
    });
  });
  const modelList = models.length ? models : Array.from(inferredModels.values());
  const stats: RankPairwiseStat[] = [];

  for (let i = 0; i < modelList.length; i += 1) {
    for (let j = i + 1; j < modelList.length; j += 1) {
      const modelA = modelList[i];
      const modelB = modelList[j];
      let aWins = 0;
      let bWins = 0;
      let ties = 0;
      votes.filter(isArenaRankVote).forEach(vote => {
        const byId = new Map(normalizeRanking(vote.ranking).map(entry => [entry.modelId, entry.rank]));
        const relation = getRankRelation(byId.get(modelA.id), byId.get(modelB.id));
        if (relation === null) return;
        if (relation > 0) aWins += 1;
        else if (relation < 0) bWins += 1;
        else ties += 1;
      });
      const total = aWins + bWins + ties;
      const decisiveTotal = aWins + bWins;
      if (!total) continue;
      stats.push({
        modelAId: modelA.id,
        modelAName: modelA.name,
        modelBId: modelB.id,
        modelBName: modelB.name,
        aWins,
        bWins,
        ties,
        total,
        decisiveTotal,
        dominanceScore: (aWins + ties * 0.5) / total,
        decisiveAShare: decisiveTotal ? aWins / decisiveTotal : 0.5,
        tieRate: ties / total,
      });
    }
  }
  return stats;
};

export const kendallTauBForRankings = (
  left: RankingEntry[] = [],
  right: RankingEntry[] = [],
): number | null => {
  const leftMap = new Map(normalizeRanking(left).map(entry => [entry.modelId, entry.rank]));
  const rightMap = new Map(normalizeRanking(right).map(entry => [entry.modelId, entry.rank]));
  const ids = Array.from(leftMap.keys()).filter(id => rightMap.has(id));
  if (ids.length < 2) return null;

  let concordant = 0;
  let discordant = 0;
  let tiedOnlyLeft = 0;
  let tiedOnlyRight = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const leftRelation = getRankRelation(leftMap.get(ids[i]), leftMap.get(ids[j]));
      const rightRelation = getRankRelation(rightMap.get(ids[i]), rightMap.get(ids[j]));
      if (leftRelation === 0 && rightRelation === 0) continue;
      if (leftRelation === 0) tiedOnlyLeft += 1;
      else if (rightRelation === 0) tiedOnlyRight += 1;
      else if (leftRelation === rightRelation) concordant += 1;
      else discordant += 1;
    }
  }
  const denominator = Math.sqrt(
    (concordant + discordant + tiedOnlyLeft) *
    (concordant + discordant + tiedOnlyRight),
  );
  return denominator ? (concordant - discordant) / denominator : null;
};

export const calculateRankingAgreement = (rankings: RankingEntry[][]): RankingAgreement => {
  const normalized = rankings.map(normalizeRanking).filter(ranking => ranking.length > 1);
  let exactRelations = 0;
  let comparedRelations = 0;
  const tauValues: number[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const leftMap = new Map(normalized[i].map(entry => [entry.modelId, entry.rank]));
      const rightMap = new Map(normalized[j].map(entry => [entry.modelId, entry.rank]));
      const ids = Array.from(leftMap.keys()).filter(id => rightMap.has(id));
      for (let a = 0; a < ids.length; a += 1) {
        for (let b = a + 1; b < ids.length; b += 1) {
          const leftRelation = getRankRelation(leftMap.get(ids[a]), leftMap.get(ids[b]));
          const rightRelation = getRankRelation(rightMap.get(ids[a]), rightMap.get(ids[b]));
          if (leftRelation === null || rightRelation === null) continue;
          comparedRelations += 1;
          if (leftRelation === rightRelation) exactRelations += 1;
        }
      }
      const tau = kendallTauBForRankings(normalized[i], normalized[j]);
      if (tau !== null) tauValues.push(tau);
    }
  }

  const distinctionTotals = normalized.reduce(
    (acc, ranking) => {
      const summary = getRankingTieSummary(ranking);
      acc.decisive += summary.totalPairCount - summary.tiePairCount;
      acc.total += summary.totalPairCount;
      return acc;
    },
    { decisive: 0, total: 0 },
  );

  return {
    kendallTauB: tauValues.length ? tauValues.reduce((sum, value) => sum + value, 0) / tauValues.length : null,
    relationAgreement: comparedRelations ? exactRelations / comparedRelations : null,
    distinctionRate: distinctionTotals.total ? distinctionTotals.decisive / distinctionTotals.total : 0,
  };
};

export const calculateArenaRankModelStats = (votes: VoteRecord[]): ArenaRankModelStat[] => {
  const stats = new Map<string, ArenaRankModelStat & { rankSum: number; normalizedScoreSum: number }>();

  votes.filter(isArenaRankVote).forEach(vote => {
    const ranking = normalizeRanking(vote.ranking);
    const metricsByModel = new Map(ranking.map(entry => [entry.modelId, getRankingEntryMetrics(ranking, entry.modelId)!]));
    ranking.forEach(entry => {
      const metrics = metricsByModel.get(entry.modelId)!;
      const existing = stats.get(entry.modelId) || {
        modelId: entry.modelId,
        modelName: entry.modelName,
        totalScore: 0,
        normalizedScore: 0,
        averageRank: 0,
        firstPlaceCount: 0,
        outrightFirstCount: 0,
        coFirstCount: 0,
        firstPlaceCredit: 0,
        tieCount: 0,
        tieRate: 0,
        rankedCount: 0,
        rankSum: 0,
        normalizedScoreSum: 0,
      };

      existing.modelName = entry.modelName || existing.modelName;
      existing.totalScore += metrics.bordaScore;
      existing.normalizedScoreSum += metrics.normalizedBorda;
      existing.rankSum += metrics.midRank;
      existing.rankedCount += 1;
      if (metrics.tieSize > 1) existing.tieCount += 1;
      if (metrics.rank === 1) {
        existing.firstPlaceCount += 1;
        existing.firstPlaceCredit += 1 / metrics.tieSize;
        if (metrics.tieSize === 1) existing.outrightFirstCount += 1;
        else existing.coFirstCount += 1;
      }
      stats.set(entry.modelId, existing);
    });
  });

  return Array.from(stats.values())
    .map(stat => ({
      modelId: stat.modelId,
      modelName: stat.modelName,
      totalScore: stat.totalScore,
      normalizedScore: stat.rankedCount ? stat.normalizedScoreSum / stat.rankedCount : 0,
      averageRank: stat.rankedCount ? stat.rankSum / stat.rankedCount : 0,
      firstPlaceCount: stat.firstPlaceCount,
      outrightFirstCount: stat.outrightFirstCount,
      coFirstCount: stat.coFirstCount,
      firstPlaceCredit: stat.firstPlaceCredit,
      tieCount: stat.tieCount,
      tieRate: stat.rankedCount ? stat.tieCount / stat.rankedCount : 0,
      rankedCount: stat.rankedCount,
    }))
    .sort((a, b) => b.normalizedScore - a.normalizedScore || b.totalScore - a.totalScore || a.averageRank - b.averageRank || a.modelName.localeCompare(b.modelName));
};

export const calculateArenaRankCaseSummaries = (
  votes: VoteRecord[],
  items: ArenaRankPromptItem[] = []
): ArenaRankCaseSummary[] => {
  const grouped = new Map<string, VoteRecord[]>();

  votes.filter(isArenaRankVote).forEach(vote => {
    grouped.set(vote.itemId, [...(grouped.get(vote.itemId) || []), vote]);
  });

  return Array.from(grouped.entries()).map(([itemId, itemVotes]) => {
    const item = items.find(candidate => candidate.id === itemId);
    const rankings = itemVotes.map(vote => normalizeRanking(vote.ranking));
    const agreement = calculateRankingAgreement(rankings);
    const tieSummaries = rankings.map(getRankingTieSummary);
    return {
      itemId,
      prompt: resolveEvaluationItemPrompt(item),
      voterCount: new Set(itemVotes.map(vote => vote.user || 'Anonymous')).size,
      ranking: calculateArenaRankModelStats(itemVotes),
      relationAgreement: agreement.relationAgreement,
      kendallTauB: agreement.kendallTauB,
      distinctionRate: agreement.distinctionRate,
      tieBallots: tieSummaries.filter(summary => summary.hasTie).length,
      allTieBallots: tieSummaries.filter(summary => summary.allTied).length,
    };
  });
};
