import React, { useEffect, useCallback, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Cloud, Equal, ThumbsUp, Shuffle, SkipForward } from 'lucide-react';
import { EvaluationItem, VoteType } from '../types';
import MediaRenderer from './MediaRenderer';
import { KEYBOARD_SHORTCUTS, VIDEO_EXTENSIONS } from '../constants';
import { resolveMediaPlaybackCandidates } from '../mediaProxy';
import DimensionChips from './DimensionChips';
import { getDimensionValuesForItem, hasDimensionValues } from '../dimensionUtils';
import { getEvaluationReferenceInputKeys, resolveEvaluationReferenceMedia } from '../evaluationReferenceMedia';
import EvaluationReferenceMediaStrip from './EvaluationReferenceMediaStrip';

interface VotingScreenProps {
  item: EvaluationItem;
  nextItem?: EvaluationItem;
  currentIndex: number;
  totalItems: number;
  onVote: (vote: VoteType) => void;
  onEnd: () => void;
  onBack?: () => void;
  onGoBack?: () => void;
  onSkip?: () => void;
  allowTie?: boolean;
  arenaProgress?: {
    contributed: number;
    suggested: number;
    reached: boolean;
  };
}

const VOTE_MEDIA_WAIT_FALLBACK_MS = 8000;

const VotingScreen: React.FC<VotingScreenProps> = ({
  item,
  nextItem,
  currentIndex,
  totalItems,
  onVote,
  onEnd,
  onBack,
  onGoBack,
  onSkip,
  allowTie = true,
  arenaProgress
}) => {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [referenceViewerOpen, setReferenceViewerOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const [leftLoaded, setLeftLoaded] = useState(false);
  const [rightLoaded, setRightLoaded] = useState(false);
  const [mediaWaitTimedOut, setMediaWaitTimedOut] = useState(false);
  const allMediaLoaded = leftLoaded && rightLoaded;
  const canVote = allMediaLoaded || mediaWaitTimedOut;

  const hiddenInputKeys = getEvaluationReferenceInputKeys(item);

  const visibleInputs = item.inputs
    ? Object.entries(item.inputs).filter(([key]) => !hiddenInputKeys.has(key))
    : [];
  const dimensionValues = getDimensionValuesForItem(item as any);
  const hasDimensions = hasDimensionValues(dimensionValues);

  const progress = arenaProgress
    ? Math.min(100, (arenaProgress.contributed / Math.max(arenaProgress.suggested, 1)) * 100)
    : (currentIndex / totalItems) * 100;
  const isSwapped = item.isSwapped ?? false;

  const leftData = isSwapped
    ? { url: item.modelB_Url, voteVal: 'B' as VoteType }
    : { url: item.modelA_Url, voteVal: 'A' as VoteType };

  const rightData = isSwapped
    ? { url: item.modelA_Url, voteVal: 'A' as VoteType }
    : { url: item.modelB_Url, voteVal: 'B' as VoteType };
  const mediaCycleKey = [currentIndex, item.id, item.type, leftData.url, rightData.url].join('|');
  const mediaCycleKeyRef = useRef(mediaCycleKey);
  mediaCycleKeyRef.current = mediaCycleKey;

  const handleLeftLoadStatus = useCallback((isLoaded: boolean) => {
    if (mediaCycleKeyRef.current !== mediaCycleKey) return;
    setLeftLoaded(isLoaded);
  }, [mediaCycleKey]);

  const handleRightLoadStatus = useCallback((isLoaded: boolean) => {
    if (mediaCycleKeyRef.current !== mediaCycleKey) return;
    setRightLoaded(isLoaded);
  }, [mediaCycleKey]);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;

    const key = event.key;

    if (referenceViewerOpen) return;

    if (canVote) {
      if (KEYBOARD_SHORTCUTS.A.includes(key)) onVote(leftData.voteVal);
      else if (KEYBOARD_SHORTCUTS.B.includes(key)) onVote(rightData.voteVal);
      else if (allowTie && KEYBOARD_SHORTCUTS.TIE.includes(key)) onVote('Tie');
    }
  }, [onVote, referenceViewerOpen, leftData.voteVal, rightData.voteVal, canVote, allowTie]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  useEffect(() => {
    if (!nextItem) return;
    const preloadElements: Array<HTMLImageElement | HTMLVideoElement> = [];

    const preloadMedia = (url: string) => {
      if (!url) return;
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
    };

    const preloadUrls = [nextItem.modelA_Url, nextItem.modelB_Url].filter(Boolean) as string[];

    const nextReference = resolveEvaluationReferenceMedia(nextItem)
      .find(reference => reference.type !== 'audio');
    if (nextReference) preloadUrls.push(nextReference.url);

    preloadUrls.slice(0, allMediaLoaded ? 3 : 1).forEach(preloadMedia);

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
  }, [nextItem, allMediaLoaded]);

  useEffect(() => {
    mediaCycleKeyRef.current = mediaCycleKey;
    setShowFullPrompt(false);
    setReferenceViewerOpen(false);
    setLeftLoaded(false);
    setRightLoaded(false);
    setMediaWaitTimedOut(false);

    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [mediaCycleKey]);

  useEffect(() => {
    if (allMediaLoaded) {
      setMediaWaitTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setMediaWaitTimedOut(true);
    }, VOTE_MEDIA_WAIT_FALLBACK_MS);

    return () => window.clearTimeout(timer);
  }, [mediaCycleKey, allMediaLoaded]);

  return (
    <div className="ark-operation-screen h-full flex flex-col">
      <div className="ark-operation-header h-14 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-black uppercase tracking-wide text-slate-100">批量评测</h2>
          <span className="border border-white/15 bg-white/10 px-2 py-1 font-mono text-xs text-slate-200">
            {arenaProgress
              ? `已贡献 ${arenaProgress.contributed} / 建议 ${arenaProgress.suggested} 场`
              : `${currentIndex + 1} / ${totalItems}`}
          </span>

          <div className={`flex items-center gap-1 text-xs font-medium transition-all duration-500 ${justSaved ? 'text-emerald-400 opacity-100' : 'text-slate-200 opacity-50'}`}>
            {justSaved ? <CheckCircle2 size={14} /> : <Cloud size={14} />}
            <span>{justSaved ? '已保存' : '自动保存开启'}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-6 font-mono text-xs text-slate-200 lg:flex">
            <span className="flex items-center gap-1"><kbd className="bg-white/10 border border-white/10 px-1.5 py-0.5 text-slate-200">1</kbd> 投左侧</span>
            <span className="flex items-center gap-1"><kbd className="bg-white/10 border border-white/10 px-1.5 py-0.5 text-slate-200">Enter</kbd> 平局</span>
            <span className="flex items-center gap-1"><kbd className="bg-white/10 border border-white/10 px-1.5 py-0.5 text-slate-200">2</kbd> 投右侧</span>
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
          {(!arenaProgress || arenaProgress.contributed > 0) && (
            <button
              onClick={onEnd}
              className={`border-l border-white/10 pl-4 text-sm font-medium transition-colors ${arenaProgress?.reached ? 'text-amber-300 hover:text-amber-100' : 'text-slate-200 hover:text-white'}`}
            >
              {arenaProgress ? (arenaProgress.reached ? '查看结果' : '结束并查看结果') : '提前结束'}
            </button>
          )}
        </div>
      </div>

      <div className="h-1 w-full shrink-0 bg-white/10">
        <div className="ark-progress h-full transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-black/25">
        {(item.inputs || item.prompt || hasDimensions) && (
          <div className="ark-prompt-strip relative z-10 shrink-0 px-6 py-3">
            <DimensionChips values={dimensionValues} className="mb-2" />
            <div className={`text-sm leading-relaxed transition-all duration-300 whitespace-pre-wrap ${showFullPrompt ? '' : 'line-clamp-2 pr-8'}`}>
              {item.inputs && visibleInputs.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {visibleInputs.map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                      <span className="shrink-0 self-start bg-black px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-white">{key}</span>
                      <span className="break-words">
                        {typeof value === 'string' && value.match(/^https?:\/\//) ? (
                          <a href={value} target="_blank" rel="noopener noreferrer" className="break-all font-semibold underline decoration-black/30 underline-offset-2">
                            {value}
                          </a>
                        ) : (
                          String(value)
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ) : item.prompt ? (
                <>
                  <span className="mr-2 select-none bg-black px-1.5 py-0.5 text-xs font-black uppercase tracking-wider text-white">输入</span>
                  {item.prompt}
                </>
              ) : null}
            </div>
            {((item.prompt && item.prompt.length > 150) || visibleInputs.length > 1 || visibleInputs.some(([, v]) => String(v).length > 150)) && (
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

        <div className="min-h-0 flex-1 overflow-auto">
          <EvaluationReferenceMediaStrip item={item} onViewerOpenChange={setReferenceViewerOpen} />
          <div className="flex h-full min-h-[560px] flex-col gap-4 p-4 md:gap-6 md:p-6 lg:flex-row">
            <div className="ark-vote-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-colors hover:border-[var(--accent-cold)]">
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/55 p-1">
                <MediaRenderer
                  key={`left-${mediaCycleKey}`}
                  url={leftData.url}
                  label="选项 1"
                  isActive={true}
                  onLoadStatusChange={handleLeftLoadStatus}
                  forceType={item.type}
                />
              </div>
              <button
                onClick={() => onVote(leftData.voteVal)}
                disabled={!canVote}
                className={`ark-vote-action shrink-0 p-4 font-black flex items-center justify-center gap-2 transition-all ${
                  canVote ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <ThumbsUp className="h-5 w-5" />
                {canVote ? '投给选项 1（左侧）' : '等待媒体...'}
              </button>
            </div>

            <div className="flex w-full shrink-0 flex-row items-center justify-center gap-4 lg:w-16 lg:flex-col">
              <div className="hidden lg:block" title="盲测开启：位置已随机打乱">
                <Shuffle size={14} className="text-slate-200" />
              </div>

              {allowTie && (
                <>
                  <button
                    onClick={() => onVote('Tie')}
                    disabled={!canVote}
                    className={`flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-md shadow-black/20 transition-all ${
                      canVote
                        ? 'glass-panel-hover cursor-pointer border-white/15 bg-white/5 text-slate-200 hover:border-[var(--accent)] hover:text-white'
                        : 'cursor-not-allowed border-white/10 bg-white/5 text-slate-500'
                    }`}
                    title="平局"
                  >
                    <Equal size={20} />
                  </button>
                  <span className="font-mono text-[10px] font-medium text-slate-200">平局</span>
                </>
              )}
            </div>

            <div className="ark-vote-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-colors hover:border-[var(--accent)]">
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/55 p-1">
                <MediaRenderer
                  key={`right-${mediaCycleKey}`}
                  url={rightData.url}
                  label="选项 2"
                  isActive={true}
                  onLoadStatusChange={handleRightLoadStatus}
                  forceType={item.type}
                />
              </div>
              <button
                onClick={() => onVote(rightData.voteVal)}
                disabled={!canVote}
                className={`ark-vote-action shrink-0 p-4 font-black flex items-center justify-center gap-2 transition-all ${
                  canVote ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <ThumbsUp className="h-5 w-5" />
                {canVote ? '投给选项 2（右侧）' : '等待媒体...'}
              </button>
            </div>
          </div>
          {mediaWaitTimedOut && !allMediaLoaded && (
            <div className="mx-4 mb-4 border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100 md:mx-6">
              {'\u5a92\u4f53\u4ecd\u5728\u52a0\u8f7d\u3002\u8bf7\u4f18\u5148\u7b49\u5f85\u753b\u9762\u51fa\u73b0\uff1b\u5982\u957f\u65f6\u95f4\u65e0\u54cd\u5e94\uff0c\u53ef\u6253\u5f00\u539f\u94fe\u63a5\u6838\u5bf9\u6216\u8df3\u8fc7\u672c\u9898\u3002'}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default VotingScreen;
