import type { Workbook as ExcelWorkbook, Worksheet } from 'exceljs';

import type {
  AbInsightBundle,
  InsightBundle,
  RankInsightBundle,
  RawAbVoteRow,
} from './analysisInsights';
import type { PairwiseInsightBundle, ScoreInsightBundle } from './scoringInsights';
import type {
  EvaluationItem,
  EvaluationMethod,
  RankingEntry,
  VoteItemSnapshot,
  VoteRecord,
} from './types';
import { getDimensionEntries, getDimensionValuesForItem } from './dimensionUtils';
import {
  formatConsensusRanking,
  formatRanking,
  getRankingEntryMetrics,
  getRankingTieSummary,
  normalizeRanking,
} from './rankingUtils';
import { getVoteAuditCsvValues, VOTE_AUDIT_CSV_HEADERS } from './taskItemSnapshot';
import { getEffectiveVotes } from './voteUtils';

export type SupportedInsightExportBundle = InsightBundle | ScoreInsightBundle | PairwiseInsightBundle;
export type InsightExportItem = Partial<EvaluationItem> & { id: string; originalData?: Record<string, any> };

export interface InsightExportContext {
  projectId: string;
  projectName: string;
  materialId: string;
  materialName: string;
  evaluationMethod: EvaluationMethod;
  reviewerScope: 'all' | 'mine';
  reviewerScopeLabel: string;
  exportedAt?: string;
}

export interface CaseExportIdentity {
  caseIndex: number | '';
  caseId: string;
  taskItemId: string;
  datasetItemId: string;
}

export interface InsightExportRequest<TBundle extends SupportedInsightExportBundle = SupportedInsightExportBundle> {
  bundle: TBundle;
  items: InsightExportItem[];
  votes?: VoteRecord[];
  rawAbVoteRows?: RawAbVoteRow[];
  context: InsightExportContext;
}

type ExportCell = string | number | boolean | null | undefined;

const CASE_ID_KEYS = [
  'case_id',
  'caseId',
  'caseID',
  'case_name',
  'CaseID',
  'ItemID',
  'Item ID',
  '用例ID',
  '用例 ID',
  'id',
];

const METHOD_LABELS: Record<EvaluationMethod, string> = {
  ab_preference: 'A-B',
  rank_order: 'Arena-rank',
  pairwise: 'Pairwise',
  direct_score: 'MOS',
  rubric_score: 'Rubric',
  benchmark_preview: 'Benchmark',
};

const normalizeText = (value: unknown) => String(value ?? '').trim();

const getCaseIdFromOriginalData = (...records: Array<Record<string, any> | undefined>) => {
  for (const record of records) {
    if (!record) continue;
    for (const key of CASE_ID_KEYS) {
      const value = normalizeText(record[key]);
      if (value) return value;
    }
  }
  return '';
};

const buildItemLookups = (items: InsightExportItem[]) => {
  const byId = new Map<string, InsightExportItem>();
  items.forEach(item => {
    byId.set(item.id, item);
    if (item.originalItemId) byId.set(item.originalItemId, item);
    if (item.sourceDatasetItemId) byId.set(item.sourceDatasetItemId, item);
  });
  return byId;
};

const getSourceItem = (items: InsightExportItem[], vote?: VoteRecord, fallbackId?: string) => {
  const lookup = buildItemLookups(items);
  return lookup.get(vote?.itemId || '')
    || lookup.get(vote?.pairContext?.originalItemId || '')
    || lookup.get(fallbackId || '');
};

const resolveSnapshotOrder = (snapshot?: VoteItemSnapshot) => {
  const order = Number(snapshot?.itemOrder);
  return Number.isFinite(order) && order >= 0 ? Math.trunc(order) : null;
};

export const resolveCaseExportIdentity = ({
  item,
  vote,
  items,
  fallbackCaseId,
}: {
  item?: InsightExportItem;
  vote?: VoteRecord;
  items: InsightExportItem[];
  fallbackCaseId?: string;
}): CaseExportIdentity => {
  const evaluated = vote?.evaluatedItemSnapshot;
  const currentSnapshot = vote?.itemSnapshot;
  const taskItemId = normalizeText(vote?.itemId || item?.id || evaluated?.itemId || currentSnapshot?.itemId || fallbackCaseId);
  const caseId = normalizeText(
    evaluated?.originalItemId
      || currentSnapshot?.originalItemId
      || item?.originalItemId
      || vote?.pairContext?.originalItemId
      || getCaseIdFromOriginalData(evaluated?.originalData, currentSnapshot?.originalData, item?.originalData)
      || fallbackCaseId
      || taskItemId,
  );
  const datasetItemId = normalizeText(
    evaluated?.sourceDatasetItemId
      || currentSnapshot?.sourceDatasetItemId
      || item?.sourceDatasetItemId,
  );

  const explicitOrder = resolveSnapshotOrder(evaluated)
    ?? resolveSnapshotOrder(currentSnapshot)
    ?? (Number.isFinite(Number(item?.itemOrder)) && Number(item?.itemOrder) >= 0 ? Math.trunc(Number(item?.itemOrder)) : null);
  let caseIndex: number | '' = explicitOrder === null ? '' : explicitOrder + 1;
  if (caseIndex === '' && item && (item.originalItemId || item.sourceDatasetItemId)) {
    const arrayIndex = items.findIndex(candidate => candidate.id === item.id);
    if (arrayIndex >= 0) caseIndex = arrayIndex + 1;
  }

  return { caseIndex, caseId, taskItemId, datasetItemId };
};

const resolveExportTimestamp = (context: InsightExportContext) => context.exportedAt || new Date().toISOString();

const sanitizeFilenamePart = (value: string) => normalizeText(value)
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  .replace(/\s+/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 80) || 'ManuEval';

export const buildInsightArtifactFilename = (
  context: InsightExportContext,
  artifact: '分析报表' | '评审明细' | '证据' | '可视化报告',
  extension: 'xlsx' | 'csv' | 'json' | 'html',
) => {
  const date = resolveExportTimestamp(context).slice(0, 10);
  return [
    sanitizeFilenamePart(context.materialName),
    METHOD_LABELS[context.evaluationMethod],
    sanitizeFilenamePart(context.reviewerScopeLabel),
    artifact,
    date,
  ].join('_') + `.${extension}`;
};

const protectSpreadsheetText = (value: ExportCell): ExportCell => {
  if (typeof value !== 'string') return value;
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
};

const csvEscape = (value: ExportCell) => {
  const protectedValue = protectSpreadsheetText(value);
  return `"${String(protectedValue ?? '').replace(/"/g, '""')}"`;
};

const rowsToCsv = (headers: string[], rows: ExportCell[][]) =>
  `\uFEFF${[headers.map(csvEscape).join(','), ...rows.map(row => row.map(csvEscape).join(','))].join('\n')}`;

const getAllDimensionKeys = (request: InsightExportRequest) => {
  const fromItems = request.items.flatMap(item => getDimensionEntries(getDimensionValuesForItem(item as any)).map(([key]) => key));
  const fromCases = 'cases' in request.bundle
    ? request.bundle.cases.flatMap((item: any) => getDimensionEntries(item.dimensionValues || {}).map(([key]) => key))
    : [];
  return Array.from(new Set([...fromItems, ...fromCases])).sort((left, right) => left.localeCompare(right));
};

const getPrompt = (item?: InsightExportItem, vote?: VoteRecord) => normalizeText(
  vote?.evaluatedItemSnapshot?.prompt
    || item?.prompt
    || vote?.itemSnapshot?.prompt
    || item?.inputs?.prompt
    || item?.originalData?.prompt
    || item?.originalData?.Prompt,
);

const getDimensions = (item?: InsightExportItem, vote?: VoteRecord) => ({
  ...getDimensionValuesForItem(item as any),
  ...(vote?.itemSnapshot?.dimensionValues || {}),
  ...(vote?.evaluatedItemSnapshot?.dimensionValues || {}),
});

const auditValues = (vote?: VoteRecord) => vote ? getVoteAuditCsvValues(vote) : VOTE_AUDIT_CSV_HEADERS.map(() => '');

const effectiveAbVotes = (request: InsightExportRequest<AbInsightBundle>): VoteRecord[] => {
  const votes = getEffectiveVotes(request.votes || []).filter(vote => ['A', 'B', 'Tie'].includes(String(vote.vote || vote.choice)));
  if (votes.length) return votes;
  return (request.rawAbVoteRows || []).map(row => ({
    itemId: row.itemId,
    vote: row.vote,
    timestamp: row.timestamp || 0,
    user: row.user || 'Anonymous',
  } as VoteRecord));
};

const buildAbDetailCsv = (request: InsightExportRequest<AbInsightBundle>) => {
  const dimensionKeys = getAllDimensionKeys(request);
  const caseLookup = new Map(request.bundle.cases.map(item => [item.itemId, item]));
  const rows = effectiveAbVotes(request).map(vote => {
    const item = getSourceItem(request.items, vote);
    const identity = resolveCaseExportIdentity({ item, vote, items: request.items });
    const caseItem = caseLookup.get(vote.itemId);
    const side = (vote.vote || vote.choice || '') as string;
    const winnerModelName = side === 'A'
      ? caseItem?.modelA.modelName || request.bundle.models.a
      : side === 'B'
        ? caseItem?.modelB.modelName || request.bundle.models.b
        : '平局';
    const dimensions = getDimensions(item, vote);
    return [
      identity.caseIndex,
      identity.caseId,
      identity.taskItemId,
      identity.datasetItemId,
      getPrompt(item, vote),
      ...dimensionKeys.map(key => dimensions[key] || ''),
      vote.user || 'Anonymous',
      vote.timestamp ? new Date(vote.timestamp).toISOString() : '',
      side,
      winnerModelName,
      caseItem?.modelA.modelName || request.bundle.models.a,
      caseItem?.modelA.url || '',
      caseItem?.modelB.modelName || request.bundle.models.b,
      caseItem?.modelB.url || '',
      caseItem?.referenceUrls.join(' | ') || item?.referenceUrls?.join(' | ') || '',
      vote.reason || '',
      vote.rubricResponses ? JSON.stringify(vote.rubricResponses) : '',
      caseItem?.votes.A ?? '',
      caseItem?.votes.B ?? '',
      caseItem?.votes.Tie ?? '',
      caseItem?.voterCount ?? '',
      caseItem?.winnerLabel || '',
      caseItem?.agreementRate ?? '',
      caseItem?.marginVotes ?? '',
      caseItem?.marginRate ?? '',
      ...auditValues(vote),
    ];
  });

  return rowsToCsv([
    'CaseIndex', 'CaseID', 'TaskItemID', 'DatasetItemID', 'Prompt',
    ...dimensionKeys.map(key => `Dimension_${key}`),
    'ReviewerName', 'Timestamp', 'VoteSide', 'WinnerModelName',
    'ModelA_Name', 'ModelA_URL', 'ModelB_Name', 'ModelB_URL', 'ReferenceURLs',
    'Reason', 'ModelFeedbackJSON', 'CaseVotes_A', 'CaseVotes_B', 'CaseVotes_Tie',
    'CaseVoterCount', 'CaseWinner', 'CaseAgreementRate', 'CaseMarginVotes', 'CaseMarginRate',
    ...VOTE_AUDIT_CSV_HEADERS,
  ], rows);
};

const safeModelHeaderKey = (modelId: string, index: number, used: Set<string>) => {
  const base = normalizeText(modelId).replace(/[^A-Za-z0-9_]/g, '_') || `model_${index + 1}`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
};

const buildRankDetailCsv = (request: InsightExportRequest<RankInsightBundle>) => {
  const dimensionKeys = getAllDimensionKeys(request);
  const caseLookup = new Map(request.bundle.cases.map(item => [item.itemId, item]));
  const usedHeaders = new Set<string>();
  const modelHeaders = request.bundle.models.map((model, index) => ({
    model,
    key: safeModelHeaderKey(model.modelId, index, usedHeaders),
  }));
  const votes = getEffectiveVotes(request.votes || []).filter(vote => Array.isArray(vote.ranking) && vote.ranking.length > 0);
  const rows = votes.map(vote => {
    const item = getSourceItem(request.items, vote);
    const identity = resolveCaseExportIdentity({ item, vote, items: request.items });
    const caseItem = caseLookup.get(vote.itemId);
    const ranking = normalizeRanking(vote.ranking);
    const tieSummary = getRankingTieSummary(ranking);
    const dimensions = getDimensions(item, vote);
    const metricsByModel = new Map(ranking.map(entry => [entry.modelId, getRankingEntryMetrics(ranking, entry.modelId)]));
    const outputRows = (item?.modelOutputs || caseItem?.representativeOutputs || []).map(output => ({
      modelId: output.modelId,
      modelName: output.modelName,
      url: output.url,
    }));
    return [
      identity.caseIndex,
      identity.caseId,
      identity.taskItemId,
      identity.datasetItemId,
      getPrompt(item, vote),
      ...dimensionKeys.map(key => dimensions[key] || ''),
      vote.user || 'Anonymous',
      vote.timestamp ? new Date(vote.timestamp).toISOString() : '',
      formatRanking(ranking),
      tieSummary.hasTie,
      tieSummary.allTied,
      tieSummary.tieGroupCount,
      tieSummary.topTieSize,
      tieSummary.maxTieGroupSize,
      tieSummary.distinctionRate,
      ...modelHeaders.map(({ model }) => metricsByModel.get(model.modelId)?.rank ?? ''),
      ...modelHeaders.map(({ model }) => metricsByModel.get(model.modelId)?.bordaScore ?? ''),
      ...modelHeaders.map(({ model }) => metricsByModel.get(model.modelId)?.normalizedBorda ?? ''),
      JSON.stringify(ranking),
      JSON.stringify(outputRows),
      caseItem?.referenceUrls.join(' | ') || item?.referenceUrls?.join(' | ') || '',
      caseItem?.voterCount ?? '',
      caseItem ? formatConsensusRanking(caseItem.consensusRanking) : '',
      caseItem?.consensusLeaders.join(' = ') || '',
      caseItem?.relationAgreement ?? '',
      caseItem?.kendallTau ?? '',
      caseItem?.distinctionRate ?? '',
      caseItem?.tieBallots ?? '',
      caseItem?.allTieBallots ?? '',
      caseItem ? JSON.stringify(caseItem.consensusRanking) : '',
      ...auditValues(vote),
    ];
  });

  return rowsToCsv([
    'CaseIndex', 'CaseID', 'TaskItemID', 'DatasetItemID', 'Prompt',
    ...dimensionKeys.map(key => `Dimension_${key}`),
    'ReviewerName', 'Timestamp', 'RankingDisplay', 'HasTie', 'AllTied',
    'TieGroupCount', 'TopTieSize', 'MaxTieGroupSize', 'BallotDistinctionRate',
    ...modelHeaders.map(({ key }) => `Rank_${key}`),
    ...modelHeaders.map(({ key }) => `Borda_${key}`),
    ...modelHeaders.map(({ key }) => `NormalizedBorda_${key}`),
    'RankingJSON', 'ModelOutputsJSON', 'ReferenceURLs', 'CaseVoterCount',
    'CaseConsensusRanking', 'CaseConsensusLeaders',
    'CaseRelationAgreement', 'CaseKendallTauB', 'CaseDistinctionRate',
    'CaseTieBallots', 'CaseAllTieBallots', 'CaseConsensusRankingJSON',
    ...VOTE_AUDIT_CSV_HEADERS,
  ], rows);
};

const getScoreDimensionIds = (bundle: ScoreInsightBundle) => bundle.config.dimensions
  ?.filter(dimension => dimension.type === 'star_rating' && dimension.aggregationRole !== 'rationale')
  .map(dimension => dimension.id) || [];

const calculateWeightedScore = (scores: Record<string, number>, bundle: ScoreInsightBundle) => {
  const dimensions = bundle.config.dimensions
    ?.filter(dimension => dimension.type === 'star_rating' && dimension.aggregationRole !== 'rationale') || [];
  const totalWeight = dimensions.reduce((sum, dimension) => sum + (dimension.weight ?? 1), 0);
  if (!totalWeight) {
    const values = Object.values(scores).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : '';
  }
  return dimensions.reduce((sum, dimension) => {
    const score = Number(scores[dimension.id]);
    return Number.isFinite(score) ? sum + score * (dimension.weight ?? 1) : sum;
  }, 0) / totalWeight;
};

const buildScoreDetailCsv = (request: InsightExportRequest<ScoreInsightBundle>) => {
  const dimensionKeys = getAllDimensionKeys(request);
  const scoreDimensionIds = getScoreDimensionIds(request.bundle);
  const caseLookup = new Map(request.bundle.cases.map(item => [item.itemId, item]));
  const rows: ExportCell[][] = [];

  getEffectiveVotes(request.votes || []).forEach(vote => {
    const item = getSourceItem(request.items, vote);
    const identity = resolveCaseExportIdentity({ item, vote, items: request.items });
    const dimensions = getDimensions(item, vote);
    const caseItem = caseLookup.get(vote.itemId);
    Object.entries(vote.rubricResponses || {}).forEach(([responseKey, response]) => {
      const modelId = response.modelId || responseKey;
      const caseModel = caseItem?.modelScores.find(model => model.modelId === modelId);
      const output = item?.modelOutputs?.find(model => model.modelId === modelId);
      rows.push([
        identity.caseIndex,
        identity.caseId,
        identity.taskItemId,
        identity.datasetItemId,
        getPrompt(item, vote),
        ...dimensionKeys.map(key => dimensions[key] || ''),
        vote.user || 'Anonymous',
        vote.timestamp ? new Date(vote.timestamp).toISOString() : '',
        modelId,
        response.modelName || caseModel?.modelName || modelId,
        output?.url || caseModel?.outputUrl || '',
        ...scoreDimensionIds.map(id => Number.isFinite(Number(response.scores?.[id])) ? Number(response.scores[id]) : ''),
        calculateWeightedScore(response.scores || {}, request.bundle),
        response.answers ? JSON.stringify(response.answers) : '',
        response.reason || '',
        caseModel?.averageScore ?? '',
        caseModel?.weightedScore ?? '',
        caseModel?.responseCount ?? '',
        ...auditValues(vote),
      ]);
    });
  });

  return rowsToCsv([
    'CaseIndex', 'CaseID', 'TaskItemID', 'DatasetItemID', 'Prompt',
    ...dimensionKeys.map(key => `Dimension_${key}`),
    'ReviewerName', 'Timestamp', 'ModelID', 'ModelName', 'OutputURL',
    ...scoreDimensionIds.map(id => `Score_${id}`),
    'WeightedScore', 'AnswersJSON', 'Reason', 'CaseModelAverageScore',
    'CaseModelWeightedScore', 'CaseModelResponseCount',
    ...VOTE_AUDIT_CSV_HEADERS,
  ], rows);
};

const findBattleVote = (votes: VoteRecord[], battle: PairwiseInsightBundle['battles'][number]) => votes.find(vote =>
  Boolean(battle.assignmentId) && vote.pairContext?.assignmentId === battle.assignmentId,
) || votes.find(vote => vote.itemId === battle.itemId && vote.timestamp === battle.timestamp);

const buildPairwiseDetailCsv = (request: InsightExportRequest<PairwiseInsightBundle>) => {
  const dimensionKeys = getAllDimensionKeys(request);
  const votes = getEffectiveVotes(request.votes || []);
  const rows = request.bundle.battles.map(battle => {
    const vote = findBattleVote(votes, battle);
    const item = getSourceItem(request.items, vote, battle.originalItemId);
    const identity = resolveCaseExportIdentity({
      item,
      vote,
      items: request.items,
      fallbackCaseId: battle.originalItemId,
    });
    const modelA = request.bundle.bradleyTerry.models.find(model => model.modelId === battle.modelAId);
    const modelB = request.bundle.bradleyTerry.models.find(model => model.modelId === battle.modelBId);
    return [
      identity.caseIndex,
      identity.caseId,
      identity.taskItemId,
      identity.datasetItemId,
      battle.prompt,
      ...dimensionKeys.map(key => battle.dimensionValues[key] || ''),
      battle.user,
      new Date(battle.timestamp).toISOString(),
      battle.assignmentId,
      battle.pairId,
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
      battle.samplingProbability,
      battle.analysisWeight,
      battle.eligiblePairCount,
      battle.schedulerVersion,
      request.bundle.summary.connected,
      modelA?.rating ?? '',
      modelA?.ratingLower ?? '',
      modelA?.ratingUpper ?? '',
      modelB?.rating ?? '',
      modelB?.ratingLower ?? '',
      modelB?.ratingUpper ?? '',
      ...(vote ? auditValues(vote) : battle.voteAudit),
    ];
  });

  return rowsToCsv([
    'CaseIndex', 'CaseID', 'TaskItemID', 'DatasetItemID', 'Prompt',
    ...dimensionKeys.map(key => `Dimension_${key}`),
    'ReviewerName', 'Timestamp', 'AssignmentID', 'PairID',
    'ModelA_ID', 'ModelA_Name', 'ModelA_URL', 'ModelB_ID', 'ModelB_Name', 'ModelB_URL',
    'LeftModelID', 'RightModelID', 'VoteSide', 'WinnerModelName',
    'SamplingPhase', 'SamplingProbability', 'AnalysisWeight', 'EligiblePairCount', 'SchedulerVersion',
    'GraphConnected', 'ModelA_ArenaScore', 'ModelA_CI95_Lower', 'ModelA_CI95_Upper',
    'ModelB_ArenaScore', 'ModelB_CI95_Lower', 'ModelB_CI95_Upper',
    ...VOTE_AUDIT_CSV_HEADERS,
  ], rows);
};

export const buildInsightDetailCsv = (request: InsightExportRequest) => {
  if (request.bundle.mode === 'ab') return buildAbDetailCsv(request as InsightExportRequest<AbInsightBundle>);
  if (request.bundle.mode === 'rank') return buildRankDetailCsv(request as InsightExportRequest<RankInsightBundle>);
  if (request.bundle.mode === 'score') return buildScoreDetailCsv(request as InsightExportRequest<ScoreInsightBundle>);
  return buildPairwiseDetailCsv(request as InsightExportRequest<PairwiseInsightBundle>);
};

const serializeContext = (context: InsightExportContext) => ({
  projectId: context.projectId,
  projectName: context.projectName,
  materialId: context.materialId,
  materialName: context.materialName,
  evaluationMethod: context.evaluationMethod,
  reviewerScope: context.reviewerScope,
  reviewerScopeLabel: context.reviewerScopeLabel,
});

const buildAbEvidenceCases = (request: InsightExportRequest<AbInsightBundle>) => {
  const votes = effectiveAbVotes(request);
  return request.bundle.cases.map(caseItem => {
    const item = getSourceItem(request.items, undefined, caseItem.itemId);
    const caseVotes = votes.filter(vote => vote.itemId === caseItem.itemId);
    const identity = resolveCaseExportIdentity({ item, vote: caseVotes[0], items: request.items, fallbackCaseId: caseItem.itemId });
    return {
      itemId: caseItem.itemId,
      caseIndex: identity.caseIndex,
      caseId: identity.caseId,
      taskItemId: identity.taskItemId,
      datasetItemId: identity.datasetItemId,
      prompt: caseItem.prompt,
      dimensionValues: caseItem.dimensionValues,
      humanVotes: caseItem.humanVotes,
      aiJudgeRationale: caseItem.aiJudgeRationale || null,
      representativeOutputs: caseItem.representativeOutputs,
      referenceUrls: caseItem.referenceUrls,
      metrics: caseItem.metrics,
      aggregate: {
        votes: caseItem.votes,
        voterCount: caseItem.voterCount,
        winnerSide: caseItem.winnerSide,
        winnerLabel: caseItem.winnerLabel,
        agreementRate: caseItem.agreementRate,
        marginVotes: caseItem.marginVotes,
        marginRate: caseItem.marginRate,
      },
      ballots: caseVotes.map(vote => ({
        reviewerName: vote.user || 'Anonymous',
        timestamp: vote.timestamp,
        vote: vote.vote || vote.choice || null,
        datasetVersionEvaluated: vote.datasetVersionEvaluated ?? vote.evaluatedItemSnapshot?.sourceDatasetVersion ?? null,
        datasetVersionCurrent: vote.datasetVersionCurrent ?? vote.itemSnapshot?.sourceDatasetVersion ?? null,
        contentUpdatedAfterVote: vote.contentUpdatedAfterVote ?? null,
        evaluatedItemSnapshot: vote.evaluatedItemSnapshot || null,
        currentItemSnapshot: vote.itemSnapshot || null,
      })),
    };
  });
};

const buildRankEvidenceCases = (request: InsightExportRequest<RankInsightBundle>) => {
  const votes = getEffectiveVotes(request.votes || []).filter(vote => Array.isArray(vote.ranking) && vote.ranking.length > 0);
  return request.bundle.cases.map(caseItem => {
    const item = getSourceItem(request.items, undefined, caseItem.itemId);
    const caseVotes = votes.filter(vote => vote.itemId === caseItem.itemId);
    const identity = resolveCaseExportIdentity({ item, vote: caseVotes[0], items: request.items, fallbackCaseId: caseItem.itemId });
    return {
      itemId: caseItem.itemId,
      caseIndex: identity.caseIndex,
      caseId: identity.caseId,
      taskItemId: identity.taskItemId,
      datasetItemId: identity.datasetItemId,
      prompt: caseItem.prompt,
      dimensionValues: caseItem.dimensionValues,
      humanVotes: caseItem.humanVotes,
      aiJudgeRationale: caseItem.aiJudgeRationale || null,
      representativeOutputs: caseItem.representativeOutputs,
      referenceUrls: caseItem.referenceUrls,
      metrics: caseItem.metrics,
      consensusRanking: caseItem.consensusRanking,
      aggregate: {
        voterCount: caseItem.voterCount,
        consensusRankingDisplay: formatConsensusRanking(caseItem.consensusRanking),
        consensusLeaders: caseItem.consensusLeaders,
        relationAgreement: caseItem.relationAgreement,
        kendallTauB: caseItem.kendallTau,
        distinctionRate: caseItem.distinctionRate,
        tieBallots: caseItem.tieBallots,
        allTieBallots: caseItem.allTieBallots,
      },
      ballots: caseVotes.map(vote => {
        const ranking = normalizeRanking(vote.ranking);
        return {
          reviewerName: vote.user || 'Anonymous',
          timestamp: vote.timestamp,
          ranking,
          rankingDisplay: formatRanking(ranking),
          tieSummary: getRankingTieSummary(ranking),
          datasetVersionEvaluated: vote.datasetVersionEvaluated ?? vote.evaluatedItemSnapshot?.sourceDatasetVersion ?? null,
          datasetVersionCurrent: vote.datasetVersionCurrent ?? vote.itemSnapshot?.sourceDatasetVersion ?? null,
          contentUpdatedAfterVote: vote.contentUpdatedAfterVote ?? null,
          evaluatedItemSnapshot: vote.evaluatedItemSnapshot || null,
          currentItemSnapshot: vote.itemSnapshot || null,
        };
      }),
    };
  });
};

export const buildInsightEvidenceJson = (request: InsightExportRequest<InsightBundle>) => {
  const cases = request.bundle.mode === 'rank'
    ? buildRankEvidenceCases(request as InsightExportRequest<RankInsightBundle>)
    : buildAbEvidenceCases(request as InsightExportRequest<AbInsightBundle>);
  return JSON.stringify({
    schemaVersion: 2,
    exportedAt: resolveExportTimestamp(request.context),
    context: serializeContext(request.context),
    mode: request.bundle.mode,
    summary: request.bundle.summary,
    models: request.bundle.mode === 'rank' ? request.bundle.models : request.bundle.models,
    dimensions: request.bundle.dimensions,
    pairwise: request.bundle.mode === 'rank' ? request.bundle.pairwise : undefined,
    cases,
  }, null, 2);
};

const overviewRows = (request: InsightExportRequest): ExportCell[][] => {
  const rows: ExportCell[][] = [
    ['项目', request.context.projectName],
    ['项目 ID', request.context.projectId],
    ['评测物料', request.context.materialName],
    ['物料 ID', request.context.materialId],
    ['评测方式', METHOD_LABELS[request.context.evaluationMethod]],
    ['评委范围', request.context.reviewerScopeLabel],
    ['导出时间', resolveExportTimestamp(request.context)],
  ];
  const summary = request.bundle.summary as any;
  if (request.bundle.mode === 'ab') rows.push(
    ['Case 数', summary.itemCount], ['有效票数', summary.totalVotes], ['评委数', summary.voterCount],
    ['领先模型', summary.winnerLabel], ['平均共识度', summary.averageAgreement ?? ''], ['Krippendorff Alpha', summary.krippendorffAlpha ?? ''],
  );
  if (request.bundle.mode === 'rank') rows.push(
    ['Case 数', summary.itemCount], ['排名票数', summary.rankingRecords], ['评委数', summary.voterCount],
    ['领先模型', summary.bestModel], ['平均关系一致率', summary.averageRelationAgreement ?? ''],
    ['平均 Kendall tau-b', summary.averageKendallTau ?? ''], ['平均区分度', summary.averageDistinctionRate],
  );
  if (request.bundle.mode === 'score') rows.push(
    ['Case 数', summary.itemCount], ['评分响应数', summary.responseCount], ['评委数', summary.voterCount],
    ['领先模型', summary.topModelName], ['领先均分', summary.topAverageScore], ['平均标准差', summary.averageStdDev],
  );
  if (request.bundle.mode === 'pairwise') rows.push(
    ['Case 数', summary.itemCount], ['对战数', summary.comparisonCount], ['评委数', summary.voterCount],
    ['领先模型', summary.topModelName], ['对战图连通', summary.connected], ['模型对覆盖率', summary.pairCoverage],
    ['有效样本量', summary.effectiveSampleSize],
  );
  rows.push(
    ['Case ID', '业务用例标识；优先采用投票时快照'],
    ['任务 Item ID', 'ManuEval 任务内部唯一标识'],
    ['数据集行 ID', '源数据集稳定行标识'],
    ['Case 序号', '评测物料中的 1-based 顺序'],
  );
  const missingOptionalSheets: string[] = [];
  if (request.bundle.mode === 'ab' && request.bundle.dimensions.length === 0) {
    missingOptionalSheets.push('维度统计');
  }
  if (request.bundle.mode === 'rank') {
    if (request.bundle.dimensions.length === 0) missingOptionalSheets.push('维度统计');
    if (request.bundle.pairwise.length === 0) missingOptionalSheets.push('两两关系');
  }
  if (request.bundle.mode === 'score' && request.bundle.dimensions.length === 0) {
    missingOptionalSheets.push('维度统计');
  }
  if (request.bundle.mode === 'pairwise') {
    if (request.bundle.matchups.length === 0) missingOptionalSheets.push('模型对统计');
    if (request.bundle.dimensions.length === 0) missingOptionalSheets.push('维度统计');
  }
  rows.push(['未生成的可选 Sheet', missingOptionalSheets.length ? `${missingOptionalSheets.join('、')}（无数据）` : '无']);
  return rows;
};

const identityForCase = (request: InsightExportRequest, itemId: string, fallbackCaseId?: string) => {
  const item = getSourceItem(request.items, undefined, fallbackCaseId || itemId);
  const vote = (request.votes || []).find(candidate => candidate.itemId === itemId
    || candidate.pairContext?.originalItemId === fallbackCaseId);
  return resolveCaseExportIdentity({ item, vote, items: request.items, fallbackCaseId: fallbackCaseId || itemId });
};

const workbookSheetData = (request: InsightExportRequest) => {
  const sheets: Array<{ name: string; headers: string[]; rows: ExportCell[][] }> = [{
    name: '概览', headers: ['项目', '值'], rows: overviewRows(request),
  }];

  if (request.bundle.mode === 'ab') {
    const dimensionKeys = getAllDimensionKeys(request);
    sheets.push({
      name: 'Case统计',
      headers: ['Case序号', 'Case ID', '任务 Item ID', '数据集行 ID', 'Prompt', ...dimensionKeys, '模型 A', '模型 B', 'A 票', 'B 票', '平局票', '评委数', '结论', '共识度', '票差', '票差率'],
      rows: request.bundle.cases.map(item => {
        const identity = identityForCase(request, item.itemId);
        return [identity.caseIndex, identity.caseId, identity.taskItemId, identity.datasetItemId, item.prompt,
          ...dimensionKeys.map(key => item.dimensionValues[key] || ''), item.modelA.modelName, item.modelB.modelName,
          item.votes.A, item.votes.B, item.votes.Tie, item.voterCount, item.winnerLabel,
          item.agreementRate, item.marginVotes, item.marginRate];
      }),
    });
    if (request.bundle.dimensions.length) sheets.push({
      name: '维度统计',
      headers: ['维度', '取值', 'Case数', '总票数', 'A票', 'B票', '平局票', '领先模型', '共识度', '票差率', '非平局A占比', '95%下界', '95%上界', 'P值', '小样本'],
      rows: request.bundle.dimensions.map(item => [item.dimensionKey, item.dimensionValue, item.itemCount, item.totalVotes,
        item.votes.A, item.votes.B, item.votes.Tie, item.winnerLabel, item.agreementRate, item.marginRate,
        item.nonTieAShare, item.confidenceInterval.lower, item.confidenceInterval.upper, item.pValue ?? '', item.smallSample]),
    });
  }

  if (request.bundle.mode === 'rank') {
    sheets.push({
      name: '模型排名',
      headers: ['模型 ID', '模型', '归一化 Borda', '总 Borda', '平均名次', '独占第一', '并列第一', '第一名折算票', '第一名占比', 'Top Tier 次数', '并列次数', '并列率', '参排次数', '95%下界', '95%上界'],
      rows: request.bundle.models.map(model => [model.modelId, model.modelName, model.normalizedScore, model.totalScore,
        model.averageRank, model.outrightFirstCount, model.coFirstCount, model.firstPlaceCredit, model.firstPlaceRate,
        model.firstPlaceCount, model.tieCount, model.tieRate, model.rankedCount,
        model.confidenceInterval.lower, model.confidenceInterval.upper]),
    });
    const dimensionKeys = getAllDimensionKeys(request);
    sheets.push({
      name: 'Case统计',
      headers: ['Case序号', 'Case ID', '任务 Item ID', '数据集行 ID', 'Prompt', ...dimensionKeys, '评委数', '共识排名', '领先模型', '关系一致率', 'Kendall tau-b', '区分度', '含并列票数', '全并列票数', '聚合排名 JSON'],
      rows: request.bundle.cases.map(item => {
        const identity = identityForCase(request, item.itemId);
        return [identity.caseIndex, identity.caseId, identity.taskItemId, identity.datasetItemId, item.prompt,
          ...dimensionKeys.map(key => item.dimensionValues[key] || ''), item.voterCount, formatConsensusRanking(item.consensusRanking),
          item.consensusLeaders.join(' = '), item.relationAgreement ?? '', item.kendallTau ?? '', item.distinctionRate,
          item.tieBallots, item.allTieBallots, JSON.stringify(item.consensusRanking)];
      }),
    });
    if (request.bundle.dimensions.length) sheets.push({
      name: '维度统计',
      headers: ['维度', '取值', 'Case数', '排名票数', '领先模型', '关系一致率', 'Kendall tau-b', '区分度', '并列票率', '小样本', '模型统计 JSON'],
      rows: request.bundle.dimensions.map(item => [item.dimensionKey, item.dimensionValue, item.itemCount, item.rankingRecords,
        item.leadingModel, item.agreement ?? '', item.kendallTauB ?? '', item.distinctionRate, item.tieBallotRate,
        item.smallSample, JSON.stringify(item.modelStats)]),
    });
    if (request.bundle.pairwise.length) sheets.push({
      name: '两两关系',
      headers: ['模型 A', '模型 B', 'A 胜', '平局', 'B 胜', '关系总数', '非平局关系', 'A 优势分', '非平局 A 胜率', '平局率', '95%下界', '95%上界', 'P值'],
      rows: request.bundle.pairwise.map(pair => [pair.modelAName, pair.modelBName, pair.aWins, pair.ties, pair.bWins,
        pair.total, pair.decisiveTotal, pair.aShare, pair.decisiveAShare, pair.tieRate,
        pair.decisiveTotal ? pair.confidenceInterval.lower : '', pair.decisiveTotal ? pair.confidenceInterval.upper : '', pair.pValue ?? '']),
    });
  }

  if (request.bundle.mode === 'score') {
    sheets.push({
      name: '模型评分',
      headers: ['模型 ID', '模型', '平均分', '中位数', '标准差', '评分数', '维度均分 JSON'],
      rows: request.bundle.models.map(model => [model.modelId, model.modelName, model.averageScore, model.medianScore,
        model.stdDev, model.responseCount, JSON.stringify(model.dimensionAverages)]),
    });
    if (request.bundle.dimensions.length) sheets.push({
      name: '维度统计',
      headers: ['维度 ID', '维度', '权重', '模型 ID', '模型', '平均分', '评分数'],
      rows: request.bundle.dimensions.flatMap(dimension => dimension.modelAverages.map(model => [dimension.dimensionId,
        dimension.dimensionName, dimension.weight, model.modelId, model.modelName, model.averageScore, model.responseCount])),
    });
    const dimensionKeys = getAllDimensionKeys(request);
    sheets.push({
      name: 'Case统计',
      headers: ['Case序号', 'Case ID', '任务 Item ID', '数据集行 ID', 'Prompt', ...dimensionKeys, '模型 ID', '模型', '输出 URL', '平均分', '加权分', '评分数', '维度分 JSON', '理由'],
      rows: request.bundle.cases.flatMap(item => {
        const identity = identityForCase(request, item.itemId);
        return item.modelScores.map(model => [identity.caseIndex, identity.caseId, identity.taskItemId, identity.datasetItemId,
          item.prompt, ...dimensionKeys.map(key => item.dimensionValues[key] || ''), model.modelId, model.modelName,
          model.outputUrl, model.averageScore, model.weightedScore, model.responseCount,
          JSON.stringify(model.dimensionScores), model.reasons.join(' | ')]);
      }),
    });
  }

  if (request.bundle.mode === 'pairwise') {
    const pairwiseBundle = request.bundle;
    sheets.push({
      name: '模型榜单',
      headers: ['模型 ID', '模型', 'Arena 分', '95%下界', '95%上界', '排名', '排名下界', '排名上界', '分量', '对战数', '胜', '负', '平', '胜率', '非平局胜率'],
      rows: pairwiseBundle.bradleyTerry.models.map(rating => {
        const raw = pairwiseBundle.models.find(model => model.modelId === rating.modelId);
        const comparable = pairwiseBundle.bradleyTerry.connected;
        return [rating.modelId, rating.modelName, comparable ? rating.rating : '', comparable ? rating.ratingLower : '',
          comparable ? rating.ratingUpper : '', comparable ? rating.rank : '', comparable ? rating.rankLower : '',
          comparable ? rating.rankUpper : '', rating.component, rating.battles, raw?.wins || 0, raw?.losses || 0,
          raw?.ties || 0, raw?.winRate || 0, raw?.nonTieWinRate || 0];
      }),
    });
    if (pairwiseBundle.matchups.length) sheets.push({
      name: '模型对统计',
      headers: ['Pair ID', '模型 A ID', '模型 A', '模型 B ID', '模型 B', 'A 胜', 'B 胜', '平局', '对战数'],
      rows: pairwiseBundle.matchups.map(item => [item.pairKey, item.modelAId, item.modelAName, item.modelBId,
        item.modelBName, item.modelAWins, item.modelBWins, item.ties, item.total]),
    });
    const dimensionKeys = getAllDimensionKeys(request);
    sheets.push({
      name: 'Case统计',
      headers: ['Case序号', 'Case ID', '任务 Item ID', '数据集行 ID', 'Prompt', ...dimensionKeys, '模型 A', '模型 B', 'A 票', 'B 票', '平局票', '结论'],
      rows: pairwiseBundle.cases.map(item => {
        const identity = identityForCase(request, item.itemId, item.originalItemId);
        return [identity.caseIndex, identity.caseId, identity.taskItemId, identity.datasetItemId, item.prompt,
          ...dimensionKeys.map(key => item.dimensionValues[key] || ''), item.modelAName, item.modelBName,
          item.votes.A, item.votes.B, item.votes.Tie, item.winner];
      }),
    });
    if (pairwiseBundle.dimensions.length) sheets.push({
      name: '维度统计',
      headers: ['维度', '取值', 'Case数', '对战数', '图连通', '样本充分', '领先模型', '领先 Arena 分'],
      rows: pairwiseBundle.dimensions.map(item => [item.dimension, item.value, item.itemCount, item.battleCount,
        item.connected, item.sufficient, item.leader, item.leaderScore ?? '']),
    });
  }

  return sheets;
};

const isRateHeader = (header: string) => /率|占比|Share|Rate|Agreement|Distinction|下界|上界/.test(header);

const applyWorksheetLayout = (worksheet: Worksheet, headers: string[], rows: ExportCell[][]) => {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.properties.defaultRowHeight = 18;
  headers.forEach((header, index) => {
    const values = [header, ...rows.map(row => row[index])];
    const maxLength = values.reduce<number>((max, value) => Math.max(max, String(value ?? '').length), 0);
    const column = worksheet.getColumn(index + 1);
    column.width = Math.max(10, Math.min(maxLength + 2, /Prompt|URL|JSON|理由|值/.test(header) ? 48 : 30));
    column.alignment = { vertical: 'top', wrapText: true };
    if (isRateHeader(header)) column.numFmt = '0.00%';
  });
  worksheet.getRow(1).height = 24;
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
};

const addWorkbookSheet = (
  workbook: ExcelWorkbook,
  sheet: { name: string; headers: string[]; rows: ExportCell[][] },
  tableIndex: number,
) => {
  const worksheet = workbook.addWorksheet(sheet.name);
  const safeRows = sheet.rows.map(row => row.map(protectSpreadsheetText));
  worksheet.addTable({
    name: `InsightTable${tableIndex}`,
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: sheet.headers.map(name => ({ name, filterButton: true })),
    rows: safeRows as any[][],
  });
  applyWorksheetLayout(worksheet, sheet.headers, safeRows);
};

export const buildInsightWorkbookBuffer = async (request: InsightExportRequest) => {
  const excelModule = await import('exceljs');
  const WorkbookConstructor = excelModule.Workbook || excelModule.default.Workbook;
  const workbook = new WorkbookConstructor();
  workbook.creator = 'ManuEval';
  workbook.created = new Date(resolveExportTimestamp(request.context));
  workbook.modified = workbook.created;
  workbook.subject = `${request.context.materialName} 结果洞察`;
  workbookSheetData(request).forEach((sheet, index) => addWorkbookSheet(workbook, sheet, index + 1));
  return workbook.xlsx.writeBuffer();
};

const triggerBlobDownload = (filename: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadInsightWorkbook = async (request: InsightExportRequest) => {
  const buffer = await buildInsightWorkbookBuffer(request);
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
  triggerBlobDownload(
    buildInsightArtifactFilename(request.context, '分析报表', 'xlsx'),
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
};

export const downloadInsightDetailCsv = (request: InsightExportRequest) => triggerBlobDownload(
  buildInsightArtifactFilename(request.context, '评审明细', 'csv'),
  new Blob([buildInsightDetailCsv(request)], { type: 'text/csv;charset=utf-8;' }),
);

export const downloadInsightEvidenceJson = (request: InsightExportRequest<InsightBundle>) => triggerBlobDownload(
  buildInsightArtifactFilename(request.context, '证据', 'json'),
  new Blob([buildInsightEvidenceJson(request)], { type: 'application/json;charset=utf-8;' }),
);
