import type { AbInsightBundle, InsightBundle, RankInsightBundle } from './analysisInsights';
import { formatNumber, formatPercent } from './analysisInsights';
import type { PairwiseInsightBundle, ScoreInsightBundle } from './scoringInsights';
import type { EvaluationItem, ModelOutput, VoteRecord } from './types';
import { getVoteReviewerKey } from './taskResults';
import { getVoteModelFeedbackDetails } from './modelFeedback';

export type CaseEvidenceMethod = 'ab' | 'rank' | 'score' | 'pairwise';

export interface CaseReviewRecord {
  id: string;
  reviewer: string;
  reviewerKey: string;
  timestamp?: number;
  summary: string;
  details: string[];
}

export interface CaseEvidenceOutput extends ModelOutput {
  rankLabel?: string;
  metricLabel?: string;
}

export interface CaseEvidenceMetric {
  label: string;
  value: string;
}

export interface CaseEvidenceViewModel {
  method: CaseEvidenceMethod;
  itemId: string;
  originalItemId: string;
  itemOrder: number;
  prompt: string;
  dimensionValues: Record<string, string>;
  mediaType?: EvaluationItem['type'];
  outcomeLabel: string;
  outcomeDetail: string;
  metrics: CaseEvidenceMetric[];
  outputs: CaseEvidenceOutput[];
  referenceUrls: string[];
  reviews: CaseReviewRecord[];
}

type SupportedInsightBundle = InsightBundle | ScoreInsightBundle | PairwiseInsightBundle;
type InsightItem = Partial<EvaluationItem> & { id: string };

const buildItemLookup = (items: InsightItem[]) => {
  const lookup = new Map<string, InsightItem>();
  const orderLookup = new Map<string, number>();
  items.forEach((item, index) => {
    const explicitOrder = Number(item.itemOrder);
    const itemOrder = Number.isFinite(explicitOrder) ? explicitOrder : index;
    lookup.set(item.id, item);
    orderLookup.set(item.id, itemOrder);
    if (item.originalItemId) {
      lookup.set(item.originalItemId, item);
      orderLookup.set(item.originalItemId, itemOrder);
    }
  });
  return { lookup, orderLookup };
};

const getItemOrder = (item: InsightItem | undefined, itemId: string, orderLookup: Map<string, number>) => {
  const explicitOrder = Number(item?.itemOrder);
  if (Number.isFinite(explicitOrder)) return explicitOrder;
  return orderLookup.get(itemId) ?? Number.MAX_SAFE_INTEGER;
};

const sortEvidence = (rows: CaseEvidenceViewModel[]) => rows.sort((left, right) =>
  left.itemOrder - right.itemOrder || left.originalItemId.localeCompare(right.originalItemId) || left.itemId.localeCompare(right.itemId)
);

const toHumanReviews = (
  itemId: string,
  humanVotes: Array<{ user: string; voteLabel: string; timestamp?: number }>,
  votes: VoteRecord[],
): CaseReviewRecord[] => humanVotes.map((vote, index) => {
  const sourceVote = votes.find(candidate =>
    candidate.itemId === itemId
    && candidate.timestamp === vote.timestamp
    && (!vote.user || candidate.user === vote.user)
  ) || votes.find(candidate => candidate.itemId === itemId && candidate.timestamp === vote.timestamp);
  return {
    id: `${itemId}-${vote.timestamp || index}-${index}`,
    reviewer: vote.user || '匿名评委',
    reviewerKey: sourceVote ? getVoteReviewerKey(sourceVote) : vote.user || `anonymous-${index}`,
    timestamp: vote.timestamp,
    summary: vote.voteLabel,
    details: getVoteModelFeedbackDetails(sourceVote),
  };
});

const buildAbEvidence = (bundle: AbInsightBundle, lookup: Map<string, InsightItem>, orderLookup: Map<string, number>, votes: VoteRecord[]) =>
  bundle.cases.map(caseItem => {
    const sourceItem = lookup.get(caseItem.itemId);
    return {
      method: 'ab' as const,
      itemId: caseItem.itemId,
      originalItemId: sourceItem?.originalItemId || caseItem.itemId,
      itemOrder: getItemOrder(sourceItem, caseItem.itemId, orderLookup),
      prompt: caseItem.prompt,
      dimensionValues: caseItem.dimensionValues,
      mediaType: caseItem.mediaType || sourceItem?.type,
      outcomeLabel: caseItem.winnerLabel,
      outcomeDetail: `${caseItem.modelA.modelName} ${caseItem.votes.A} / ${caseItem.modelB.modelName} ${caseItem.votes.B} / 平局 ${caseItem.votes.Tie}`,
      metrics: [
        { label: '共识度', value: formatPercent(caseItem.agreementRate, 0) },
        { label: '领先票差', value: String(caseItem.marginVotes) },
        { label: '评委数', value: String(caseItem.voterCount) },
      ],
      outputs: [caseItem.modelA, caseItem.modelB],
      referenceUrls: caseItem.referenceUrls,
      reviews: toHumanReviews(caseItem.itemId, caseItem.humanVotes, votes),
    };
  });

const buildRankEvidence = (bundle: RankInsightBundle, lookup: Map<string, InsightItem>, orderLookup: Map<string, number>, votes: VoteRecord[]) =>
  bundle.cases.map(caseItem => {
    const sourceItem = lookup.get(caseItem.itemId);
    const outputLookup = new Map(caseItem.representativeOutputs.flatMap(output => [
      [output.modelId, output],
      [output.modelName, output],
    ]));
    const outputs = caseItem.consensusRanking.map(model => {
      const output = outputLookup.get(model.modelId) || outputLookup.get(model.modelName);
      const rank = model
        ? caseItem.consensusRanking.findIndex(candidate => Math.abs(candidate.normalizedScore - model.normalizedScore) < 1e-9) + 1
        : 0;
      const tied = model
        ? caseItem.consensusRanking.filter(candidate => Math.abs(candidate.normalizedScore - model.normalizedScore) < 1e-9).length > 1
        : false;
      return {
        modelId: model.modelId,
        modelName: model.modelName,
        url: output?.url || '',
        rankLabel: rank ? `${tied ? '并列 ' : ''}#${rank}` : undefined,
        metricLabel: model ? `归一化 Borda ${formatPercent(model.normalizedScore, 1)}` : undefined,
      };
    });
    return {
      method: 'rank' as const,
      itemId: caseItem.itemId,
      originalItemId: sourceItem?.originalItemId || caseItem.itemId,
      itemOrder: getItemOrder(sourceItem, caseItem.itemId, orderLookup),
      prompt: caseItem.prompt,
      dimensionValues: caseItem.dimensionValues,
      mediaType: caseItem.mediaType || sourceItem?.type,
      outcomeLabel: caseItem.consensusLeaders.join(' = ') || '暂无明确领先',
      outcomeDetail: `共 ${caseItem.voterCount} 份排名记录，含并列 ${caseItem.tieBallots} 份`,
      metrics: [
        { label: '关系一致率', value: formatPercent(caseItem.relationAgreement, 0) },
        { label: '区分度', value: formatPercent(caseItem.distinctionRate, 0) },
        { label: 'Kendall tau-b', value: formatNumber(caseItem.kendallTau, 2) },
      ],
      outputs,
      referenceUrls: caseItem.referenceUrls,
      reviews: toHumanReviews(caseItem.itemId, caseItem.humanVotes, votes),
    };
  });

const formatScoreReview = (vote: VoteRecord, index: number): CaseReviewRecord => {
  const responses = Object.values(vote.rubricResponses || {});
  const summaries = responses.map(response => {
    const scoreValues = Object.values(response.scores || {}).filter(Number.isFinite);
    const average = scoreValues.length ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length : null;
    return `${response.modelName || response.modelId}: ${average === null ? '-' : formatNumber(average, 2)}`;
  });
  const details = responses.flatMap(response => [
    response.reason ? `${response.modelName || response.modelId}：${response.reason}` : '',
    ...Object.entries(response.answers || {}).map(([key, value]) => `${response.modelName || response.modelId} · ${key}：${value}`),
  ]).filter(Boolean);
  return {
    id: `${vote.itemId}-${vote.timestamp || index}-${index}`,
    reviewer: vote.user || '匿名评委',
    reviewerKey: getVoteReviewerKey(vote),
    timestamp: vote.timestamp,
    summary: summaries.join('；') || '已提交评分',
    details,
  };
};

const buildScoreEvidence = (
  bundle: ScoreInsightBundle,
  lookup: Map<string, InsightItem>,
  orderLookup: Map<string, number>,
  votes: VoteRecord[],
) => bundle.cases.map(caseItem => {
  const sourceItem = lookup.get(caseItem.itemId);
  const sortedScores = [...caseItem.modelScores].sort((left, right) => right.weightedScore - left.weightedScore);
  const topScore = sortedScores[0]?.weightedScore;
  const leaders = topScore === undefined
    ? []
    : sortedScores.filter(model => Math.abs(model.weightedScore - topScore) < 1e-9).map(model => model.modelName);
  const reviews = votes.filter(vote => vote.itemId === caseItem.itemId && vote.rubricResponses)
    .map(formatScoreReview);
  return {
    method: 'score' as const,
    itemId: caseItem.itemId,
    originalItemId: sourceItem?.originalItemId || caseItem.itemId,
    itemOrder: getItemOrder(sourceItem, caseItem.itemId, orderLookup),
    prompt: caseItem.prompt,
    dimensionValues: caseItem.dimensionValues,
    mediaType: sourceItem?.type,
    outcomeLabel: leaders.join(' = ') || '暂无评分',
    outcomeDetail: sortedScores.map(model => `${model.modelName} ${formatNumber(model.weightedScore, 2)}`).join(' / '),
    metrics: [
      { label: '最高加权分', value: formatNumber(topScore, 2) },
      { label: '模型数', value: String(caseItem.modelScores.length) },
      { label: '评审记录', value: String(reviews.length) },
    ],
    outputs: [
      ...caseItem.representativeOutputs.map(output => {
        const score = caseItem.modelScores.find(model => model.modelId === output.modelId || model.modelName === output.modelName);
        return { ...output, metricLabel: score ? `加权分 ${formatNumber(score.weightedScore, 2)}` : undefined };
      }),
      ...caseItem.modelScores
        .filter(score => !caseItem.representativeOutputs.some(output => output.modelId === score.modelId || output.modelName === score.modelName))
        .map(score => ({
          modelId: score.modelId,
          modelName: score.modelName,
          url: score.outputUrl || '',
          metricLabel: `加权分 ${formatNumber(score.weightedScore, 2)}`,
        })),
    ],
    referenceUrls: sourceItem?.referenceUrls || [],
    reviews,
  };
});

const buildPairwiseEvidence = (
  bundle: PairwiseInsightBundle,
  lookup: Map<string, InsightItem>,
  orderLookup: Map<string, number>,
  votes: VoteRecord[],
) => bundle.cases.map(caseItem => {
  const sourceItem = lookup.get(caseItem.originalItemId) || lookup.get(caseItem.itemId);
  const matchupKey = caseItem.itemId.slice(caseItem.itemId.indexOf('::') + 2);
  const reviews = bundle.battles
    .filter(battle => battle.originalItemId === caseItem.originalItemId
      && [battle.modelAId, battle.modelBId].sort().join('__') === matchupKey)
    .map((battle, index) => {
      const sourceVote = votes.find(vote =>
        Boolean(battle.assignmentId) && vote.pairContext?.assignmentId === battle.assignmentId
      ) || votes.find(vote =>
        vote.itemId === battle.itemId
        && vote.timestamp === battle.timestamp
        && (!battle.reviewerKey || getVoteReviewerKey(vote) === battle.reviewerKey)
      );
      return {
        id: battle.assignmentId || `${battle.itemId}-${battle.timestamp}-${index}`,
        reviewer: battle.user || '匿名评委',
        reviewerKey: battle.reviewerKey || battle.user || `anonymous-${index}`,
        timestamp: battle.timestamp,
        summary: battle.vote === 'Tie' ? '选择 平局' : `选择 ${battle.winnerModelName}`,
        details: [
          battle.samplingPhase ? `采样阶段：${battle.samplingPhase}` : '',
          Number.isFinite(battle.samplingProbability) ? `采样概率：${formatPercent(battle.samplingProbability, 1)}` : '',
          Number.isFinite(battle.analysisWeight) ? `分析权重：${formatNumber(battle.analysisWeight, 3)}` : '',
          ...getVoteModelFeedbackDetails(sourceVote),
        ].filter(Boolean),
      };
    });
  return {
    method: 'pairwise' as const,
    itemId: caseItem.itemId,
    originalItemId: caseItem.originalItemId,
    itemOrder: getItemOrder(sourceItem, caseItem.originalItemId, orderLookup),
    prompt: caseItem.prompt,
    dimensionValues: caseItem.dimensionValues,
    mediaType: sourceItem?.type,
    outcomeLabel: caseItem.winner || '暂无明确胜者',
    outcomeDetail: `${caseItem.modelAName} ${caseItem.votes.A} / ${caseItem.modelBName} ${caseItem.votes.B} / 平局 ${caseItem.votes.Tie}`,
    metrics: [
      { label: '有效对战', value: String(caseItem.votes.A + caseItem.votes.B + caseItem.votes.Tie) },
      { label: '非平局票', value: String(caseItem.votes.A + caseItem.votes.B) },
      { label: '评审记录', value: String(reviews.length) },
    ],
    outputs: [
      {
        modelId: caseItem.representativeOutputs.find(output => output.modelName === caseItem.modelAName)?.modelId || caseItem.modelAName,
        modelName: caseItem.modelAName,
        url: caseItem.representativeOutputs.find(output => output.modelName === caseItem.modelAName)?.url || '',
      },
      {
        modelId: caseItem.representativeOutputs.find(output => output.modelName === caseItem.modelBName)?.modelId || caseItem.modelBName,
        modelName: caseItem.modelBName,
        url: caseItem.representativeOutputs.find(output => output.modelName === caseItem.modelBName)?.url || '',
      },
    ],
    referenceUrls: sourceItem?.referenceUrls || [],
    reviews,
  };
});

export const buildCaseEvidenceViewModels = ({
  bundle,
  items,
  votes = [],
}: {
  bundle: SupportedInsightBundle;
  items: InsightItem[];
  votes?: VoteRecord[];
}): CaseEvidenceViewModel[] => {
  const { lookup, orderLookup } = buildItemLookup(items);
  const rows = bundle.mode === 'ab'
    ? buildAbEvidence(bundle, lookup, orderLookup, votes)
    : bundle.mode === 'rank'
      ? buildRankEvidence(bundle, lookup, orderLookup, votes)
      : bundle.mode === 'score'
        ? buildScoreEvidence(bundle, lookup, orderLookup, votes)
        : buildPairwiseEvidence(bundle, lookup, orderLookup, votes);
  return sortEvidence(rows);
};
