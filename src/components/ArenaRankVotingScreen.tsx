import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Cloud, GripVertical, Trophy } from 'lucide-react';
import { EvaluationItem, RankingEntry } from '../types';
import { getModelOutputsForItem } from '../rankingUtils';
import MediaRenderer from './MediaRenderer';
import { normalizeUrl } from '../utils';
import { VIDEO_EXTENSIONS } from '../constants';
import DimensionChips from './DimensionChips';
import { getDimensionValuesForItem, hasDimensionValues } from '../dimensionUtils';

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
}

const ArenaRankVotingScreen: React.FC<ArenaRankVotingScreenProps> = ({
  item,
  nextItem,
  currentIndex,
  totalItems,
  models = [],
  onVote,
  onEnd,
  onBack,
  onGoBack
}) => {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const sourceOutputs = useMemo(() => getModelOutputsForItem(item, models), [item, models]);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);

  useEffect(() => {
    const shuffled = [...sourceOutputs]
      .map((output, index) => ({ output, sortKey: Math.random() + index * 0.0001 }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(entry => entry.output.modelId);

    setOrderedIds(shuffled);
    setLoaded({});
    setDraggedId(null);
    setShowFullPrompt(false);
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [item.id, sourceOutputs]);

  useEffect(() => {
    if (!nextItem) return;

    getModelOutputsForItem(nextItem, models).forEach(output => {
      const normalizedUrl = normalizeUrl(output.url);
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
      } else {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.src = normalizedUrl;
      }
    });
  }, [nextItem, models]);

  const outputsById = new Map(sourceOutputs.map(output => [output.modelId, output]));
  const orderedOutputs = orderedIds
    .map(id => outputsById.get(id))
    .filter(Boolean) as typeof sourceOutputs;
  const dimensionValues = getDimensionValuesForItem(item as any);
  const hasDimensions = hasDimensionValues(dimensionValues);

  const progress = (currentIndex / totalItems) * 100;
  const allMediaLoaded = orderedOutputs.length >= 3 && orderedOutputs.every(output => loaded[output.modelId]);
  const visibleInputs = item.inputs ? Object.entries(item.inputs) : [];

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
    setLoaded(prev => {
      if (prev[modelId] === isLoaded) return prev;
      return { ...prev, [modelId]: isLoaded };
    });
  }, []);

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
                  key={output.modelId}
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
                disabled={!allMediaLoaded}
                className={`flex w-full items-center justify-center gap-2 py-3 font-black transition-colors ${
                  allMediaLoaded
                    ? 'btn-primary'
                    : 'cursor-not-allowed border border-white/10 bg-white/10 text-slate-400'
                }`}
              >
                <Trophy size={18} />
                {allMediaLoaded ? '提交排名' : '媒体加载中...'}
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArenaRankVotingScreen;
