import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Cloud, Save, Star } from 'lucide-react';
import { EvalDimension, EvaluationConfig, EvaluationItem, VoteRecord } from '../types';
import { getModelOutputsForItem, resolveEvaluationItemPrompt } from '../rankingUtils';
import { getDimensionValuesForItem, hasDimensionValues } from '../dimensionUtils';
import { normalizeDimensions } from '../evaluationMethods';
import MediaRenderer from './MediaRenderer';
import DimensionChips from './DimensionChips';

interface ScoreEvaluationScreenProps {
  item: EvaluationItem;
  currentIndex: number;
  totalItems: number;
  models: { id: string; name: string }[];
  config: EvaluationConfig;
  onVote: (vote: Partial<VoteRecord>) => void;
  onEnd: () => void;
  onBack?: () => void;
  onGoBack?: () => void;
}

type ResponseDraft = {
  scores: Record<string, number>;
  answers: Record<string, string>;
  reason: string;
};

const isScoreDimension = (dimension: EvalDimension) =>
  dimension.type === 'star_rating' && dimension.aggregationRole !== 'rationale';

const ScoreButtons: React.FC<{
  dimension: EvalDimension;
  value?: number;
  onChange: (value: number) => void;
}> = ({ dimension, value, onChange }) => {
  const scale = dimension.scale?.length
    ? dimension.scale
    : [1, 2, 3, 4, 5].map(score => ({ value: score, label: String(score) }));

  return (
    <div className="flex flex-wrap gap-2">
      {scale.map(level => (
        <button
          key={level.value}
          type="button"
          onClick={() => onChange(level.value)}
          className={`flex min-w-10 items-center justify-center gap-1 border px-3 py-2 text-sm font-black transition-colors ${
            value === level.value
              ? 'border-[var(--accent)] bg-[var(--accent)] text-black'
              : 'border-white/10 bg-white/5 text-slate-200 hover:border-[var(--accent)]'
          }`}
          title={level.description || level.label}
        >
          <Star size={14} className={value === level.value ? 'fill-black' : ''} />
          {level.label}
        </button>
      ))}
    </div>
  );
};

const ScoreEvaluationScreen: React.FC<ScoreEvaluationScreenProps> = ({
  item,
  currentIndex,
  totalItems,
  models,
  config,
  onVote,
  onEnd,
  onBack,
  onGoBack
}) => {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, ResponseDraft>>({});
  const [justSaved, setJustSaved] = useState(false);

  const dimensions = useMemo(() => normalizeDimensions(config.dimensions || [], config.method), [config]);
  const scoreDimensions = dimensions.filter(isScoreDimension);
  const otherDimensions = dimensions.filter(dimension => !isScoreDimension(dimension));
  const outputs = useMemo(() => getModelOutputsForItem(item, models), [item, models]);
  const dimensionValues = getDimensionValuesForItem(item as any);
  const hasCaseDimensions = hasDimensionValues(dimensionValues);
  const prompt = resolveEvaluationItemPrompt(item);
  const progress = (currentIndex / totalItems) * 100;
  const isTextLikeOutput = item.type === 'text' || item.type === 'unknown';
  const allMediaLoaded = isTextLikeOutput || outputs.every(output => loaded[output.modelId]);

  useEffect(() => {
    setLoaded({});
    setShowFullPrompt(false);
    setJustSaved(true);
    const nextDraft = Object.fromEntries(outputs.map(output => [
      output.modelId,
      { scores: {}, answers: {}, reason: '' }
    ]));
    setDraft(nextDraft);
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [item.id, outputs]);

  const updateScore = (modelId: string, dimensionId: string, value: number) => {
    setDraft(prev => ({
      ...prev,
      [modelId]: {
        scores: { ...(prev[modelId]?.scores || {}), [dimensionId]: value },
        answers: prev[modelId]?.answers || {},
        reason: prev[modelId]?.reason || ''
      }
    }));
  };

  const updateAnswer = (modelId: string, dimensionId: string, value: string) => {
    setDraft(prev => ({
      ...prev,
      [modelId]: {
        scores: prev[modelId]?.scores || {},
        answers: { ...(prev[modelId]?.answers || {}), [dimensionId]: value },
        reason: prev[modelId]?.reason || ''
      }
    }));
  };

  const updateReason = (modelId: string, value: string) => {
    setDraft(prev => ({
      ...prev,
      [modelId]: {
        scores: prev[modelId]?.scores || {},
        answers: prev[modelId]?.answers || {},
        reason: value
      }
    }));
  };

  const isComplete = outputs.length > 0 && outputs.every(output => {
    const current = draft[output.modelId];
    if (!current) return false;
    const scoreReady = scoreDimensions
      .filter(dimension => dimension.required !== false)
      .every(dimension => Number.isFinite(current.scores[dimension.id]));
    const otherReady = otherDimensions
      .filter(dimension => dimension.required)
      .every(dimension => String(current.answers[dimension.id] || '').trim());
    const reasonReady = !config.requireReason || current.reason.trim().length > 0;
    return scoreReady && otherReady && reasonReady;
  });

  const submit = () => {
    if (!isComplete) return;
    onVote({
      method: config.method,
      rubricResponses: Object.fromEntries(outputs.map(output => {
        const current = draft[output.modelId] || { scores: {}, answers: {}, reason: '' };
        return [
          output.modelId,
          {
            modelId: output.modelId,
            modelName: output.modelName,
            scores: current.scores,
            answers: current.answers,
            reason: current.reason.trim()
          }
        ];
      })),
      reason: outputs
        .map(output => draft[output.modelId]?.reason?.trim())
        .filter(Boolean)
        .join(' | ')
    });
  };

  return (
    <div className="ark-operation-screen h-full flex flex-col">
      <div className="ark-operation-header h-14 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-black uppercase tracking-wide text-slate-100">
            {config.method === 'rubric_score' ? 'Rubric 多维评分' : '直接评分 / MOS'}
          </h2>
          <span className="border border-white/15 bg-white/10 px-2 py-1 font-mono text-xs text-slate-200">
            {currentIndex + 1} / {totalItems}
          </span>
          <div className={`flex items-center gap-1 text-xs font-medium transition-all duration-500 ${justSaved ? 'text-emerald-400 opacity-100' : 'text-slate-200 opacity-50'}`}>
            {justSaved ? <CheckCircle2 size={14} /> : <Cloud size={14} />}
            <span>{justSaved ? '已保存' : '自动保存开启'}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {onGoBack && (
            <button onClick={onGoBack} className="border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
              上一题
            </button>
          )}
          {onBack && (
            <button onClick={onBack} className="border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
              返回大盘
            </button>
          )}
          <button onClick={onEnd} className="border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
            提前结束
          </button>
        </div>
      </div>

      <div className="h-1 w-full shrink-0 bg-white/10">
        <div className="ark-progress h-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {(prompt || hasCaseDimensions) && (
        <div className="ark-prompt-strip relative z-10 shrink-0 px-6 py-3">
          <DimensionChips values={dimensionValues} className="mb-2" />
          <div className={`text-sm leading-relaxed transition-all duration-300 whitespace-pre-wrap ${showFullPrompt ? '' : 'line-clamp-2 pr-8'}`}>
            <span className="mr-2 select-none bg-black px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-white">输入</span>
            {prompt}
          </div>
          {prompt.length > 150 && (
            <button
              onClick={() => setShowFullPrompt(!showFullPrompt)}
              className="absolute right-4 top-3 border border-black/20 bg-white/55 p-1 text-black shadow-md transition-colors hover:bg-[var(--accent)]"
              aria-label={showFullPrompt ? '收起输入信息' : '展开输入信息'}
            >
              {showFullPrompt ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-black/25 p-4 md:p-6">
        <div className="grid min-h-[620px] grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
          {outputs.map((output, index) => {
            const current = draft[output.modelId] || { scores: {}, answers: {}, reason: '' };
            return (
              <section key={output.modelId} className="ark-rank-card flex min-h-[560px] min-w-0 flex-col overflow-hidden">
                <div className="ark-rank-head flex items-center justify-between px-3 py-2">
                  <div className="text-sm font-black">
                    候选 {index + 1}
                    <span className="ml-2 font-mono text-xs opacity-65">{config.blind ? '盲测中' : output.modelName}</span>
                  </div>
                </div>
                <div className="min-h-[260px] overflow-hidden bg-black/55 p-1">
                  {isTextLikeOutput ? (
                    <div className="h-full min-h-[260px] overflow-auto bg-white/5 p-4 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
                      {output.url || '无文本输出'}
                    </div>
                  ) : (
                    <MediaRenderer
                      url={output.url}
                      label={`候选 ${index + 1}`}
                      isActive={true}
                      forceType={item.type}
                      onLoadStatusChange={(isLoaded) => setLoaded(prev => ({ ...prev, [output.modelId]: isLoaded }))}
                    />
                  )}
                </div>
                <div className="flex-1 space-y-4 overflow-auto p-4">
                  {scoreDimensions.map(dimension => (
                    <div key={dimension.id} className="border border-white/10 bg-white/5 p-3">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-slate-100">{dimension.name}</div>
                          {dimension.description && <div className="mt-1 text-xs text-slate-400">{dimension.description}</div>}
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-amber-300">w {dimension.weight ?? 1}</span>
                      </div>
                      <ScoreButtons
                        dimension={dimension}
                        value={current.scores[dimension.id]}
                        onChange={(value) => updateScore(output.modelId, dimension.id, value)}
                      />
                    </div>
                  ))}

                  {otherDimensions.map(dimension => (
                    <div key={dimension.id} className="border border-white/10 bg-white/5 p-3">
                      <label className="mb-2 block text-sm font-bold text-slate-100">
                        {dimension.name}
                        {dimension.required && <span className="ml-1 text-amber-300">*</span>}
                      </label>
                      {dimension.description && <div className="mb-2 text-xs text-slate-400">{dimension.description}</div>}
                      {dimension.type === 'radio_select' ? (
                        <div className="flex flex-wrap gap-2">
                          {(dimension.options || []).map(option => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => updateAnswer(output.modelId, dimension.id, option)}
                              className={`border px-3 py-2 text-sm font-semibold ${
                                current.answers[dimension.id] === option
                                  ? 'border-[var(--accent)] bg-[var(--accent)] text-black'
                                  : 'border-white/10 bg-white/5 text-slate-200 hover:border-[var(--accent)]'
                              }`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <textarea
                          value={current.answers[dimension.id] || ''}
                          onChange={(event) => updateAnswer(output.modelId, dimension.id, event.target.value)}
                          className="glass-input min-h-20 w-full px-3 py-2 text-sm"
                          placeholder="记录观察依据、失败模式或改进建议"
                        />
                      )}
                    </div>
                  ))}

                  <div className="border border-white/10 bg-white/5 p-3">
                    <label className="mb-2 block text-sm font-bold text-slate-100">
                      评审理由 {config.requireReason && <span className="text-amber-300">*</span>}
                    </label>
                    <textarea
                      value={current.reason}
                      onChange={(event) => updateReason(output.modelId, event.target.value)}
                      className="glass-input min-h-20 w-full px-3 py-2 text-sm"
                      placeholder="可选：写下支持该评分的具体证据"
                    />
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <div className="ark-operation-header flex shrink-0 items-center justify-between px-6 py-3">
        <div className="text-xs text-slate-300">
          {isComplete ? '评分已完成，可提交当前 case。' : '请完成必填评分项。'}
        </div>
        <button
          onClick={submit}
          disabled={!isComplete || !allMediaLoaded}
          className={`flex items-center gap-2 px-5 py-2.5 font-black ${
            isComplete && allMediaLoaded ? 'btn-primary' : 'cursor-not-allowed border border-white/10 bg-white/10 text-slate-400'
          }`}
        >
          {isComplete && allMediaLoaded ? <Save size={18} /> : <ArrowLeft size={18} />}
          {allMediaLoaded ? '提交评分' : '媒体加载中...'}
        </button>
      </div>
    </div>
  );
};

export default ScoreEvaluationScreen;
