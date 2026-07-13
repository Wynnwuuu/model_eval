import { EvalDimension, EvalParadigm, EvalTask, EvalTemplate, EvaluationConfig, EvaluationMethod, PairwiseMode, ScoreScaleLevel } from './types';

export const DEFAULT_SCORE_LEVELS: ScoreScaleLevel[] = [
  { value: 1, label: '1', description: '明显不可接受，核心目标未满足' },
  { value: 2, label: '2', description: '问题较多，仅部分满足目标' },
  { value: 3, label: '3', description: '基本可用，但存在明显改进空间' },
  { value: 4, label: '4', description: '质量较好，仅有轻微问题' },
  { value: 5, label: '5', description: '优秀，稳定满足评测标准' }
];

export const EVALUATION_METHOD_OPTIONS: Array<{
  method: EvaluationMethod;
  title: string;
  shortLabel: string;
  description: string;
  minModels: number;
}> = [
  {
    method: 'ab_preference',
    title: 'A/B 偏好',
    shortLabel: 'A/B',
    description: '两个模型产物盲测对比，评委选择更好的一侧或平局。',
    minModels: 2
  },
  {
    method: 'pairwise',
    title: 'Arena / Pairwise 对战',
    shortLabel: 'Pairwise',
    description: '多个模型按不完全两两对战评测；推荐 Arena 均衡采样，也可在高级设置使用全组合或相邻对战。',
    minModels: 2
  },
  {
    method: 'direct_score',
    title: '直接评分 / MOS',
    shortLabel: 'MOS',
    description: '对每个模型产物按 1-5 分或自定义尺度直接打分。',
    minModels: 1
  },
  {
    method: 'rubric_score',
    title: 'Rubric 多维评分',
    shortLabel: 'Rubric',
    description: '按多个清晰定义的维度分别评分，并按权重汇总。',
    minModels: 1
  },
  {
    method: 'rank_order',
    title: '全量排序 / Arena-rank',
    shortLabel: 'Arena-rank',
    description: '三个及以上候选产物拖拽排序，使用 Borda 与名次统计。',
    minModels: 3
  },
  {
    method: 'benchmark_preview',
    title: 'Benchmark 数据预览',
    shortLabel: 'Preview',
    description: '不做选择和打分，仅逐条查看输入/输出并记录评论。',
    minModels: 1
  }
];

export const getEvaluationMethodLabel = (method?: EvaluationMethod) =>
  EVALUATION_METHOD_OPTIONS.find(option => option.method === method)?.title || 'A/B 偏好';

export const getEvaluationMethodShortLabel = (method?: EvaluationMethod) =>
  EVALUATION_METHOD_OPTIONS.find(option => option.method === method)?.shortLabel || 'A/B';

export const getMethodMinModelCount = (method?: EvaluationMethod) =>
  EVALUATION_METHOD_OPTIONS.find(option => option.method === method)?.minModels || 2;

export const getMethodFromParadigm = (paradigm?: EvalParadigm): EvaluationMethod => {
  if (paradigm === 'Arena-rank') return 'rank_order';
  if (paradigm === 'MOS') return 'direct_score';
  if (paradigm === 'Pairwise') return 'pairwise';
  if (paradigm === 'RubricScore') return 'rubric_score';
  if (paradigm === 'BenchmarkPreview') return 'benchmark_preview';
  return 'ab_preference';
};

export const getParadigmFromMethod = (method?: EvaluationMethod): EvalParadigm => {
  if (method === 'rank_order') return 'Arena-rank';
  if (method === 'direct_score') return 'MOS';
  if (method === 'pairwise') return 'Pairwise';
  if (method === 'rubric_score') return 'RubricScore';
  if (method === 'benchmark_preview') return 'BenchmarkPreview';
  return 'Arena';
};

const dimensionId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const buildDefaultDimensionsForMethod = (method: EvaluationMethod): EvalDimension[] => {
  if (method === 'direct_score') {
    return [{
      id: dimensionId('dim-quality'),
      name: '整体质量',
      description: '综合判断产物是否满足 prompt、视觉/听觉质量和可用性要求。',
      type: 'star_rating',
      weight: 1,
      required: true,
      scope: 'primary',
      aggregationRole: 'score',
      scale: DEFAULT_SCORE_LEVELS
    }];
  }

  if (method === 'rubric_score') {
    return [
      {
        id: dimensionId('dim-alignment'),
        name: 'Prompt 一致性',
        description: '产物是否准确体现 prompt 中的主体、动作、风格、约束与关键细节。',
        type: 'star_rating',
        weight: 0.4,
        required: true,
        scope: 'primary',
        aggregationRole: 'score',
        scale: DEFAULT_SCORE_LEVELS
      },
      {
        id: dimensionId('dim-quality'),
        name: '产物质量',
        description: '产物的清晰度、稳定性、完整性、自然度和明显瑕疵控制。',
        type: 'star_rating',
        weight: 0.35,
        required: true,
        scope: 'primary',
        aggregationRole: 'score',
        scale: DEFAULT_SCORE_LEVELS
      },
      {
        id: dimensionId('dim-usability'),
        name: '可用性',
        description: '产物是否达到可用于展示、剪辑、交付或进一步生产的标准。',
        type: 'star_rating',
        weight: 0.25,
        required: true,
        scope: 'secondary',
        aggregationRole: 'score',
        scale: DEFAULT_SCORE_LEVELS
      }
    ];
  }

  return [];
};

export const getDefaultEvaluationConfig = (method: EvaluationMethod): EvaluationConfig => ({
  method,
  blind: method === 'ab_preference' || method === 'pairwise' || method === 'rank_order',
  tiePolicy: method === 'direct_score' || method === 'rubric_score' || method === 'rank_order' ? 'disallow' : 'allow',
  pairwiseMode: method === 'pairwise' ? 'arena_sampled' : undefined,
  arenaSampling: method === 'pairwise' ? {
    // Zero is the draft-only "auto" sentinel. Task creation resolves it from
    // the eligible case and model counts before persisting the configuration.
    suggestedBattlesPerReviewer: 0,
    warmupBattlesPerModel: 3,
    explorationRate: 0.15,
    schedulerVersion: 'arena_v1',
    seed: 'eval-studio-arena'
  } : undefined,
  requireReason: method === 'rubric_score',
  scale: method === 'direct_score' || method === 'rubric_score'
    ? { min: 1, max: 5, labels: DEFAULT_SCORE_LEVELS }
    : undefined,
  dimensions: buildDefaultDimensionsForMethod(method)
});

export const normalizeDimensions = (dimensions: EvalDimension[] = [], method?: EvaluationMethod) =>
  dimensions.map((dimension, index) => ({
    ...dimension,
    id: dimension.id || `dim-${index}`,
    weight: typeof dimension.weight === 'number' ? dimension.weight : 1,
    required: dimension.required ?? method !== 'ab_preference',
    scope: dimension.scope || (dimension.type === 'text_input' ? 'rationale' : index === 0 ? 'primary' : 'secondary'),
    aggregationRole: dimension.aggregationRole || (dimension.type === 'text_input' ? 'rationale' : dimension.type === 'star_rating' ? 'score' : 'preference'),
    scale: dimension.type === 'star_rating' ? (dimension.scale?.length ? dimension.scale : DEFAULT_SCORE_LEVELS) : dimension.scale
  }));

export const normalizeEvaluationConfig = (task?: EvalTask, template?: EvalTemplate): EvaluationConfig => {
  const method = task?.evaluationConfig?.method || getMethodFromParadigm(template?.paradigm);
  const defaults = getDefaultEvaluationConfig(method);
  const templateDimensions = template?.dimensions?.length ? template.dimensions : defaults.dimensions || [];
  const merged: EvaluationConfig = {
    ...defaults,
    ...(task?.evaluationConfig || {}),
    method,
    sourceRubricId: task?.evaluationConfig?.sourceRubricId || template?.id,
    rubricName: task?.evaluationConfig?.rubricName || template?.name
  };

  // Pairwise tasks created before arena_sampled existed were expanded as all-pairs.
  // Keep that interpretation when a persisted task has no explicit mode.
  if (method === 'pairwise' && task?.id && !task.evaluationConfig?.pairwiseMode) {
    merged.pairwiseMode = 'all_pairs';
  }

  merged.dimensions = normalizeDimensions(
    task?.evaluationConfig?.dimensions?.length ? task.evaluationConfig.dimensions : templateDimensions,
    method
  );

  if (method !== 'direct_score' && method !== 'rubric_score') {
    merged.scale = undefined;
  } else if (!merged.scale) {
    merged.scale = defaults.scale;
  }

  return merged;
};

export const isRankMethod = (configOrMethod?: EvaluationConfig | EvaluationMethod) =>
  (typeof configOrMethod === 'string' ? configOrMethod : configOrMethod?.method) === 'rank_order';

export const isScoreMethod = (configOrMethod?: EvaluationConfig | EvaluationMethod) => {
  const method = typeof configOrMethod === 'string' ? configOrMethod : configOrMethod?.method;
  return method === 'direct_score' || method === 'rubric_score';
};

export const isPairwiseMethod = (configOrMethod?: EvaluationConfig | EvaluationMethod) =>
  (typeof configOrMethod === 'string' ? configOrMethod : configOrMethod?.method) === 'pairwise';

export const isPreviewMethod = (configOrMethod?: EvaluationConfig | EvaluationMethod) =>
  (typeof configOrMethod === 'string' ? configOrMethod : configOrMethod?.method) === 'benchmark_preview';

export const isPreferenceMethod = (configOrMethod?: EvaluationConfig | EvaluationMethod) => {
  const method = typeof configOrMethod === 'string' ? configOrMethod : configOrMethod?.method;
  return method === 'ab_preference' || method === 'pairwise';
};

export const buildPairwisePairs = (
  models: { id: string; name: string }[],
  mode: PairwiseMode = 'all_pairs'
) => {
  const pairs: Array<{
    pairId: string;
    modelA: { id: string; name: string };
    modelB: { id: string; name: string };
  }> = [];

  if (mode === 'adjacent_pairs') {
    for (let index = 0; index < models.length - 1; index += 1) {
      const modelA = models[index];
      const modelB = models[index + 1];
      pairs.push({ pairId: `${modelA.id}__${modelB.id}`, modelA, modelB });
    }
    return pairs;
  }

  for (let left = 0; left < models.length; left += 1) {
    for (let right = left + 1; right < models.length; right += 1) {
      const modelA = models[left];
      const modelB = models[right];
      pairs.push({ pairId: `${modelA.id}__${modelB.id}`, modelA, modelB });
    }
  }

  return pairs;
};

export const scoreDimensionWeightTotal = (dimensions: EvalDimension[] = []) =>
  dimensions
    .filter(dimension => dimension.type === 'star_rating' && dimension.aggregationRole !== 'rationale')
    .reduce((sum, dimension) => sum + (typeof dimension.weight === 'number' ? dimension.weight : 1), 0);

export const getDimensionTypeLabel = (dimension: EvalDimension) => {
  if (dimension.type === 'star_rating') return '星级打分';
  if (dimension.type === 'radio_select') return '单选';
  return '理由文本';
};
