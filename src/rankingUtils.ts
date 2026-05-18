import { EvaluationItem, ModelOutput, RankingEntry, VoteRecord } from './types';

export interface ArenaRankModelStat {
  modelId: string;
  modelName: string;
  totalScore: number;
  averageRank: number;
  firstPlaceCount: number;
  rankedCount: number;
}

export interface ArenaRankCaseSummary {
  itemId: string;
  prompt?: string;
  voterCount: number;
  ranking: ArenaRankModelStat[];
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

export const sortRanking = (ranking: RankingEntry[] = []) =>
  [...ranking].sort((a, b) => a.rank - b.rank);

export const isArenaRankVote = (vote: VoteRecord) =>
  Array.isArray(vote.ranking) && vote.ranking.length > 0;

export const getBordaScore = (rank: number, candidateCount: number) =>
  Math.max(candidateCount - rank + 1, 0);

export const calculateArenaRankModelStats = (votes: VoteRecord[]): ArenaRankModelStat[] => {
  const stats = new Map<string, ArenaRankModelStat & { rankSum: number }>();

  votes.filter(isArenaRankVote).forEach(vote => {
    const ranking = sortRanking(vote.ranking);
    const candidateCount = ranking.length;

    ranking.forEach(entry => {
      const existing = stats.get(entry.modelId) || {
        modelId: entry.modelId,
        modelName: entry.modelName,
        totalScore: 0,
        averageRank: 0,
        firstPlaceCount: 0,
        rankedCount: 0,
        rankSum: 0
      };

      existing.modelName = entry.modelName || existing.modelName;
      existing.totalScore += getBordaScore(entry.rank, candidateCount);
      existing.rankSum += entry.rank;
      existing.rankedCount += 1;
      if (entry.rank === 1) existing.firstPlaceCount += 1;
      stats.set(entry.modelId, existing);
    });
  });

  return Array.from(stats.values())
    .map(stat => ({
      modelId: stat.modelId,
      modelName: stat.modelName,
      totalScore: stat.totalScore,
      averageRank: stat.rankedCount ? stat.rankSum / stat.rankedCount : 0,
      firstPlaceCount: stat.firstPlaceCount,
      rankedCount: stat.rankedCount
    }))
    .sort((a, b) => b.totalScore - a.totalScore || a.averageRank - b.averageRank || a.modelName.localeCompare(b.modelName));
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
    return {
      itemId,
      prompt: resolveEvaluationItemPrompt(item),
      voterCount: new Set(itemVotes.map(vote => vote.user || 'Anonymous')).size,
      ranking: calculateArenaRankModelStats(itemVotes)
    };
  });
};
