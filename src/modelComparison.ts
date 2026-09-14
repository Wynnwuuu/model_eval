import { validateSimpleDataset, type SimpleCase, type SimpleDataset } from './simpleEvaluation';

export interface ComparisonRanking {
  rank: number;
  variantId: string;
  outputSha256: string;
}
export interface ComparisonCase extends SimpleCase {
  caseNumber: number;
  sourceKey: string;
  audioSha256: string;
  rankings: ComparisonRanking[];
}
export interface ComparisonSource {
  key: string;
  label: string;
  fileName: string;
  sha256: string;
}
export interface ComparisonDataset extends SimpleDataset {
  schemaVersion: 1;
  sourceDatasetId: string;
  sources: ComparisonSource[];
  cases: ComparisonCase[];
}

export function validateComparisonDataset(value: unknown): ComparisonDataset {
  const data = value as ComparisonDataset;
  validateSimpleDataset(data);
  const sha = /^[a-f0-9]{64}$/;
  if (data.schemaVersion !== 1 || typeof data.sourceDatasetId !== 'string' || !data.sourceDatasetId
    || !Array.isArray(data.sources) || !data.sources.length
    || data.sources.some(source => !source.key || !source.label || !source.fileName || !sha.test(source.sha256))
    || new Set(data.sources.map(source => source.key)).size !== data.sources.length) {
    throw new Error('已评结果的来源记录不完整。');
  }
  const ids = data.variants.map(variant => variant.id);
  const sources = new Set(data.sources.map(source => source.key));
  for (const [index, item] of data.cases.entries()) {
    if (item.caseNumber !== index + 1 || !sources.has(item.sourceKey) || !sha.test(item.audioSha256)
      || !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0
      || !Array.isArray(item.rankings) || item.rankings.length !== ids.length
      || new Set(item.rankings.map(entry => entry.variantId)).size !== ids.length
      || new Set(item.rankings.map(entry => entry.rank)).size !== ids.length
      || item.rankings.some(entry => !ids.includes(entry.variantId) || !Number.isInteger(entry.rank)
        || entry.rank < 1 || entry.rank > ids.length || !sha.test(entry.outputSha256))) {
      throw new Error(`第 ${index + 1} 题的模型与名次映射不完整，已停止展示。`);
    }
  }
  return data;
}

export function rankedComparisonOptions(dataset: ComparisonDataset, item: ComparisonCase) {
  return [...item.rankings].sort((a, b) => a.rank - b.rank).map(entry => {
    const variant = dataset.variants.find(candidate => candidate.id === entry.variantId)!;
    return { ...entry, variant, original: item.outputs[entry.variantId] };
  });
}

export function comparisonSummary(dataset: ComparisonDataset) {
  const rows = dataset.variants.map(variant => {
    const ranks = dataset.cases.map(item => item.rankings.find(entry => entry.variantId === variant.id)!.rank);
    return { variant, rankSum: ranks.reduce((a, b) => a + b, 0), averageRank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
      firstCount: ranks.filter(rank => rank === 1).length, secondCount: ranks.filter(rank => rank === 2).length,
      thirdCount: ranks.filter(rank => rank === 3).length, firstRate: ranks.filter(rank => rank === 1).length / ranks.length };
  }).sort((a, b) => a.rankSum - b.rankSum);
  return rows.map(row => ({ ...row, position: rows.findIndex(candidate => candidate.rankSum === row.rankSum) + 1 }));
}

export function buildComparisonCsv(dataset: ComparisonDataset): string {
  validateComparisonDataset(dataset);
  const rows: (string | number)[][] = [['DatasetID', 'CaseNumber', 'SourceID', 'Category', 'Rank', 'VariantID', 'ModelName', 'PromptName', 'ReviewSource', 'OutputSHA256']];
  for (const item of dataset.cases) {
    const source = dataset.sources.find(candidate => candidate.key === item.sourceKey)!;
    for (const option of rankedComparisonOptions(dataset, item)) {
      rows.push([dataset.sourceDatasetId, item.caseNumber, item.id, item.category, option.rank, option.variantId,
        option.variant.modelName, option.variant.promptName || '', source.label, option.outputSha256]);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}
