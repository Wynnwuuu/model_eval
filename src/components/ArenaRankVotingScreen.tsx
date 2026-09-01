import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Cloud, Equal, GripVertical, Layers3, RotateCcw, SkipForward, Trophy, Unlink, X } from 'lucide-react';
import { EvaluationItem, RankingEntry } from '../types';
import { getModelOutputsForItem, tiersToRankingEntries } from '../rankingUtils';
import MediaRenderer from './MediaRenderer';
import { resolveMediaPlaybackCandidates } from '../mediaProxy';
import { VIDEO_EXTENSIONS } from '../constants';
import DimensionChips from './DimensionChips';
import { getDimensionValuesForItem, hasDimensionValues } from '../dimensionUtils';
import { getEvaluationReferenceInputKeys } from '../evaluationReferenceMedia';
import EvaluationReferenceMediaStrip from './EvaluationReferenceMediaStrip';
import EvaluationMediaViewer, {
  EvaluationMediaExpandButton,
  type EvaluationMediaViewerItem,
} from './EvaluationMediaViewer';
import ModelFeedbackEditor from './ModelFeedbackEditor';
import RevealAfterSubmitToggle from './RevealAfterSubmitToggle';
import type { ModelFeedbackDraft } from '../modelFeedback';
import { inferPreviewMediaType } from '../mediaTypeUtils';

interface ArenaRankVotingScreenProps {
  item: EvaluationItem;
  nextItem?: EvaluationItem;
  currentIndex: number;
  totalItems: number;
  models?: { id: string; name: string }[];
  blind?: boolean;
  isRevealed?: boolean;
  isLastItem?: boolean;
  revealAfterSubmit: boolean;
  onRevealAfterSubmitChange: (checked: boolean) => void;
  onVote: (ranking: RankingEntry[], feedback: ModelFeedbackDraft) => void;
  onNext?: (feedback: ModelFeedbackDraft) => void;
  onRevote?: () => void;
  onEnd: () => void;
  onBack?: () => void;
  onGoBack?: () => void;
  onSkip?: () => void;
}

const RANK_MEDIA_WAIT_FALLBACK_MS = 10000;

const ArenaRankVotingScreen: React.FC<ArenaRankVotingScreenProps> = ({
  item,
  nextItem,
  currentIndex,
  totalItems,
  models = [],
  blind = true,
  isRevealed = false,
  isLastItem = false,
  revealAfterSubmit,
  onRevealAfterSubmitChange,
  onVote,
  onNext,
  onRevote,
  onEnd,
  onBack,
  onGoBack,
  onSkip
}) => {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [mediaWaitTimedOut, setMediaWaitTimedOut] = useState(false);
  const [draggedTierIndex, setDraggedTierIndex] = useState<number | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [showRankDrawer, setShowRankDrawer] = useState(false);
  const [rankAnnouncement, setRankAnnouncement] = useState('');
  const [feedbackDraft, setFeedbackDraft] = useState<ModelFeedbackDraft>({});
  const [outputViewerIndex, setOutputViewerIndex] = useState<number | null>(null);
  const draggedTierIndexRef = useRef<number | null>(null);

  const sourceOutputs = useMemo(() => getModelOutputsForItem(item, models), [item, models]);
  const mediaCycleKey = useMemo(
    () => [currentIndex, item.id, item.type, ...sourceOutputs.map(output => `${output.modelId}:${output.url}`)].join('|'),
    [currentIndex, item.id, item.type, sourceOutputs]
  );
  const mediaCycleKeyRef = useRef(mediaCycleKey);
  mediaCycleKeyRef.current = mediaCycleKey;
  const [optionOrder, setOptionOrder] = useState<string[]>([]);
  const [rankTiers, setRankTiers] = useState<string[][]>([]);

  useEffect(() => {
    const shuffled = [...sourceOutputs]
      .map((output, index) => ({ output, sortKey: Math.random() + index * 0.0001 }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(entry => entry.output.modelId);

    setOptionOrder(shuffled);
    setRankTiers(shuffled.map(modelId => [modelId]));
    setLoaded({});
    setMediaWaitTimedOut(false);
    setFeedbackDraft({});
    draggedTierIndexRef.current = null;
    setDraggedTierIndex(null);
    setShowFullPrompt(false);
    setShowRankDrawer(false);
    setRankAnnouncement('');
    setOutputViewerIndex(null);
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [mediaCycleKey, sourceOutputs]);

  const outputsById = new Map(sourceOutputs.map(output => [output.modelId, output]));
  const optionLabels = new Map(optionOrder.map((modelId, index) => [
    modelId,
    index < 26 ? `Option ${String.fromCharCode(65 + index)}` : `Option ${index + 1}`,
  ]));
  const displayOutputs = rankTiers
    .flatMap(tier => tier.map(modelId => outputsById.get(modelId)).filter(Boolean)) as typeof sourceOutputs;
  const outputViewerItems = displayOutputs.flatMap(output => {
    const label = optionLabels.get(output.modelId) || output.modelId;
    const type = item.type === 'image' || item.type === 'video'
      ? item.type
      : inferPreviewMediaType(output.url, item.type, label);
    return type === 'image' || type === 'video'
      ? [{ id: output.modelId, url: output.url, type, label } satisfies EvaluationMediaViewerItem]
      : [];
  });
  const outputViewerOpen = outputViewerIndex !== null;
  const rankMetaById = new Map<string, { rank: number; tied: boolean }>();
  const tierIndexByModelId = new Map<string, number>();
  let rankedPosition = 0;
  rankTiers.forEach((tier, tierIndex) => {
    const rank = rankedPosition + 1;
    tier.forEach(modelId => {
      rankMetaById.set(modelId, { rank, tied: tier.length > 1 });
      tierIndexByModelId.set(modelId, tierIndex);
    });
    rankedPosition += tier.length;
  });
  const dimensionValues = getDimensionValuesForItem(item as any);
  const hasDimensions = hasDimensionValues(dimensionValues);

  const hiddenInputKeys = getEvaluationReferenceInputKeys(item);

  const progress = (currentIndex / totalItems) * 100;
  const allMediaLoaded = displayOutputs.length >= 3 && displayOutputs.every(output => loaded[output.modelId]);
  const canSubmit = allMediaLoaded || mediaWaitTimedOut;
  const visibleInputs = item.inputs
    ? Object.entries(item.inputs).filter(([key]) => !hiddenInputKeys.has(key))
    : [];

  useEffect(() => {
    if (!nextItem) return;
    const preloadElements: Array<HTMLImageElement | HTMLVideoElement> = [];
    const nextUrls = getModelOutputsForItem(nextItem, models)
      .map(output => output.url)
      .filter(Boolean);

    nextUrls.slice(0, allMediaLoaded ? Math.min(3, nextUrls.length) : 1).forEach(url => {
      const normalizedUrl = resolveMediaPlaybackCandidates(url)[0]?.url || '';
      if (!normalizedUrl) return;

      const cleanUrl = normalizedUrl.split('?')[0].split('#')[0].toLowerCase();
      const isVideo = VIDEO_EXTENSIONS.some(ext => cleanUrl.endsWith(`.${ext}`)) || normalizedUrl.toLowerCase().includes('video');
      if (isVideo) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('referrerpolicy', 'no-referrer');
        video.src = normalizedUrl;
        preloadElements.push(video);
      } else {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.src = normalizedUrl;
        preloadElements.push(img);
      }
    });

    return () => {
      preloadElements.forEach(element => {
        if (element instanceof HTMLVideoElement) {
          element.removeAttribute('src');
          element.load();
        } else {
          element.src = '';
        }
      });
    };
  }, [nextItem, models, allMediaLoaded]);

  useEffect(() => {
    if (displayOutputs.length < 3 || allMediaLoaded) {
      setMediaWaitTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setMediaWaitTimedOut(true);
    }, RANK_MEDIA_WAIT_FALLBACK_MS);

    return () => window.clearTimeout(timer);
  }, [mediaCycleKey, displayOutputs.length, allMediaLoaded]);

  const getTierLabel = (tier: string[]) => tier.map(modelId => optionLabels.get(modelId) || modelId).join(' = ');

  const moveTier = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rankTiers.length) return;
    const movedLabel = getTierLabel(rankTiers[index]);
    setRankTiers(previous => {
      const next = previous.map(tier => [...tier]);
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setRankAnnouncement(`${movedLabel} 已${direction < 0 ? '上移' : '下移'}一个梯队`);
  };

  const mergeTierWithPrevious = (index: number) => {
    if (index <= 0 || index >= rankTiers.length) return;
    const mergedLabel = `${getTierLabel(rankTiers[index - 1])} 与 ${getTierLabel(rankTiers[index])}`;
    setRankTiers(previous => {
      const next = previous.map(tier => [...tier]);
      next.splice(index - 1, 2, [...next[index - 1], ...next[index]]);
      return next;
    });
    setRankAnnouncement(`${mergedLabel} 已设为并列`);
  };

  const splitModelFromTier = (tierIndex: number, modelId: string) => {
    const tier = rankTiers[tierIndex];
    if (!tier || tier.length <= 1) return;
    setRankTiers(previous => {
      const next = previous.map(candidate => [...candidate]);
      next[tierIndex] = next[tierIndex].filter(id => id !== modelId);
      next.splice(tierIndex + 1, 0, [modelId]);
      return next;
    });
    setRankAnnouncement(`${optionLabels.get(modelId) || modelId} 已从并列组拆分`);
  };

  const handleTierDragStart = (event: React.DragEvent, tierIndex: number) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(tierIndex));
    draggedTierIndexRef.current = tierIndex;
    setDraggedTierIndex(tierIndex);
  };

  const clearTierDrag = () => {
    draggedTierIndexRef.current = null;
    setDraggedTierIndex(null);
  };

  const handleTierDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const getDraggedTierIndex = (event?: React.DragEvent) => {
    const rawIndex = event?.dataTransfer.getData('text/plain');
    const parsedIndex = rawIndex === undefined || rawIndex === '' ? NaN : Number(rawIndex);
    return Number.isInteger(parsedIndex) ? parsedIndex : (draggedTierIndexRef.current ?? draggedTierIndex);
  };

  const handleTierDrop = (targetIndex: number, event?: React.DragEvent) => {
    const sourceIndex = getDraggedTierIndex(event);
    if (sourceIndex === null || sourceIndex < 0 || sourceIndex >= rankTiers.length || sourceIndex === targetIndex) return;
    const movedLabel = getTierLabel(rankTiers[sourceIndex]);
    setRankTiers(previous => {
      const next = previous.map(tier => [...tier]);
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    clearTierDrag();
    setRankAnnouncement(`${movedLabel} 已移动到第 ${targetIndex + 1} 个梯队`);
  };

  const handleLoadStatusChange = useCallback((modelId: string, isLoaded: boolean) => {
    if (mediaCycleKeyRef.current !== mediaCycleKey) return;
    setLoaded(prev => {
      if (prev[modelId] === isLoaded) return prev;
      return { ...prev, [modelId]: isLoaded };
    });
  }, [mediaCycleKey]);

  const submitRanking = () => {
    const ranking = tiersToRankingEntries(rankTiers.map(tier => tier
      .map(modelId => outputsById.get(modelId))
      .filter(Boolean)
      .map(output => ({ modelId: output!.modelId, modelName: output!.modelName }))));
    onVote(ranking, feedbackDraft);
  };

  const getTierRank = (tierIndex: number) =>
    rankTiers.slice(0, tierIndex).reduce((sum, tier) => sum + tier.length, 0) + 1;

  const renderRankEditor = (mobile = false) => (
    <div className={mobile ? 'flex min-h-0 flex-1 flex-col' : ''}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-100">
            <Layers3 size={16} className="text-[var(--accent)]" /> 排名梯队
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">拖动梯队调整顺序；合并相邻梯队即可设为并列。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {!isRevealed && <button
              type="button"
              onClick={() => {
                setRankTiers([rankTiers.flat()]);
                setRankAnnouncement('所有选项已设为并列');
              }}
              disabled={rankTiers.length <= 1}
              className="inline-flex items-center gap-1 border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Equal size={12} /> 全部并列
            </button>}
            {!isRevealed && <button
              type="button"
              onClick={() => {
                setRankTiers(rankTiers.flat().map(modelId => [modelId]));
                setRankAnnouncement('已恢复为独立排名梯队');
              }}
              disabled={rankTiers.every(tier => tier.length === 1)}
              className="inline-flex items-center gap-1 border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Unlink size={12} /> 拆为独立梯队
            </button>}
          </div>
        </div>
        {mobile && (
          <button onClick={() => setShowRankDrawer(false)} className="p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="关闭排名梯队">
            <X size={18} />
          </button>
        )}
      </div>

      <div className={`${mobile ? 'min-h-0 flex-1 overflow-y-auto pr-1' : ''} space-y-2`}>
        {rankTiers.map((tier, tierIndex) => {
          const rank = getTierRank(tierIndex);
          return (
            <React.Fragment key={tier.slice().sort().join('|')}>
              {tierIndex > 0 && !isRevealed && (
                <button
                  type="button"
                  onClick={() => mergeTierWithPrevious(tierIndex)}
                  className="group flex w-full items-center gap-2 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-[var(--accent)]"
                  aria-label={`将第 ${rank} 名与上一梯队合并为并列`}
                >
                  <span className="h-px flex-1 bg-white/10 group-hover:bg-[var(--accent)]/50" />
                  <span className="inline-flex items-center gap-1 border border-white/10 bg-black/25 px-2 py-1 group-hover:border-[var(--accent)]/60">
                    <Equal size={12} /> 合并为并列
                  </span>
                  <span className="h-px flex-1 bg-white/10 group-hover:bg-[var(--accent)]/50" />
                </button>
              )}
              <div
                draggable={!isRevealed}
                onDragStart={event => handleTierDragStart(event, tierIndex)}
                onDragOver={handleTierDragOver}
                onDrop={event => handleTierDrop(tierIndex, event)}
                onDragEnd={clearTierDrag}
                className={`border px-3 py-2.5 transition-colors ${
                  draggedTierIndex === tierIndex
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 opacity-70'
                    : tier.length > 1
                      ? 'border-[var(--accent)]/45 bg-[var(--accent)]/8'
                      : 'border-white/10 bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <GripVertical size={15} className="shrink-0 cursor-grab text-slate-500" />
                    <span className="flex h-7 min-w-7 shrink-0 items-center justify-center bg-[var(--accent)]/20 px-1.5 font-mono text-xs font-bold text-[var(--accent)]">
                      {rank}
                    </span>
                    <span className="truncate text-xs font-semibold text-slate-200">
                      {tier.length > 1 ? `并列第 ${rank} 名` : `第 ${rank} 名`}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => moveTier(tierIndex, -1)} disabled={isRevealed || tierIndex === 0} className="p-1.5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25" title="梯队上移" aria-label={`将第 ${rank} 名梯队上移`}>
                      <ArrowUp size={14} />
                    </button>
                    <button onClick={() => moveTier(tierIndex, 1)} disabled={isRevealed || tierIndex === rankTiers.length - 1} className="p-1.5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25" title="梯队下移" aria-label={`将第 ${rank} 名梯队下移`}>
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tier.map(modelId => (
                    <span key={modelId} className="inline-flex items-center gap-1.5 border border-white/10 bg-black/25 px-2 py-1 text-xs text-slate-200">
                      {optionLabels.get(modelId) || modelId}
                      {tier.length > 1 && (
                        <button
                          type="button"
                          onClick={() => splitModelFromTier(tierIndex, modelId)}
                          disabled={isRevealed}
                          className="text-slate-500 hover:text-[var(--accent)]"
                          title="从并列组拆分为下一名"
                          aria-label={`将 ${optionLabels.get(modelId) || modelId} 从并列组拆分为下一名`}
                        >
                          <Unlink size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <button
        onClick={() => {
          if (mobile) setShowRankDrawer(false);
          if (isRevealed) onNext?.(feedbackDraft);
          else submitRanking();
        }}
        disabled={!isRevealed && !canSubmit}
        className={`mt-4 flex w-full shrink-0 items-center justify-center gap-2 py-3 font-black transition-colors ${
          (isRevealed || canSubmit) ? 'btn-primary' : 'cursor-not-allowed border border-white/10 bg-white/10 text-slate-400'
        }`}
      >
        <Trophy size={18} />
        {isRevealed ? (isLastItem ? '查看结果' : '下一题') : canSubmit ? '提交排名' : '媒体加载中...'}
      </button>
      {mediaWaitTimedOut && !allMediaLoaded && (
        <div className="mt-3 border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
          媒体仍在加载。请优先等待画面出现；如长时间无响应，可打开原链接核对或跳过本题。
        </div>
      )}
    </div>
  );

  return (
    <div className="ark-operation-screen h-full flex flex-col">
      <div className="ark-operation-header h-14 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-black uppercase tracking-wide text-slate-100">Arena-rank</h2>
          <span className="border border-white/15 bg-white/10 px-2 py-1 font-mono text-xs text-slate-200">
            {currentIndex + 1} / {totalItems}
          </span>
          <div className={`flex items-center gap-1 text-xs font-medium transition-all duration-500 ${justSaved ? 'text-emerald-400 opacity-100' : 'text-slate-200 opacity-50'}`}>
            {justSaved ? <CheckCircle2 size={14} /> : <Cloud size={14} />}
            <span>{justSaved ? '已保存' : '自动保存开启'}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 text-xs text-slate-300 lg:flex">
            <GripVertical size={14} />
            <span>拖拽图片调整排名；可将相邻名次合并为并列</span>
          </div>
          {onGoBack && !isRevealed && (
            <button onClick={onGoBack} className="border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
              上一题
            </button>
          )}
          {onSkip && !isRevealed && (
            <button onClick={onSkip} className="border-l border-white/10 pl-4 text-sm font-medium text-amber-200 transition-colors hover:text-amber-100">
              <span className="inline-flex items-center gap-1.5"><SkipForward size={15} /> 跳过本题</span>
            </button>
          )}
          {onBack && (
            <button onClick={onBack} className="border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
              返回大盘
            </button>
          )}
          {!isRevealed && (
            <button onClick={onEnd} className="border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
              提前结束
            </button>
          )}
          {isRevealed && onRevote && (
            <button onClick={onRevote} className="inline-flex items-center gap-1.5 border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
              <RotateCcw size={14} /> 重新评本题
            </button>
          )}
        </div>
      </div>

      <div className="h-1 w-full shrink-0 bg-white/10">
        <div className="ark-progress h-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <RevealAfterSubmitToggle checked={revealAfterSubmit} onChange={onRevealAfterSubmitChange} />

      {isRevealed && (
        <div className="border-b border-emerald-400/20 bg-emerald-400/10 px-6 py-2 text-sm text-emerald-200">
          <span className="font-semibold">本 case 已保存，模型身份已揭示</span>
          <span className="ml-2 text-xs text-slate-400">可继续修改备注。</span>
        </div>
      )}

      {(item.inputs || item.prompt || hasDimensions) && (
        <div className="ark-prompt-strip relative z-10 shrink-0 px-6 py-3">
          <DimensionChips values={dimensionValues} className="mb-2" />
          <div className={`text-sm leading-relaxed transition-all duration-300 whitespace-pre-wrap ${showFullPrompt ? '' : 'line-clamp-2 pr-8'}`}>
            {visibleInputs.length > 0 ? (
              <div className="flex flex-col gap-2">
                {visibleInputs.map(([key, value]) => (
                  <div key={key} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                    <span className="shrink-0 self-start bg-black px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-white">{key}</span>
                    <span className="break-words">{String(value)}</span>
                  </div>
                ))}
              </div>
            ) : (
              item.prompt
            )}
          </div>
          {((item.prompt && item.prompt.length > 150) || visibleInputs.length > 1) && (
            <button
              onClick={() => setShowFullPrompt(!showFullPrompt)}
              className="absolute right-4 top-3 border border-black/20 bg-white/55 p-1 text-black shadow-md transition-colors hover:bg-[var(--accent)]"
              aria-label={showFullPrompt ? '收起输入信息' : '展开输入信息'}
            >
              {showFullPrompt ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto bg-black/25 p-4 pb-24 md:p-6 md:pb-24 xl:pb-6">
        <EvaluationReferenceMediaStrip item={item} className="mb-4 border border-white/10" />
        {displayOutputs.length < 3 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-300">
            <Trophy size={40} className="mb-4 text-[var(--accent)]" />
            <h3 className="mb-2 text-lg font-semibold text-slate-100">Arena-rank 至少需要 3 个候选产物</h3>
            <p className="max-w-md text-sm">请在创建任务时选择 3 列或更多模型结果列；2 个候选请继续使用普通 Arena。</p>
          </div>
        ) : (
          <div className="grid min-h-[640px] grid-cols-1 gap-6 xl:min-h-full xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] content-start gap-4">
              {displayOutputs.map(output => {
                const optionLabel = optionLabels.get(output.modelId) || output.modelId;
                const rankMeta = rankMetaById.get(output.modelId);
                const tierIndex = tierIndexByModelId.get(output.modelId) ?? 0;
                const tier = rankTiers[tierIndex] || [];
                return (
                  <div
                    key={`${mediaCycleKey}-${output.modelId}-${output.url}`}
                    draggable={!isRevealed}
                    onDragStart={event => handleTierDragStart(event, tierIndex)}
                    onDragOver={handleTierDragOver}
                    onDrop={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleTierDrop(tierIndex, event);
                    }}
                    onDragEnd={clearTierDrag}
                    className={`ark-rank-card flex min-h-[360px] min-w-0 flex-col overflow-hidden transition-colors ${
                      draggedTierIndex === tierIndex
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 opacity-70'
                        : rankMeta?.tied
                          ? 'border-[var(--accent)]/50 hover:border-[var(--accent)]'
                          : 'hover:border-[var(--accent)]'
                    }`}
                    title="拖拽此卡片可移动当前排名梯队"
                  >
                    <div className="ark-rank-head flex items-center justify-between gap-2 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2 text-sm font-black">
                        <GripVertical size={15} className="shrink-0 text-black/55" />
                        <span className="truncate">{rankMeta?.tied ? `并列第 ${rankMeta.rank} 名` : `第 ${rankMeta?.rank || '-'} 名`}</span>
                        <span className="shrink-0 font-mono text-xs opacity-65">{optionLabel}</span>
                        {(!blind || isRevealed) && <span className="truncate font-mono text-xs opacity-75">{output.modelName}</span>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveTier(tierIndex, -1)}
                          disabled={isRevealed || tierIndex === 0}
                          className="p-1 text-black/65 hover:bg-black hover:text-white disabled:opacity-25"
                          title="上移"
                          aria-label={`将 ${optionLabel} 所在梯队上移`}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTier(tierIndex, 1)}
                          disabled={isRevealed || tierIndex === rankTiers.length - 1}
                          className="p-1 text-black/65 hover:bg-black hover:text-white disabled:opacity-25"
                          title="下移"
                          aria-label={`将 ${optionLabel} 所在梯队下移`}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => mergeTierWithPrevious(tierIndex)}
                          disabled={isRevealed || tierIndex === 0}
                          className="p-1 text-black/65 hover:bg-black hover:text-white disabled:opacity-25"
                          title="与上一名并列"
                          aria-label={`将 ${optionLabel} 与上一名合并为并列`}
                        >
                          <Equal size={13} />
                        </button>
                        {tier.length > 1 && (
                          <button
                            type="button"
                            onClick={() => splitModelFromTier(tierIndex, output.modelId)}
                            disabled={isRevealed}
                            className="p-1 text-black/65 hover:bg-black hover:text-white"
                            title="从并列组拆分为下一名"
                            aria-label={`将 ${optionLabel} 从并列组拆分为下一名`}
                          >
                            <Unlink size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    {rankMeta?.tied && (
                      <div className="border-b border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-1 font-mono text-[11px] text-amber-100">
                        {tier.map(modelId => optionLabels.get(modelId) || modelId).join(' = ')}
                      </div>
                    )}
                    <div className="relative min-h-[280px] flex-1 overflow-hidden bg-black/55 p-1">
                      <MediaRenderer
                        key={`${mediaCycleKey}-${output.modelId}-${output.url}-media`}
                        url={output.url}
                        label={optionLabel}
                        isActive={false}
                        forceType={item.type}
                        onLoadStatusChange={(isLoaded) => handleLoadStatusChange(output.modelId, isLoaded)}
                        suspendPlayback={outputViewerOpen}
                      />
                      {outputViewerItems.some(candidate => candidate.id === output.modelId) && (
                        <EvaluationMediaExpandButton
                          label={optionLabel}
                          onClick={() => setOutputViewerIndex(outputViewerItems.findIndex(candidate => candidate.id === output.modelId))}
                        />
                      )}
                    </div>
                    <ModelFeedbackEditor
                      modelId={output.modelId}
                      optionLabel={optionLabel}
                      value={feedbackDraft[output.modelId] || ''}
                      onChange={value => setFeedbackDraft(previous => ({ ...previous, [output.modelId]: value }))}
                    />
                  </div>
                );
              })}
            </div>

            <aside className="ark-panel h-fit p-4 xl:sticky xl:top-4">
              <div className="hidden xl:block">
                {renderRankEditor()}
              </div>
            </aside>
          </div>
        )}
      </div>

      {displayOutputs.length >= 3 && (
        <button
          type="button"
          onClick={() => isRevealed ? onNext?.(feedbackDraft) : setShowRankDrawer(true)}
          className="btn-primary fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 px-5 py-3 shadow-2xl xl:hidden"
          aria-expanded={showRankDrawer}
          aria-controls="arena-rank-tier-drawer"
        >
          {isRevealed ? <Trophy size={17} /> : <Layers3 size={17} />}
          {isRevealed ? (isLastItem ? '查看结果' : '下一题') : '调整排名梯队'}
        </button>
      )}

      <div className="sr-only" aria-live="polite">{rankAnnouncement}</div>

      <EvaluationMediaViewer
        items={outputViewerItems}
        activeIndex={outputViewerIndex}
        onIndexChange={setOutputViewerIndex}
        onClose={() => setOutputViewerIndex(null)}
      />

      {showRankDrawer && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/75 xl:hidden" onClick={() => setShowRankDrawer(false)}>
          <div
            id="arena-rank-tier-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="排名梯队编辑器"
            className="ark-panel flex max-h-[86vh] w-full flex-col border-x-0 border-b-0 p-4 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            {renderRankEditor(true)}
          </div>
        </div>
      )}

    </div>
  );
};

export default ArenaRankVotingScreen;
