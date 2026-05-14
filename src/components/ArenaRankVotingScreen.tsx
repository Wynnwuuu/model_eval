import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Cloud, GripVertical, Trophy } from 'lucide-react';
import { EvaluationItem, RankingEntry } from '../types';
import { getModelOutputsForItem } from '../rankingUtils';
import MediaRenderer from './MediaRenderer';
import { normalizeUrl } from '../utils';

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

      const isVideo = normalizedUrl.match(/\.(mp4|webm|ogg)$/i) || normalizedUrl.includes('video');
      if (isVideo) {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.setAttribute('referrerpolicy', 'no-referrer');
        video.src = normalizedUrl;
      } else {
        const img = new Image();
        img.src = normalizedUrl;
      }
    });
  }, [nextItem, models]);

  const outputsById = new Map(sourceOutputs.map(output => [output.modelId, output]));
  const orderedOutputs = orderedIds
    .map(id => outputsById.get(id))
    .filter(Boolean) as typeof sourceOutputs;

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
    <div className="h-full flex flex-col">
      <div className="h-14 bg-white/5 border-b border-white/10 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-slate-200 text-lg">Arena-rank</h2>
          <span className="px-2 py-1 bg-white/10 text-slate-200 rounded-md text-xs font-mono">
            {currentIndex + 1} / {totalItems}
          </span>
          <div className={`flex items-center gap-1 text-xs font-medium transition-all duration-500 ${justSaved ? 'text-emerald-400 opacity-100' : 'text-slate-200 opacity-50'}`}>
            {justSaved ? <CheckCircle2 size={14} /> : <Cloud size={14} />}
            <span>{justSaved ? '已保存' : '自动保存开启'}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden lg:flex items-center gap-2 text-xs text-slate-300">
            <GripVertical size={14} />
            <span>拖拽或使用上下箭头排序，第一名放最上方</span>
          </div>
          {onGoBack && (
            <button onClick={onGoBack} className="text-slate-200 hover:text-white text-sm font-medium transition-colors border-l border-white/10 pl-4">
              上一题
            </button>
          )}
          {onBack && (
            <button onClick={onBack} className="text-slate-200 hover:text-white text-sm font-medium transition-colors border-l border-white/10 pl-4">
              返回大盘
            </button>
          )}
          <button onClick={onEnd} className="text-slate-200 hover:text-white text-sm font-medium transition-colors border-l border-white/10 pl-4">
            提前结束
          </button>
        </div>
      </div>

      <div className="w-full h-1 bg-white/10 shrink-0">
        <div className="h-full bg-amber-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      {(item.inputs || item.prompt) && (
        <div className="bg-white/5 border-b border-white/10 px-6 py-3 shrink-0 relative shadow-md shadow-black/20 z-10">
          <div className={`text-slate-200 text-sm leading-relaxed transition-all duration-300 whitespace-pre-wrap ${showFullPrompt ? '' : 'line-clamp-2 pr-8'}`}>
            {visibleInputs.length > 0 ? (
              <div className="flex flex-col gap-2">
                {visibleInputs.map(([key, value]) => (
                  <div key={key} className="flex flex-col sm:flex-row gap-1 sm:gap-3">
                    <span className="font-semibold text-slate-100 select-none uppercase text-xs tracking-wider bg-white/10 px-1.5 py-0.5 rounded shrink-0 self-start mt-0.5">{key}</span>
                    <span className="text-slate-200 break-words">{String(value)}</span>
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
              className="absolute right-4 top-3 text-slate-200 hover:text-amber-400 p-1 bg-white/5 rounded-full shadow-md shadow-black/20 border border-white/10"
            >
              {showFullPrompt ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 bg-white/5 p-4 md:p-6 overflow-auto">
        {orderedOutputs.length < 3 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-300">
            <Trophy size={40} className="text-amber-400 mb-4" />
            <h3 className="text-lg font-semibold text-slate-100 mb-2">Arena-rank 至少需要 3 个候选视频</h3>
            <p className="text-sm max-w-md">请在创建任务时选择 3 列或更多模型结果列；2 个候选请继续使用原 Arena。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 min-h-[640px] xl:min-h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 content-start min-w-0">
              {orderedOutputs.map((output, index) => (
                <div
                  key={output.modelId}
                  draggable
                  onDragStart={() => setDraggedId(output.modelId)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(output.modelId)}
                  className={`min-h-[360px] min-w-0 flex flex-col bg-white/5 border rounded-xl overflow-hidden transition-colors ${
                    draggedId === output.modelId ? 'border-amber-400/70 opacity-70' : 'border-white/10 hover:border-amber-400/50'
                  }`}
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <GripVertical size={16} className="text-slate-400" />
                      <span>Rank {index + 1}</span>
                      <span className="text-xs text-slate-400">Option {index + 1}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => moveOutput(output.modelId, -1)}
                        disabled={index === 0}
                        className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                        title="上移"
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        onClick={() => moveOutput(output.modelId, 1)}
                        disabled={index === orderedOutputs.length - 1}
                        className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                        title="下移"
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-[280px] overflow-hidden bg-black/40 p-1">
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

            <aside className="bg-black/20 border border-white/10 rounded-xl p-4 h-fit sticky top-4">
              <h3 className="text-sm font-semibold text-slate-100 mb-3">当前排名</h3>
              <div className="space-y-2 mb-4">
                {orderedOutputs.map((output, index) => (
                  <div key={output.modelId} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 border border-white/10">
                    <span className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center text-xs font-bold">
                      {index + 1}
                    </span>
                    <span className="text-sm text-slate-200">Option {index + 1}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={submitRanking}
                disabled={!allMediaLoaded}
                className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${
                  allMediaLoaded
                    ? 'bg-amber-500 hover:bg-amber-600 text-black'
                    : 'bg-white/10 text-slate-400 cursor-not-allowed'
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
