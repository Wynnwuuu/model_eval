import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, Cloud, Expand, FileAudio, GripVertical, SkipForward, Trophy } from 'lucide-react';
import { EvaluationItem, RankingEntry } from '../types';
import { getModelOutputsForItem } from '../rankingUtils';
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
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [currentRefIndex, setCurrentRefIndex] = useState(0);

  const sourceOutputs = useMemo(() => getModelOutputsForItem(item, models), [item, models]);
  const mediaCycleKey = useMemo(
    () => [currentIndex, item.id, item.type, ...sourceOutputs.map(output => `${output.modelId}:${output.url}`)].join('|'),
    [currentIndex, item.id, item.type, sourceOutputs]
  );
  const mediaCycleKeyRef = useRef(mediaCycleKey);
  mediaCycleKeyRef.current = mediaCycleKey;
  const [orderedIds, setOrderedIds] = useState<string[]>([]);

  useEffect(() => {
    const shuffled = [...sourceOutputs]
      .map((output, index) => ({ output, sortKey: Math.random() + index * 0.0001 }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(entry => entry.output.modelId);

    setOrderedIds(shuffled);
    setLoaded({});
    setMediaWaitTimedOut(false);
    setDraggedId(null);
    setShowFullPrompt(false);
    setShowReference(false);
    setCurrentRefIndex(0);
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [mediaCycleKey, sourceOutputs]);

  const outputsById = new Map(sourceOutputs.map(output => [output.modelId, output]));
  const orderedOutputs = orderedIds
    .map(id => outputsById.get(id))
    .filter(Boolean) as typeof sourceOutputs;
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
  const allMediaLoaded = orderedOutputs.length >= 3 && orderedOutputs.every(output => loaded[output.modelId]);
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
    if (orderedOutputs.length < 3 || allMediaLoaded) {
      setMediaWaitTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setMediaWaitTimedOut(true);
    }, RANK_MEDIA_WAIT_FALLBACK_MS);

    return () => window.clearTimeout(timer);
  }, [mediaCycleKey, orderedOutputs.length, allMediaLoaded]);

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

  const moveOutput = (modelId: string, direction: -1 | 1) => {
    setOrderedIds(prev => {
      const index = prev.indexOf(modelId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;

      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleLoadStatusChange = useCallback((modelId: string, isLoaded: boolean) => {
    if (mediaCycleKeyRef.current !== mediaCycleKey) return;
    setLoaded(prev => {
      if (prev[modelId] === isLoaded) return prev;
      return { ...prev, [modelId]: isLoaded };
    });
  }, [mediaCycleKey]);

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;

    setOrderedIds(prev => {
      const next = prev.filter(id => id !== draggedId);
      const targetIndex = next.indexOf(targetId);
      next.splice(targetIndex, 0, draggedId);
      return next;
    });
    setDraggedId(null);
  };

  const submitRanking = () => {
    const ranking = orderedOutputs.map((output, index) => ({
      modelId: output.modelId,
      modelName: output.modelName,
      rank: index + 1
    }));

    onVote(ranking);
  };

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
            <span>拖拽或使用上下箭头排序，第一名放最上方</span>
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

      <div className="flex-1 min-h-0 overflow-auto bg-black/25 p-4 md:p-6">
        {orderedOutputs.length < 3 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-300">
            <Trophy size={40} className="mb-4 text-[var(--accent)]" />
            <h3 className="mb-2 text-lg font-semibold text-slate-100">Arena-rank 至少需要 3 个候选产物</h3>
            <p className="max-w-md text-sm">请在创建任务时选择 3 列或更多模型结果列；2 个候选请继续使用普通 Arena。</p>
          </div>
        ) : (
          <div className="grid min-h-[640px] grid-cols-1 gap-6 xl:min-h-full xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="grid min-w-0 grid-cols-1 content-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {orderedOutputs.map((output, index) => (
                <div
                  key={`${mediaCycleKey}-${output.modelId}-${output.url}`}
                  draggable
                  onDragStart={() => setDraggedId(output.modelId)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(output.modelId)}
                  className={`ark-rank-card flex min-h-[360px] min-w-0 flex-col overflow-hidden transition-colors ${
                    draggedId === output.modelId ? 'opacity-70' : 'hover:border-[var(--accent)]'
                  }`}
                >
                  <div className="ark-rank-head flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2 text-sm font-black">
                      <GripVertical size={16} />
                      <span>Rank {index + 1}</span>
                      <span className="font-mono text-xs opacity-65">Option {index + 1}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveOutput(output.modelId, -1)}
                        disabled={index === 0}
                        className="p-1.5 text-black/70 hover:bg-black hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black/70"
                        title="上移"
                        aria-label={`将 Option ${index + 1} 上移`}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        onClick={() => moveOutput(output.modelId, 1)}
                        disabled={index === orderedOutputs.length - 1}
                        className="p-1.5 text-black/70 hover:bg-black hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-black/70"
                        title="下移"
                        aria-label={`将 Option ${index + 1} 下移`}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-[280px] flex-1 overflow-hidden bg-black/55 p-1">
                    <MediaRenderer
                      key={`${mediaCycleKey}-${output.modelId}-${output.url}-media`}
                      url={output.url}
                      label={`Option ${index + 1}`}
                      isActive={true}
                      forceType={item.type}
                      onLoadStatusChange={(isLoaded) => handleLoadStatusChange(output.modelId, isLoaded)}
                    />
                  </div>
                </div>
              ))}
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

              <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-100">当前排名</h3>
              <div className="mb-4 space-y-2">
                {orderedOutputs.map((output, index) => (
                  <div key={output.modelId} className="flex items-center gap-3 border border-white/10 bg-white/5 px-3 py-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)]/20 text-xs font-bold text-[var(--accent)]">
                      {index + 1}
                    </span>
                    <span className="text-sm text-slate-200">Option {index + 1}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={submitRanking}
                disabled={!canSubmit}
                className={`flex w-full items-center justify-center gap-2 py-3 font-black transition-colors ${
                  canSubmit
                    ? 'btn-primary'
                    : 'cursor-not-allowed border border-white/10 bg-white/10 text-slate-400'
                }`}
              >
                <Trophy size={18} />
                {canSubmit ? '提交排名' : '媒体加载中...'}
              </button>
              {mediaWaitTimedOut && !allMediaLoaded && (
                <div className="mt-3 border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  {'\u5a92\u4f53\u4ecd\u5728\u52a0\u8f7d\u3002\u8bf7\u4f18\u5148\u7b49\u5f85\u753b\u9762\u51fa\u73b0\uff1b\u5982\u957f\u65f6\u95f4\u65e0\u54cd\u5e94\uff0c\u53ef\u6253\u5f00\u539f\u94fe\u63a5\u6838\u5bf9\u6216\u8df3\u8fc7\u672c\u9898\u3002'}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

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
