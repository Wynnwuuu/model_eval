import { AggregatedResult, EvaluationItem, VoteRecord, VoteType } from './types';
import { calculateArenaRankModelStats, calculateRankingAgreement, getRankingTieSummary, isArenaRankVote, normalizeRanking } from './rankingUtils';

export type DimensionValues = Record<string, string>;

export interface VoteDimensionSummary {
  dimensionKey: string;
  dimensionValue: string;
  itemCount: number;
  totalVotes: number;
  votes: {
    A: number;
    B: number;
    Tie: number;
  };
  winner: VoteType;
  agreementRate: number;
  marginRate: number;
}

export interface RankDimensionSummary {
  dimensionKey: string;
  dimensionValue: string;
  itemCount: number;
  rankingRecords: number;
  modelStats: ReturnType<typeof calculateArenaRankModelStats>;
  relationAgreement: number | null;
  kendallTauB: number | null;
  distinctionRate: number;
  tieBallotRate: number;
  allTieBallotRate: number;
}

const DIMENSION_PREFIXES = ['dimension_', 'dimension:', '评测维度_', '评测维度:', '维度_', '维度:'];
const LIKELY_DIMENSION_KEYWORDS = ['dimension', '维度', 'category', '类别', 'scenario', '场景', 'tag', '标签', '能力', 'difficulty', '难度'];

const cleanValue = (value: any) => String(value ?? '').trim();

const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '').replace(/-/g, '_');

export const isLikelyDimensionColumn = (column: string) => {
  const normalized = normalizeKey(column);
  return LIKELY_DIMENSION_KEYWORDS.some(keyword => normalized.includes(normalizeKey(keyword)));
};

export const getDimensionCsvHeader = (key: string) => `Dimension_${key}`;

export const parseDimensionKeyFromCsvHeader = (header: string) => {
  const normalized = normalizeKey(header);
  const prefix = DIMENSION_PREFIXES.find(candidate => normalized.startsWith(normalizeKey(candidate)));
  if (!prefix) return '';
  return header.slice(prefix.length).trim();
};

export const getDimensionEntries = (values?: DimensionValues) =>
  Object.entries(values || {})
    .map(([key, value]) => [key, cleanValue(value)] as [string, string])
    .filter(([, value]) => value.length > 0);

const DIMENSION_OPTION_SPLIT = /[,，;；|]/;

export const parseDimensionOptionValues = (value: unknown): string[] => {
  if (Array.isArray(value)) return [...new Set(value.flatMap(parseDimensionOptionValues))];
  const parts = String(value ?? '').split(DIMENSION_OPTION_SPLIT).map(part => part.trim()).filter(Boolean);
  return [...new Set(parts)];
};

export const getDimensionOptionEntries = (values?: DimensionValues) =>
  getDimensionEntries(values).flatMap(([key, value]) =>
    parseDimensionOptionValues(value).map(option => [key, option] as [string, string])
  );

export const dimensionValueHasOption = (value: unknown, option: string) =>
  parseDimensionOptionValues(value).includes(option);

export type DimensionOptionSelection = Record<string, string[]>;

export const hasDimensionOptionSelection = (selected: DimensionOptionSelection) =>
  Object.values(selected).some(options => options.length > 0);

export const itemMatchesDimensionOptions = (
  values: DimensionValues | undefined,
  selected: DimensionOptionSelection,
) => Object.entries(selected).every(([key, options]) =>
  options.length === 0 || options.every(option => dimensionValueHasOption(values?.[key], option))
);

export const toggleDimensionOption = (
  selected: DimensionOptionSelection,
  key: string,
  option: string,
): DimensionOptionSelection => {
  const current = selected[key] || [];
  const nextValues = current.includes(option)
    ? current.filter(value => value !== option)
    : [...current, option];
  const next = { ...selected, [key]: nextValues };
  if (nextValues.length === 0) delete next[key];
  return next;
};

export const collectDimensionOptionCatalog = (
  items: Array<{ dimensionValues?: DimensionValues }>,
) => {
  const catalog = new Map<string, Map<string, number>>();
  items.forEach(item => {
    getDimensionOptionEntries(item.dimensionValues).forEach(([key, option]) => {
      const options = catalog.get(key) || new Map<string, number>();
      options.set(option, (options.get(option) || 0) + 1);
      catalog.set(key, options);
    });
  });
  return Array.from(catalog.entries())
    .map(([key, options]) => ({
      key,
      options: Array.from(options.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)),
    }))
    .filter(group => group.options.length > 1);
};

export const hasDimensionValues = (values?: DimensionValues) => getDimensionEntries(values).length > 0;

export const formatDimensionValues = (values?: DimensionValues) => {
  const entries = getDimensionEntries(values);
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(' | ') : '';
};

export const formatDimensionOptionValues = (values?: DimensionValues) => {
  const entries = getDimensionOptionEntries(values);
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(' | ') : '';
};

export const getDimensionValuesFromRecord = (
  record?: Record<string, any>,
  dimensionColumns: string[] = []
): DimensionValues => {
  if (!record) return {};
  const values: DimensionValues = {};

  dimensionColumns.forEach(column => {
    const value = cleanValue(record[column]);
    if (value) values[column] = value;
  });

  Object.keys(record).forEach(key => {
    const parsedKey = parseDimensionKeyFromCsvHeader(key);
    const value = cleanValue(record[key]);
    if (parsedKey && value && !values[parsedKey]) values[parsedKey] = value;
  });

  return values;
};

export const getDimensionValuesForItem = (
  item?: Partial<EvaluationItem> & { originalData?: Record<string, any> },
  dimensionColumns: string[] = []
): DimensionValues => {
  if (!item) return {};

  return {
    ...getDimensionValuesFromRecord(item.originalData, dimensionColumns),
    ...getDimensionValuesFromRecord(item.inputs, dimensionColumns),
    ...getDimensionValuesFromRecord(item as Record<string, any>, dimensionColumns),
    ...(item.dimensionValues || {})
  };
};

export const collectDimensionKeys = (items: Array<Partial<EvaluationItem> & { originalData?: Record<string, any> }>) => {
  const keys = new Set<string>();
  items.forEach(item => {
    getDimensionEntries(getDimensionValuesForItem(item)).forEach(([key]) => keys.add(key));
  });
  return Array.from(keys);
};

const getWinnerSide = (votes: VoteDimensionSummary['votes']): VoteType => {
  const maxVotes = Math.max(votes.A, votes.B, votes.Tie);
  const winners = [
    votes.A === maxVotes ? 'A' : null,
    votes.B === maxVotes ? 'B' : null,
    votes.Tie === maxVotes ? 'Tie' : null
  ].filter(Boolean);

  return winners.length === 1 && winners[0] !== 'Tie' ? winners[0] as VoteType : 'Tie';
};

export const calculateVoteDimensionSummaries = (items: AggregatedResult[]): VoteDimensionSummary[] => {
  const grouped = new Map<string, VoteDimensionSummary & { itemIds: Set<string> }>();

  items.forEach(item => {
    const entries = getDimensionOptionEntries(item.dimensionValues);
    const total = item.votes.A + item.votes.B + item.votes.Tie;
    if (entries.length === 0 || total === 0) return;

    entries.forEach(([dimensionKey, dimensionValue]) => {
      const groupKey = `${dimensionKey}::${dimensionValue}`;
      const existing = grouped.get(groupKey) || {
        dimensionKey,
        dimensionValue,
        itemCount: 0,
        totalVotes: 0,
        votes: { A: 0, B: 0, Tie: 0 },
        winner: 'Tie' as VoteType,
        agreementRate: 0,
        marginRate: 0,
        itemIds: new Set<string>()
      };

      existing.itemIds.add(item.itemId);
      existing.votes.A += item.votes.A;
      existing.votes.B += item.votes.B;
      existing.votes.Tie += item.votes.Tie;
      existing.totalVotes += total;
      grouped.set(groupKey, existing);
    });
  });

  return Array.from(grouped.values())
    .map(group => {
      const maxVotes = Math.max(group.votes.A, group.votes.B, group.votes.Tie);
      const winner = getWinnerSide(group.votes);
      return {
        dimensionKey: group.dimensionKey,
        dimensionValue: group.dimensionValue,
        itemCount: group.itemIds.size,
        totalVotes: group.totalVotes,
        votes: group.votes,
        winner,
        agreementRate: group.totalVotes ? maxVotes / group.totalVotes : 0,
        marginRate: group.totalVotes ? Math.abs(group.votes.A - group.votes.B) / group.totalVotes : 0
      };
    })
    .sort((a, b) => a.dimensionKey.localeCompare(b.dimensionKey) || b.totalVotes - a.totalVotes || a.dimensionValue.localeCompare(b.dimensionValue));
};

export const calculateRankDimensionSummaries = (
  votes: VoteRecord[],
  items: Array<Partial<EvaluationItem> & { id: string; originalData?: Record<string, any> }>
): RankDimensionSummary[] => {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const grouped = new Map<string, { dimensionKey: string; dimensionValue: string; itemIds: Set<string>; votes: VoteRecord[] }>();

  votes.filter(isArenaRankVote).forEach(vote => {
    const item = itemMap.get(vote.itemId);
    const entries = getDimensionOptionEntries(getDimensionValuesForItem(item));
    entries.forEach(([dimensionKey, dimensionValue]) => {
      const groupKey = `${dimensionKey}::${dimensionValue}`;
      const existing = grouped.get(groupKey) || {
        dimensionKey,
        dimensionValue,
        itemIds: new Set<string>(),
        votes: []
      };
      existing.itemIds.add(vote.itemId);
      existing.votes.push(vote);
      grouped.set(groupKey, existing);
    });
  });

  return Array.from(grouped.values())
    .map(group => {
      const votesByItem = new Map<string, VoteRecord[]>();
      group.votes.forEach(vote => votesByItem.set(vote.itemId, [...(votesByItem.get(vote.itemId) || []), vote]));
      const agreements = Array.from(votesByItem.values()).map(itemVotes =>
        calculateRankingAgreement(itemVotes.map(vote => normalizeRanking(vote.ranking)))
      );
      const relations = agreements.map(item => item.relationAgreement).filter((value): value is number => value !== null);
      const taus = agreements.map(item => item.kendallTauB).filter((value): value is number => value !== null);
      const tieSummaries = group.votes.map(vote => getRankingTieSummary(vote.ranking));

      return {
        dimensionKey: group.dimensionKey,
        dimensionValue: group.dimensionValue,
        itemCount: group.itemIds.size,
        rankingRecords: group.votes.length,
        modelStats: calculateArenaRankModelStats(group.votes),
        relationAgreement: relations.length ? relations.reduce((sum, value) => sum + value, 0) / relations.length : null,
        kendallTauB: taus.length ? taus.reduce((sum, value) => sum + value, 0) / taus.length : null,
        distinctionRate: agreements.length ? agreements.reduce((sum, value) => sum + value.distinctionRate, 0) / agreements.length : 0,
        tieBallotRate: group.votes.length ? tieSummaries.filter(summary => summary.hasTie).length / group.votes.length : 0,
        allTieBallotRate: group.votes.length ? tieSummaries.filter(summary => summary.allTied).length / group.votes.length : 0
      };
    })
    .sort((a, b) => a.dimensionKey.localeCompare(b.dimensionKey) || b.rankingRecords - a.rankingRecords || a.dimensionValue.localeCompare(b.dimensionValue));
};

export const getDimensionColumnsForCsv = (items: Array<Partial<EvaluationItem> & { originalData?: Record<string, any> }>) =>
  collectDimensionKeys(items).map(key => ({ key, header: getDimensionCsvHeader(key) }));

export const getDimensionCsvValues = (values: DimensionValues | undefined, keys: string[]) =>
  keys.map(key => values?.[key] || '');
