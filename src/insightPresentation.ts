import {
  AbInsightBundle,
  RankInsightBundle,
  buildAbInsights,
  buildRankInsights,
  formatNumber,
  formatPValue,
  formatPercent,
  getSignificanceLabel,
} from './analysisInsights';
import { getEvaluationMethodShortLabel, normalizeEvaluationConfig } from './evaluationMethods';
import {
  PairwiseInsightBundle,
  ScoreInsightBundle,
  buildPairwiseInsights,
  buildScoreInsights,
} from './scoringInsights';
import type {
  EvalTask,
  EvalTemplate,
  EvaluationMethod,
  TaskVoteGroup,
  VoteRecord,
} from './types';
import { withTaskVoteGroupReviewer } from './taskResults';

export type AnalysisScopeMode = 'comparable-group' | 'single-task';
export type InsightTone = 'neutral' | 'accent' | 'success' | 'warning';

export interface InsightMetricDetail {
  meaning: string;
  calculation: string;
  inputs: Array<{ label: string; value: string }>;
  limitation?: string;
}

export interface InsightTopMetric {
  id: string;
  label: string;
  value: string;
  secondary: string;
  tone?: InsightTone;
  detail: InsightMetricDetail;
}

export interface InsightDistributionSegment {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  color: 'model-a' | 'model-b' | 'tie' | 'accent' | 'success' | 'neutral';
}

export interface InsightTopSummary {
  headline: string;
  basis: string;
  supporting: string;
  tone: InsightTone;
  distribution?: {
    label: string;
    style: 'stacked' | 'bars';
    segments: InsightDistributionSegment[];
  };
  metrics: InsightTopMetric[];
}

export interface ProjectResultGroupDigest {
  id: string;
  label: string;
  method: EvaluationMethod;
  methodLabel: string;
  taskIds: string[];
  taskCount: number;
  phase: 'pending' | 'in-progress' | 'completed';
  leaderLabel: string;
  headline: string;
  basis: string;
  supporting: string;
  validRecordCount: number;
  evaluatedItemCount: number;
  totalItemCount: number;
  voterCount: number;
  visualization: 'stacked' | 'bars';
  segments: InsightDistributionSegment[];
}

const formatInteger = (value: number) => Math.max(0, Math.round(value)).toLocaleString('zh-CN');

const metric = (
  id: string,
  label: string,
  value: string,
  secondary: string,
  detail: InsightMetricDetail,
  tone: InsightTone = 'neutral',
): InsightTopMetric => ({ id, label, value, secondary, detail, tone });

const analysisStatus = (pValue: number | null) => {
  if (pValue === null) return '当前样本不足';
  if (pValue < 0.05) return '当前差异较明确';
  return '当前差异尚未确认';
};

const getLeaderConfidenceInterval = (bundle: AbInsightBundle) => {
  if (bundle.summary.winnerSide !== 'B') return bundle.summary.confidenceInterval;
  return {
    lower: 1 - bundle.summary.confidenceInterval.upper,
    upper: 1 - bundle.summary.confidenceInterval.lower,
  };
};

export const buildAbTopSummary = (bundle: AbInsightBundle, totalItemCount = bundle.summary.itemCount): InsightTopSummary => {
  const { summary, models } = bundle;
  const hasLeader = summary.winnerSide !== 'Tie' && summary.totalVotes > 0;
  const leaderName = hasLeader ? summary.winnerLabel : '';
  const opponentName = summary.winnerSide === 'B' ? models.a : models.b;
  const opponentVotes = summary.winnerSide === 'B' ? summary.votes.A : summary.votes.B;
  const leaderNonTieShare = summary.winnerSide === 'B' ? summary.nonTieBShare : summary.nonTieAShare;
  const interval = getLeaderConfidenceInterval(bundle);
  const headline = hasLeader ? `${leaderName} 当前领先` : '当前尚未分出明确领先模型';
  const basis = hasLeader
    ? `${leaderName} ${summary.winnerVotes} 票 vs ${opponentName} ${opponentVotes} 票，平局 ${summary.votes.Tie} 票`
    : `${models.a} ${summary.votes.A} 票 vs ${models.b} ${summary.votes.B} 票，平局 ${summary.votes.Tie} 票`;
  const supporting = hasLeader
    ? `${leaderName} 的非平局票占比为 ${formatPercent(leaderNonTieShare, 1)}，${analysisStatus(summary.pValue)}。`
    : `当前票数没有形成单一领先方向，${analysisStatus(summary.pValue)}。`;
  const totalItems = Math.max(totalItemCount, summary.itemCount);

  return {
    headline,
    basis,
    supporting,
    tone: summary.pValue !== null && summary.pValue < 0.05 ? 'success' : 'accent',
    distribution: {
      label: '票数分布',
      style: 'stacked',
      segments: [
        { id: 'A', label: models.a, value: summary.votes.A, displayValue: `${summary.votes.A} 票`, color: 'model-a' },
        { id: 'B', label: models.b, value: summary.votes.B, displayValue: `${summary.votes.B} 票`, color: 'model-b' },
        { id: 'Tie', label: '平局', value: summary.votes.Tie, displayValue: `${summary.votes.Tie} 票`, color: 'tie' },
      ],
    },
    metrics: [
      metric('coverage', '评测覆盖', `${summary.itemCount}/${totalItems} case`, `${summary.totalVotes} 票 · ${summary.voterCount} 位评委`, {
        meaning: '有至少一条有效投票的 case 数量，以及参与本次结果的有效投票和评委规模。',
        calculation: '已评 case 为有效投票中的唯一 ItemID 数；有效票数为 A、B、平局票之和。',
        inputs: [
          { label: '已评 case', value: formatInteger(summary.itemCount) },
          { label: '总 case', value: formatInteger(totalItems) },
          { label: '有效票数', value: formatInteger(summary.totalVotes) },
          { label: '独立评委', value: formatInteger(summary.voterCount) },
        ],
        limitation: '跳过记录和没有有效选择的记录不会进入统计。',
      }),
      metric('lead', '领先幅度', hasLeader ? `领先 ${summary.marginVotes} 票` : '暂无领先', `非平局占比 ${formatPercent(leaderNonTieShare, 1)} · 平局 ${formatPercent(summary.tieRate, 1)}`, {
        meaning: '领先模型与另一模型的票数差，以及剔除平局后领先模型所占的票数比例。',
        calculation: '领先票数 = |A 票 - B 票|；非平局占比 = 领先模型票数 / (A 票 + B 票)。',
        inputs: [
          { label: `${models.a} 票数`, value: formatInteger(summary.votes.A) },
          { label: `${models.b} 票数`, value: formatInteger(summary.votes.B) },
          { label: '平局票数', value: formatInteger(summary.votes.Tie) },
          { label: '非平局票数', value: formatInteger(summary.nonTieVotes) },
        ],
        limitation: '领先只描述当前票数方向，不等同于统计显著。',
      }, hasLeader ? 'accent' : 'neutral'),
      metric('confidence', '统计可信度', `p = ${formatPValue(summary.pValue)}`, `95% CI ${formatPercent(interval.lower, 1)}–${formatPercent(interval.upper, 1)}`, {
        meaning: '用于判断当前非平局偏好是否可能只是随机波动，并展示领先模型票占比的不确定范围。',
        calculation: 'p-value 使用 A/B 非平局票的双侧二项符号检验；区间使用 Wilson 95% 置信区间。',
        inputs: [
          { label: 'A 非平局票', value: formatInteger(summary.votes.A) },
          { label: 'B 非平局票', value: formatInteger(summary.votes.B) },
          { label: 'p-value', value: formatPValue(summary.pValue) },
          { label: '显著性判断', value: getSignificanceLabel(summary.pValue) },
        ],
        limitation: '该检验沿用平台现有计算口径；小样本结果应结合 case 分布和评委一致性阅读。',
      }, summary.pValue !== null && summary.pValue < 0.05 ? 'success' : 'warning'),
      metric('agreement', '评委一致性', formatPercent(summary.averageAgreement, 0), `低共识 ${summary.lowConsensusCount} case · Alpha ${formatNumber(summary.krippendorffAlpha, 2)}`, {
        meaning: '多数票在每个 case 中的平均占比，并辅以低共识 case 数和名义型 Krippendorff’s alpha。',
        calculation: '多数共识为每个 case 的最高票数 / 该 case 总票数后取平均；低于 60% 记为低共识。',
        inputs: [
          { label: '平均多数共识', value: formatPercent(summary.averageAgreement, 1) },
          { label: '低共识 case', value: formatInteger(summary.lowConsensusCount) },
          { label: 'Krippendorff’s alpha', value: formatNumber(summary.krippendorffAlpha, 3) },
        ],
        limitation: '一致性衡量评委是否给出相近判断，不直接代表模型质量高低。',
      }),
    ],
  };
};

export const buildRankTopSummary = (bundle: RankInsightBundle, totalItemCount = bundle.summary.itemCount): InsightTopSummary => {
  const leader = bundle.summary.bestModels.join(' = ') || '暂无领先模型';
  const leadingModel = bundle.models[0];
  const totalItems = Math.max(totalItemCount, bundle.summary.itemCount);
  const segments = bundle.models.slice(0, 4).map((model, index): InsightDistributionSegment => ({
    id: model.modelId,
    label: model.modelName,
    value: model.normalizedScore,
    displayValue: formatPercent(model.normalizedScore, 1),
    color: index === 0 ? 'accent' : 'neutral',
  }));

  return {
    headline: leadingModel ? `${leader} 当前领先` : '尚无有效排名结果',
    basis: leadingModel
      ? `归一化 Borda ${formatPercent(leadingModel.normalizedScore, 1)}，平均名次 ${formatNumber(leadingModel.averageRank, 2)}`
      : '完成首条有效排序后将生成排名摘要。',
    supporting: `${bundle.summary.rankingRecords} 条排名记录，关系一致率 ${formatPercent(bundle.summary.averageRelationAgreement, 0)}。`,
    tone: 'accent',
    distribution: { label: '领先模型得分', style: 'bars', segments },
    metrics: [
      metric('coverage', '评测覆盖', `${bundle.summary.itemCount}/${totalItems} case`, `${bundle.summary.rankingRecords} 条排序 · ${bundle.summary.voterCount} 位评委`, {
        meaning: '有有效排序记录的 case、排序票数和参与评委规模。',
        calculation: '按有效 rank_order 记录中的唯一 ItemID 和用户去重统计。',
        inputs: [
          { label: '已评 case', value: formatInteger(bundle.summary.itemCount) },
          { label: '总 case', value: formatInteger(totalItems) },
          { label: '排序记录', value: formatInteger(bundle.summary.rankingRecords) },
          { label: '评委', value: formatInteger(bundle.summary.voterCount) },
        ],
      }),
      metric('leader', '领先表现', formatPercent(leadingModel?.normalizedScore, 1), `平均名次 ${formatNumber(leadingModel?.averageRank, 2)} · 第一名份额 ${formatPercent(leadingModel?.firstPlaceRate, 1)}`, {
        meaning: '领先模型的归一化 Borda 得分、平均名次和第一名份额。',
        calculation: '并列名次使用 mid-rank 与并列校正 Borda；第一名份额在并列第一模型间均分。',
        inputs: [
          { label: '领先模型', value: leader },
          { label: '归一化 Borda', value: formatPercent(leadingModel?.normalizedScore, 2) },
          { label: '平均名次', value: formatNumber(leadingModel?.averageRank, 3) },
          { label: '参与排名数', value: formatInteger(leadingModel?.rankedCount || 0) },
        ],
      }, 'accent'),
      metric('agreement', '排序一致性', formatPercent(bundle.summary.averageRelationAgreement, 0), `tau-b ${formatNumber(bundle.summary.averageKendallTau, 2)} · 低共识 ${bundle.summary.lowConsensusCount} case`, {
        meaning: '评委在模型两两关系上的一致程度，并用 Kendall tau-b 辅助衡量排序接近程度。',
        calculation: '逐 case 计算关系一致率和评委排序间的 Kendall tau-b，再对可计算 case 取平均。',
        inputs: [
          { label: '关系一致率', value: formatPercent(bundle.summary.averageRelationAgreement, 1) },
          { label: '平均 tau-b', value: formatNumber(bundle.summary.averageKendallTau, 3) },
          { label: '低共识 case', value: formatInteger(bundle.summary.lowConsensusCount) },
        ],
      }),
      metric('ties', '排序区分度', formatPercent(bundle.summary.averageDistinctionRate, 0), `含并列票 ${formatPercent(bundle.summary.tieBallotRate, 0)} · 全并列 ${formatPercent(bundle.summary.allTieBallotRate, 0)}`, {
        meaning: '排序结果能够明确区分模型先后的程度，并展示含并列和全部并列的投票比例。',
        calculation: '区分度为投票中有明确先后关系的模型对占全部模型对的比例。',
        inputs: [
          { label: '平均区分度', value: formatPercent(bundle.summary.averageDistinctionRate, 1) },
          { label: '含并列票', value: formatInteger(bundle.summary.tieBallots) },
          { label: '全部并列票', value: formatInteger(bundle.summary.allTieBallots) },
        ],
        limitation: '并列可能表示模型接近，也可能来自 case 难以判断，需要结合下方逐 case 证据阅读。',
      }, bundle.summary.lowDistinctionCount ? 'warning' : 'neutral'),
    ],
  };
};

export const buildScoreTopSummary = (bundle: ScoreInsightBundle, totalItemCount = bundle.summary.itemCount): InsightTopSummary => {
  const leader = bundle.models[0];
  const runnerUp = bundle.models[1];
  const totalItems = Math.max(totalItemCount, bundle.summary.itemCount);
  return {
    headline: leader ? `${leader.modelName} 当前评分最高` : '尚无有效评分结果',
    basis: leader
      ? `平均分 ${formatNumber(leader.averageScore, 2)}${runnerUp ? `，领先 ${runnerUp.modelName} ${formatNumber(leader.averageScore - runnerUp.averageScore, 2)} 分` : ''}`
      : '完成首条有效评分后将生成摘要。',
    supporting: `${bundle.summary.responseCount} 条模型评分，${bundle.summary.voterCount} 位评委参与。`,
    tone: 'accent',
    distribution: {
      label: '模型平均分',
      style: 'bars',
      segments: bundle.models.slice(0, 4).map((model, index) => ({
        id: model.modelId,
        label: model.modelName,
        value: model.averageScore,
        displayValue: formatNumber(model.averageScore, 2),
        color: index === 0 ? 'accent' : 'neutral',
      })),
    },
    metrics: [
      metric('coverage', '评测覆盖', `${bundle.summary.itemCount}/${totalItems} case`, `${bundle.summary.responseCount} 条模型评分`, {
        meaning: '有有效评分的 case 数量和模型评分记录总量。',
        calculation: '已评 case 按有效 rubricResponses 的唯一 ItemID 统计；每个模型的一次有效评分计一条模型评分。',
        inputs: [
          { label: '已评 case', value: formatInteger(bundle.summary.itemCount) },
          { label: '总 case', value: formatInteger(totalItems) },
          { label: '模型评分记录', value: formatInteger(bundle.summary.responseCount) },
        ],
      }),
      metric('leader', '领先模型', leader?.modelName || '-', `${formatNumber(leader?.averageScore, 2)} 平均分`, {
        meaning: '按当前评测配置加权后的平均分最高模型。',
        calculation: '先按维度权重计算每条模型评分，再对该模型的全部有效评分取平均。',
        inputs: [
          { label: '领先模型', value: leader?.modelName || '-' },
          { label: '平均分', value: formatNumber(leader?.averageScore, 3) },
          { label: '中位数', value: formatNumber(leader?.medianScore, 3) },
          { label: '评分记录', value: formatInteger(leader?.responseCount || 0) },
        ],
      }, 'accent'),
      metric('reviewers', '参与评委', formatInteger(bundle.summary.voterCount), `${bundle.summary.responseCount} 条有效模型评分`, {
        meaning: '至少提交一条有效评分的独立评委数量。',
        calculation: '按有效评分记录中的 user 字段去重。',
        inputs: [
          { label: '独立评委', value: formatInteger(bundle.summary.voterCount) },
          { label: '有效模型评分', value: formatInteger(bundle.summary.responseCount) },
        ],
      }),
      metric('dispersion', '评分分歧', formatNumber(bundle.summary.averageStdDev, 2), '各模型评分标准差的平均值', {
        meaning: '评委给分的离散程度，数值越大表示评分分歧通常越明显。',
        calculation: '分别计算各模型全部有效评分的总体标准差，再对模型标准差取平均。',
        inputs: bundle.models.map(model => ({ label: model.modelName, value: `标准差 ${formatNumber(model.stdDev, 3)}` })),
        limitation: '标准差受量表范围和样本量影响，应结合各模型评分数阅读。',
      }),
    ],
  };
};

export const buildPairwiseTopSummary = (bundle: PairwiseInsightBundle, totalItemCount = bundle.summary.itemCount): InsightTopSummary => {
  const leader = bundle.summary.connected ? bundle.bradleyTerry.models[0] : undefined;
  const totalItems = Math.max(totalItemCount, bundle.summary.itemCount);
  const maturityLabel = bundle.summary.maturity === 'ready'
    ? '数据可读'
    : bundle.summary.maturity === 'warming'
      ? '数据仍在积累'
      : '对战覆盖不足';
  return {
    headline: leader ? `${leader.modelName} 当前领先` : '竞技场结果仍在积累',
    basis: leader
      ? `Arena Score ${formatNumber(leader.rating, 1)}，95% CI ${formatNumber(leader.ratingLower, 1)}–${formatNumber(leader.ratingUpper, 1)}`
      : '对战图尚未连通，暂不生成跨分量总排名。',
    supporting: `${bundle.summary.comparisonCount} 场有效对战，模型对覆盖 ${formatPercent(bundle.summary.pairCoverage, 1)}。`,
    tone: bundle.summary.maturity === 'ready' ? 'success' : 'accent',
    distribution: {
      label: '模型非平局胜率',
      style: 'bars',
      segments: bundle.models.slice(0, 4).map((model, index) => ({
        id: model.modelId,
        label: model.modelName,
        value: model.nonTieWinRate,
        displayValue: formatPercent(model.nonTieWinRate, 1),
        color: index === 0 ? 'accent' : 'neutral',
      })),
    },
    metrics: [
      metric('coverage', '评测覆盖', `${bundle.summary.itemCount}/${totalItems} case`, `${bundle.summary.comparisonCount} 场对战 · ${bundle.summary.voterCount} 位评委`, {
        meaning: '实际参与对战的 case 数、有效对战数和独立评委数。',
        calculation: '按有效 pairwise 记录中的 originalItemId、投票记录和 user 字段分别去重或计数。',
        inputs: [
          { label: '已评 case', value: formatInteger(bundle.summary.itemCount) },
          { label: '总 case', value: formatInteger(totalItems) },
          { label: '有效对战', value: formatInteger(bundle.summary.comparisonCount) },
          { label: '评委', value: formatInteger(bundle.summary.voterCount) },
        ],
      }),
      metric('arena-score', '领先表现', leader ? formatNumber(leader.rating, 1) : '-', leader ? `${leader.modelName} · Arena Score` : '等待对战图连通', {
        meaning: '在对战图连通时，通过 Bradley-Terry 模型估计的相对竞技场得分。',
        calculation: '使用有效两两对战及其采样权重拟合 Bradley-Terry 模型，并归一化为 Arena Score。',
        inputs: [
          { label: '领先模型', value: leader?.modelName || '尚不可比较' },
          { label: 'Arena Score', value: formatNumber(leader?.rating, 3) },
          { label: '区间下界', value: formatNumber(leader?.ratingLower, 3) },
          { label: '区间上界', value: formatNumber(leader?.ratingUpper, 3) },
        ],
        limitation: '对战图未连通时，不同连通分量之间不能形成可靠总排名。',
      }, leader ? 'accent' : 'warning'),
      metric('pair-coverage', '模型对覆盖', formatPercent(bundle.summary.pairCoverage, 1), bundle.summary.connected ? '对战图已连通' : '对战图尚未连通', {
        meaning: '实际出现过对战的模型对，占全部可能模型对的比例。',
        calculation: '已覆盖模型对数 / n(n-1)/2。',
        inputs: [
          { label: '模型对覆盖率', value: formatPercent(bundle.summary.pairCoverage, 2) },
          { label: '对战图状态', value: bundle.summary.connected ? '已连通' : '未连通' },
        ],
      }, bundle.summary.connected ? 'success' : 'warning'),
      metric('maturity', '数据成熟度', maturityLabel, `有效样本量 ${formatNumber(bundle.summary.effectiveSampleSize, 1)}`, {
        meaning: '综合对战图连通性和有效对战规模，对当前结果是否足以阅读进行提示。',
        calculation: '先检查对战图是否连通；连通后按总对战数与模型数量的最低规模判断预热或可读。',
        inputs: [
          { label: '状态', value: maturityLabel },
          { label: '有效样本量', value: formatNumber(bundle.summary.effectiveSampleSize, 2) },
          { label: '有效对战', value: formatInteger(bundle.summary.comparisonCount) },
        ],
        limitation: '成熟度是阅读提示，不替代具体模型区间和模型对结果。',
      }, bundle.summary.maturity === 'ready' ? 'success' : 'warning'),
    ],
  };
};

const prefixVote = (taskId: string, vote: VoteRecord): VoteRecord => ({
  ...vote,
  itemId: `${taskId}::${vote.itemId}`,
  pairContext: vote.pairContext ? {
    ...vote.pairContext,
    originalItemId: `${taskId}::${vote.pairContext.originalItemId || vote.itemId}`,
    assignmentId: vote.pairContext.assignmentId ? `${taskId}::${vote.pairContext.assignmentId}` : undefined,
  } : undefined,
});

export const getComparableTaskSignature = (task: EvalTask, template?: EvalTemplate) => {
  const config = normalizeEvaluationConfig(task, template);
  const modelSignature = (task.models || []).map(model => `${model.id}:${model.name}`).join('|');
  return `${config.method}::${task.outputType || 'unknown'}::${modelSignature}`;
};

export const getAnalysisScopeStorageKey = (projectId: string) => `manueval:analysis-scope:${projectId}`;

export const buildProjectResultGroupDigests = ({
  tasks,
  voteGroupsByTask,
  templates = [],
}: {
  tasks: EvalTask[];
  voteGroupsByTask: Map<string, TaskVoteGroup[]>;
  templates?: EvalTemplate[];
}): ProjectResultGroupDigest[] => {
  const grouped = new Map<string, EvalTask[]>();
  tasks.forEach(task => {
    const template = templates.find(candidate => candidate.id === task.templateId);
    const signature = getComparableTaskSignature(task, template);
    grouped.set(signature, [...(grouped.get(signature) || []), task]);
  });

  return Array.from(grouped.entries()).map(([id, groupTasks]) => {
    const firstTask = groupTasks[0];
    const template = templates.find(candidate => candidate.id === firstTask.templateId);
    const config = normalizeEvaluationConfig(firstTask, template);
    const models = firstTask.models?.length ? firstTask.models : [
      { id: 'model-a', name: 'Model A' },
      { id: 'model-b', name: 'Model B' },
    ];
    const votes = groupTasks.flatMap(task =>
      (voteGroupsByTask.get(task.id) || []).flatMap(group =>
        withTaskVoteGroupReviewer(group).map(vote => prefixVote(task.id, vote)),
      ),
    );
    const totalItemCount = groupTasks.reduce((sum, task) => sum + (task.totalItems || 0), 0);
    let top: InsightTopSummary;
    let validRecordCount = 0;
    let evaluatedItemCount = 0;
    let voterCount = 0;

    if (config.method === 'rank_order') {
      const bundle = buildRankInsights({ items: [], votes, models });
      top = buildRankTopSummary(bundle, totalItemCount);
      validRecordCount = bundle.summary.rankingRecords;
      evaluatedItemCount = bundle.summary.itemCount;
      voterCount = bundle.summary.voterCount;
    } else if (config.method === 'direct_score' || config.method === 'rubric_score') {
      const bundle = buildScoreInsights({ items: [], votes, models, config });
      top = buildScoreTopSummary(bundle, totalItemCount);
      validRecordCount = bundle.summary.responseCount;
      evaluatedItemCount = bundle.summary.itemCount;
      voterCount = bundle.summary.voterCount;
    } else if (config.method === 'pairwise') {
      const bundle = buildPairwiseInsights({ items: [], votes, models });
      top = buildPairwiseTopSummary(bundle, totalItemCount);
      validRecordCount = bundle.summary.comparisonCount;
      evaluatedItemCount = bundle.summary.itemCount;
      voterCount = bundle.summary.voterCount;
    } else {
      const bundle = buildAbInsights({
        items: [],
        votes,
        modelNames: { a: models[0]?.name || 'Model A', b: models[1]?.name || 'Model B' },
      });
      top = buildAbTopSummary(bundle, totalItemCount);
      validRecordCount = bundle.summary.totalVotes;
      evaluatedItemCount = bundle.summary.itemCount;
      voterCount = bundle.summary.voterCount;
    }

    const phase: ProjectResultGroupDigest['phase'] = groupTasks.every(task => task.status === 'completed')
      ? 'completed'
      : validRecordCount > 0 || groupTasks.some(task => task.status === 'active')
        ? 'in-progress'
        : 'pending';
    const leaderLabel = config.method === 'rank_order'
      ? top.headline.replace(/ 当前领先$/, '')
      : config.method === 'pairwise' && !top.headline.endsWith('当前领先')
        ? ''
        : top.headline.replace(/ 当前领先$| 当前评分最高$/, '');

    const visualization: ProjectResultGroupDigest['visualization'] = config.method === 'ab_preference' ? 'stacked' : 'bars';

    return {
      id,
      label: `${getEvaluationMethodShortLabel(config.method)} · ${models.map(model => model.name).join(' / ') || '未命名模型组'}`,
      method: config.method,
      methodLabel: getEvaluationMethodShortLabel(config.method),
      taskIds: groupTasks.map(task => task.id),
      taskCount: groupTasks.length,
      phase,
      leaderLabel,
      headline: top.headline,
      basis: top.basis,
      supporting: top.supporting,
      validRecordCount,
      evaluatedItemCount,
      totalItemCount: Math.max(totalItemCount, evaluatedItemCount),
      voterCount,
      visualization,
      segments: top.distribution?.segments || [],
    };
  }).sort((left, right) => right.validRecordCount - left.validRecordCount || right.taskCount - left.taskCount || left.label.localeCompare(right.label));
};
