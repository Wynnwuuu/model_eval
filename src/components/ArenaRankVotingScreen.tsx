import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Cloud, Equal, Expand, FileAudio, GripVertical, Layers3, SkipForward, Trophy, Unlink, X } from 'lucide-react';
import { EvaluationItem, RankingEntry } from '../types';
import { getModelOutputsForItem, tiersToRankingEntries } from '../rankingUtils';
import MediaRenderer from './MediaRenderer';
import { resolveMediaPlaybackCandidates } from '../mediaProxy';
import { VIDEO_EXTENSIONS } from '../constants';
import DimensionChips from './DimensionChips';
import { getDimensionValuesForItem, hasDimensionValues } from '../dimensionUtils';
import { extractMediaUrls } from '../mediaUrlUtils';
import { getReferenceThumbnailUrl, inferReferenceMediaType, sortReferenceUrls } from '../mediaTypeUtils';

const isStartImageKey = (key: string) => /start|first|首帧|首图|起始/i.test(key);
const isReferenceKey = (key: string) => /ref|reference|参考|參考|music|audio|bgm|配乐|音乐|音频|image_json/i.test(key);

interface ArenaRankVotingScreenProps {
  item: EvaluationItem;
  nextItem?: EvaluationItem;
  currentIndex: number;
  totalItems: number;
  models?: { id: string; name: string }[];
  onVote: (ranking: RankingEntry[]) => void;
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
  onVote,
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
  const [showReference, setShowReference] = useState(false);
  const [currentRefIndex, setCurrentRefIndex] = useState(0);
  const [showRankDrawer, setShowRankDrawer] = useState(false);
  const [rankAnnouncement, setRankAnnouncement] = useState('');
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
    draggedTierIndexRef.current = null;
    setDraggedTierIndex(null);
    setShowFullPrompt(false);
    setShowReference(false);
    setShowRankDrawer(false);
    setRankAnnouncement('');
    setCurrentRefIndex(0);
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

  const effectiveStartImageUrl = item.startImageUrl || (() => {
    if (!item.inputs) return undefined;
    for (const [key, val] of Object.entries(item.inputs)) {
      if (isStartImageKey(key)) {
        const [url] = extractMediaUrls(val);
        if (url) return url;
      }
    }
    return undefined;
  })();

  const effectiveReferenceUrls = (() => {
    const refs = item.referenceUrls || (() => {
      if (!item.inputs) return [] as string[];
      const collected: string[] = [];
      for (const [key, val] of Object.entries(item.inputs)) {
        if (isReferenceKey(key)) {
          collected.push(...extractMediaUrls(val));
        }
      }
      return collected;
    })();
    return refs.length > 0 ? sortReferenceUrls(refs) : undefined;
  })();

  const referenceThumbnailUrl = effectiveReferenceUrls
    ? getReferenceThumbnailUrl(effectiveReferenceUrls)
    : undefined;
  const hasReferences = Boolean(effectiveReferenceUrls && effectiveReferenceUrls.length > 0);

  const hiddenInputKeys = new Set<string>();
  if (item.inputs) {
    for (const [key, val] of Object.entries(item.inputs)) {
      if (extractMediaUrls(val).length > 0 && (isStartImageKey(key) || isReferenceKey(key))) {
        hiddenInputKeys.add(key);
      }
    }
  }

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

  useEffect(() => {
    if (!showReference) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowReference(false);
        return;
      }
      if (effectiveReferenceUrls && effectiveReferenceUrls.length > 1 && currentRefIndex !== -1) {
        if (event.key === 'ArrowLeft') {
          setCurrentRefIndex(prev => (prev === 0 ? effectiveReferenceUrls.length - 1 : prev - 1));
        } else if (event.key === 'ArrowRight') {
          setCurrentRefIndex(prev => (prev === effectiveReferenceUrls.length - 1 ? 0 : prev + 1));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showReference, effectiveReferenceUrls, currentRefIndex]);

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
    onVote(ranking);
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
            <button
              type="button"
              onClick={() => {
                setRankTiers([rankTiers.flat()]);
                setRankAnnouncement('所有选项已设为并列');
              }}
              disabled={rankTiers.length <= 1}
              className="inline-flex items-center gap-1 border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Equal size={12} /> 全部并列
            </button>
            <button
              type="button"
              onClick={() => {
                setRankTiers(rankTiers.flat().map(modelId => [modelId]));
                setRankAnnouncement('已恢复为独立排名梯队');
              }}
              disabled={rankTiers.every(tier => tier.length === 1)}
              className="inline-flex items-center gap-1 border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Unlink size={12} /> 拆为独立梯队
            </button>
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
              {tierIndex > 0 && (
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
                draggable
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
                    <button onClick={() => moveTier(tierIndex, -1)} disabled={tierIndex === 0} className="p-1.5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25" title="梯队上移" aria-label={`将第 ${rank} 名梯队上移`}>
                      <ArrowUp size={14} />
                    </button>
                    <button onClick={() => moveTier(tierIndex, 1)} disabled={tierIndex === rankTiers.length - 1} className="p-1.5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25" title="梯队下移" aria-label={`将第 ${rank} 名梯队下移`}>
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
          submitRanking();
        }}
        disabled={!canSubmit}
        className={`mt-4 flex w-full shrink-0 items-center justify-center gap-2 py-3 font-black transition-colors ${
          canSubmit ? 'btn-primary' : 'cursor-not-allowed border border-white/10 bg-white/10 text-slate-400'
        }`}
      >
        <Trophy size={18} />
        {canSubmit ? '提交排名' : '媒体加载中...'}
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
          {onGoBack && (
            <button onClick={onGoBack} className="border-l border-white/10 pl-4 text-sm font-medium text-slate-200 transition-colors hover:text-white">
              上一题
            </button>
          )}
          {onSkip && (
            <button onClick={onSkip} className="border-l border-white/10 pl-4 text-sm font-medium text-amber-200 transition-colors hover:text-amber-100">
              <span className="inline-flex items-center gap-1.5"><SkipForward size={15} /> 跳过本题</span>
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
                    draggable
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
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveTier(tierIndex, -1)}
                          disabled={tierIndex === 0}
                          className="p-1 text-black/65 hover:bg-black hover:text-white disabled:opacity-25"
                          title="上移"
                          aria-label={`将 ${optionLabel} 所在梯队上移`}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTier(tierIndex, 1)}
                          disabled={tierIndex === rankTiers.length - 1}
                          className="p-1 text-black/65 hover:bg-black hover:text-white disabled:opacity-25"
                          title="下移"
                          aria-label={`将 ${optionLabel} 所在梯队下移`}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => mergeTierWithPrevious(tierIndex)}
                          disabled={tierIndex === 0}
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
                    <div className="min-h-[280px] flex-1 overflow-hidden bg-black/55 p-1">
                      <MediaRenderer
                        key={`${mediaCycleKey}-${output.modelId}-${output.url}-media`}
                        url={output.url}
                        label={optionLabel}
                        isActive={true}
                        forceType={item.type}
                        onLoadStatusChange={(isLoaded) => handleLoadStatusChange(output.modelId, isLoaded)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <aside className="ark-panel h-fit p-4 xl:sticky xl:top-4">
              {(hasReferences || effectiveStartImageUrl) && (
                <div className="mb-4 border-b border-white/10 pb-4">
                  <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-100">参考素材</h3>
                  <div className="flex flex-wrap gap-3">
                    {effectiveStartImageUrl && (
                      <div className="relative group">
                        <button
                          onClick={() => {
                            setShowReference(true);
                            setCurrentRefIndex(-1);
                          }}
                          className="relative flex h-16 w-16 items-center justify-center overflow-hidden border-2 border-[var(--accent-cold)] bg-white/5 shadow-md shadow-black/20 transition-all hover:border-[var(--accent)]"
                          title="查看首帧图"
                        >
                          <img src={effectiveStartImageUrl} className="h-full w-full object-cover opacity-80 group-hover:opacity-100" referrerPolicy="no-referrer" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <Expand size={16} className="text-white" />
                          </div>
                        </button>
                        <div className="mt-1 text-center text-[10px] font-medium text-slate-300">首帧图</div>
                      </div>
                    )}

                    {hasReferences && (
                      <div className="relative group">
                        <button
                          onClick={() => {
                            setShowReference(true);
                            setCurrentRefIndex(0);
                          }}
                          className="relative flex h-16 w-16 items-center justify-center overflow-hidden border-2 border-white/15 bg-white/5 shadow-md shadow-black/20 transition-all hover:border-[var(--accent)]"
                          title="查看参考素材"
                        >
                          {referenceThumbnailUrl ? (
                            <img src={referenceThumbnailUrl} className="h-full w-full object-cover opacity-80 group-hover:opacity-100" referrerPolicy="no-referrer" />
                          ) : (
                            <FileAudio className="h-7 w-7 text-amber-300" />
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                            <Expand size={16} className="text-white" />
                          </div>
                          {effectiveReferenceUrls!.length > 1 && (
                            <div className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-[var(--accent-cold)] text-[10px] text-white">
                              {effectiveReferenceUrls!.length}
                            </div>
                          )}
                        </button>
                        <div className="mt-1 text-center text-[10px] font-medium text-slate-300">
                          {effectiveReferenceUrls!.length > 1 ? `${effectiveReferenceUrls!.length} 项参考` : (referenceThumbnailUrl ? '参考图' : '参考音频')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
          onClick={() => setShowRankDrawer(true)}
          className="btn-primary fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 px-5 py-3 shadow-2xl xl:hidden"
          aria-expanded={showRankDrawer}
          aria-controls="arena-rank-tier-drawer"
        >
          <Layers3 size={17} />
          调整排名梯队
        </button>
      )}

      <div className="sr-only" aria-live="polite">{rankAnnouncement}</div>

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

      {showReference && (hasReferences || effectiveStartImageUrl) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={() => setShowReference(false)}>
          <div className="relative flex h-full w-full max-w-5xl flex-col items-center justify-center p-4" onClick={(event) => event.stopPropagation()}>
            <div className="relative mb-4 h-[80vh] min-h-0 w-full">
              <MediaRenderer
                url={currentRefIndex === -1 ? effectiveStartImageUrl! : effectiveReferenceUrls![currentRefIndex]}
                isActive={true}
                className="border-none bg-transparent shadow-none"
              />
            </div>

            <div className="flex items-center gap-4 border border-white/10 bg-black/55 px-6 py-3 backdrop-blur-md">
              {currentRefIndex === -1 ? (
                <span className="text-sm font-medium text-white">首帧图</span>
              ) : (
                <>
                  {effectiveReferenceUrls && effectiveReferenceUrls.length > 1 && (
                    <>
                      <button
                        onClick={() => setCurrentRefIndex(prev => (prev === 0 ? effectiveReferenceUrls.length - 1 : prev - 1))}
                        className="glass-panel-hover p-2 text-white transition-colors"
                        aria-label="上一张参考图"
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <span className="mx-2 font-mono text-sm text-white">
                        {currentRefIndex + 1} / {effectiveReferenceUrls.length}
                      </span>
                      <button
                        onClick={() => setCurrentRefIndex(prev => (prev === effectiveReferenceUrls.length - 1 ? 0 : prev + 1))}
                        className="glass-panel-hover p-2 text-white transition-colors"
                        aria-label="下一张参考图"
                      >
                        <ArrowRight size={20} />
                      </button>
                    </>
                  )}
                  {effectiveReferenceUrls && effectiveReferenceUrls.length === 1 && (
                    <span className="text-sm font-medium text-white">
                      {inferReferenceMediaType(effectiveReferenceUrls[0]) === 'audio' ? '参考音频' : '参考图像'}
                    </span>
                  )}
                </>
              )}
            </div>

            <button
              onClick={() => setShowReference(false)}
              className="glass-panel-hover absolute right-6 top-6 p-2 text-white/70 transition-colors hover:text-white"
            >
              <span className="mr-2 text-sm font-medium">关闭</span>
              <kbd className="bg-white/10 px-1.5 text-xs">Esc</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArenaRankVotingScreen;
