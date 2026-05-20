import React, { useEffect, useCallback, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Cloud, Equal, Expand, ThumbsUp, ArrowLeft, ArrowRight, Shuffle } from 'lucide-react';
import { EvaluationItem, VoteType } from '../types';
import MediaRenderer from './MediaRenderer';
import { KEYBOARD_SHORTCUTS, VIDEO_EXTENSIONS } from '../constants';
import { resolveMediaPlaybackUrl } from '../mediaProxy';
import DimensionChips from './DimensionChips';
import { getDimensionValuesForItem, hasDimensionValues } from '../dimensionUtils';

interface VotingScreenProps {
  item: EvaluationItem;
  nextItem?: EvaluationItem;
  currentIndex: number;
  totalItems: number;
  onVote: (vote: VoteType) => void;
  onEnd: () => void;
  onBack?: () => void;
  onGoBack?: () => void;
  allowTie?: boolean;
}

const extractUrls = (value: unknown): string[] => {
  if (typeof value !== 'string') return [];
  return value.match(/https?:\/\/[^\s"'\t|,;>]+/g) || [];
};

const isStartImageKey = (key: string) => /start|first|首帧|首图|起始/i.test(key);
const isReferenceKey = (key: string) => /ref|reference|参考|參考/i.test(key);
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
  allowTie = true
}) => {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [currentRefIndex, setCurrentRefIndex] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  const [leftLoaded, setLeftLoaded] = useState(false);
  const [rightLoaded, setRightLoaded] = useState(false);
  const [mediaWaitTimedOut, setMediaWaitTimedOut] = useState(false);
  const allMediaLoaded = leftLoaded && rightLoaded;
  const canVote = allMediaLoaded || mediaWaitTimedOut;

  const effectiveStartImageUrl = item.startImageUrl || (() => {
    if (!item.inputs) return undefined;
    for (const [key, val] of Object.entries(item.inputs)) {
      if (isStartImageKey(key)) {
        const [url] = extractUrls(val);
        if (url) return url;
      }
    }
    return undefined;
  })();

  const effectiveReferenceUrls = item.referenceUrls || (() => {
    if (!item.inputs) return undefined;
    const refs: string[] = [];
    for (const [key, val] of Object.entries(item.inputs)) {
      if (isReferenceKey(key)) {
        refs.push(...extractUrls(val));
      }
    }
    return refs.length > 0 ? refs : undefined;
  })();

  const hasReferences = Boolean(effectiveReferenceUrls && effectiveReferenceUrls.length > 0);

  const hiddenInputKeys = new Set<string>();
  if (item.inputs) {
    for (const [key, val] of Object.entries(item.inputs)) {
      if (extractUrls(val).length > 0 && (isStartImageKey(key) || isReferenceKey(key))) {
        hiddenInputKeys.add(key);
      }
    }
  }

  const visibleInputs = item.inputs
    ? Object.entries(item.inputs).filter(([key]) => !hiddenInputKeys.has(key))
    : [];
  const dimensionValues = getDimensionValuesForItem(item as any);
  const hasDimensions = hasDimensionValues(dimensionValues);

  const progress = (currentIndex / totalItems) * 100;
  const isSwapped = item.isSwapped ?? false;

  const leftData = isSwapped
    ? { url: item.modelB_Url, voteVal: 'B' as VoteType }
    : { url: item.modelA_Url, voteVal: 'A' as VoteType };

  const rightData = isSwapped
    ? { url: item.modelA_Url, voteVal: 'A' as VoteType }
    : { url: item.modelB_Url, voteVal: 'B' as VoteType };

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;

    const key = event.key;

    if (showReference && effectiveReferenceUrls && effectiveReferenceUrls.length > 1) {
      if (key === 'ArrowLeft') {
        setCurrentRefIndex(prev => (prev === 0 ? effectiveReferenceUrls.length - 1 : prev - 1));
        event.stopPropagation();
        return;
      }
      if (key === 'ArrowRight') {
        setCurrentRefIndex(prev => (prev === effectiveReferenceUrls.length - 1 ? 0 : prev + 1));
        event.stopPropagation();
        return;
      }
      if (key === 'Escape') {
        setShowReference(false);
        return;
      }
    }

    if (!showReference && canVote) {
      if (KEYBOARD_SHORTCUTS.A.includes(key)) onVote(leftData.voteVal);
      else if (KEYBOARD_SHORTCUTS.B.includes(key)) onVote(rightData.voteVal);
      else if (allowTie && KEYBOARD_SHORTCUTS.TIE.includes(key)) onVote('Tie');
    }
  }, [onVote, showReference, effectiveReferenceUrls, leftData.voteVal, rightData.voteVal, canVote, allowTie]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  useEffect(() => {
    if (!nextItem) return;

    const preloadMedia = (url: string) => {
      if (!url) return;
      const normalizedUrl = resolveMediaPlaybackUrl(url);
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
    };

    if (nextItem.modelA_Url) preloadMedia(nextItem.modelA_Url);
    if (nextItem.modelB_Url) preloadMedia(nextItem.modelB_Url);

    const nextEffectiveRefs = nextItem.referenceUrls || (() => {
      if (!nextItem.inputs) return undefined;
      const refs: string[] = [];
      for (const [key, val] of Object.entries(nextItem.inputs)) {
        if (isReferenceKey(key)) refs.push(...extractUrls(val));
      }
      return refs.length > 0 ? refs : undefined;
    })();

    if (nextEffectiveRefs && nextEffectiveRefs.length > 0) {
      nextEffectiveRefs.forEach(preloadMedia);
    }
  }, [nextItem]);

  useEffect(() => {
    setShowFullPrompt(false);
    setShowReference(false);
    setCurrentRefIndex(0);
    setLeftLoaded(false);
    setRightLoaded(false);
    setMediaWaitTimedOut(false);

    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [item.id]);

  useEffect(() => {
    if (allMediaLoaded) {
      setMediaWaitTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setMediaWaitTimedOut(true);
    }, VOTE_MEDIA_WAIT_FALLBACK_MS);

    return () => window.clearTimeout(timer);
  }, [item.id, allMediaLoaded]);

  return (
    <div className="ark-operation-screen h-full flex flex-col">
      <div className="ark-operation-header h-14 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-black uppercase tracking-wide text-slate-100">批量评测</h2>
          <span className="border border-white/15 bg-white/10 px-2 py-1 font-mono text-xs text-slate-200">
            {currentIndex + 1} / {totalItems}
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
          <div className="flex h-full min-h-[560px] flex-col gap-4 p-4 md:gap-6 md:p-6 lg:flex-row">
            <div className="ark-vote-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-colors hover:border-[var(--accent-cold)]">
              <div className="relative min-h-0 flex-1 overflow-hidden bg-black/55 p-1">
                <MediaRenderer
                  url={leftData.url}
                  label="选项 1"
                  isActive={true}
                  onLoadStatusChange={setLeftLoaded}
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

              {(hasReferences || effectiveStartImageUrl) && (
                <div className="flex flex-row gap-4 lg:flex-col">
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
                      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-slate-200">
                        首帧图
                      </div>
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
                        title="查看参考图"
                      >
                        <img src={effectiveReferenceUrls![0] || undefined} className="h-full w-full object-cover opacity-80 group-hover:opacity-100" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <Expand size={16} className="text-white" />
                        </div>
                      </button>
                      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-slate-200">
                        {effectiveReferenceUrls!.length > 1 ? `${effectiveReferenceUrls!.length} 张参考图` : '参考图'}
                      </div>
                      {effectiveReferenceUrls!.length > 1 && (
                        <div className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white bg-[var(--accent-cold)] text-[10px] text-white">
                          {effectiveReferenceUrls!.length}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(hasReferences || effectiveStartImageUrl) && <div className="hidden h-8 w-px bg-white/10 lg:block" />}

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
                  url={rightData.url}
                  label="选项 2"
                  isActive={true}
                  onLoadStatusChange={setRightLoaded}
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
              部分媒体响应较慢，已解除投票等待。建议确认画面后投票；媒体加载完成后会继续显示。
            </div>
          )}
        </div>
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
                  {effectiveReferenceUrls && effectiveReferenceUrls.length === 1 && <span className="text-sm font-medium text-white">参考图像</span>}
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

export default VotingScreen;
