import React, { useEffect, useCallback, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Cloud, Equal, Expand, MessageSquare, ThumbsUp, Layers, ArrowLeft, ArrowRight, Shuffle } from 'lucide-react';
import { EvaluationItem, VoteType } from '../types';
import MediaRenderer from './MediaRenderer';
import { KEYBOARD_SHORTCUTS } from '../constants';
import { normalizeUrl } from '../utils';

interface VotingScreenProps {
  item: EvaluationItem;
  nextItem?: EvaluationItem;
  currentIndex: number;
  totalItems: number;
  onVote: (vote: VoteType) => void;
  onEnd: () => void;
  onBack?: () => void;
  onGoBack?: () => void;
}

const VotingScreen: React.FC<VotingScreenProps> = ({ 
  item, 
  nextItem,
  currentIndex, 
  totalItems, 
  onVote,
  onEnd,
  onBack,
  onGoBack
}) => {
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [currentRefIndex, setCurrentRefIndex] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  
  const [leftLoaded, setLeftLoaded] = useState(false);
  const [rightLoaded, setRightLoaded] = useState(false);
  const allMediaLoaded = leftLoaded && rightLoaded;

  // Dynamically extract startImageUrl and referenceUrls from inputs if they are missing (for backward compatibility with older tasks)
  const effectiveStartImageUrl = item.startImageUrl || (() => {
    if (!item.inputs) return undefined;
    for (const [key, val] of Object.entries(item.inputs)) {
      if (typeof val === 'string' && val.match(/^https?:\/\//)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('start') || lowerKey.includes('首帧') || lowerKey.includes('first')) {
          return val.match(/https?:\/\/[^\s"'\t|,;>]+/)?.[0];
        }
      }
    }
    return undefined;
  })();

  const effectiveReferenceUrls = item.referenceUrls || (() => {
    if (!item.inputs) return undefined;
    let refs: string[] = [];
    for (const [key, val] of Object.entries(item.inputs)) {
      if (typeof val === 'string' && val.match(/^https?:\/\//)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('ref') || lowerKey.includes('参考')) {
          const urls = val.match(/https?:\/\/[^\s"'\t|,;>]+/g);
          if (urls) refs.push(...urls);
        }
      }
    }
    return refs.length > 0 ? refs : undefined;
  })();

  const hasReferences = effectiveReferenceUrls && effectiveReferenceUrls.length > 0;

  // Determine which input keys to hide (because they are shown as media)
  const hiddenInputKeys = new Set<string>();
  if (item.inputs) {
    for (const [key, val] of Object.entries(item.inputs)) {
      if (typeof val === 'string' && val.match(/^https?:\/\//)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('start') || lowerKey.includes('首帧') || lowerKey.includes('first') || lowerKey.includes('ref') || lowerKey.includes('参考')) {
          hiddenInputKeys.add(key);
        }
      }
    }
  }

  const visibleInputs = item.inputs 
    ? Object.entries(item.inputs).filter(([key]) => !hiddenInputKeys.has(key))
    : [];

  const progress = ((currentIndex) / totalItems) * 100;

  // --- Blind Testing Logic ---
  // If isSwapped is true:
  // Left Screen shows Model B data
  // Right Screen shows Model A data
  const isSwapped = item.isSwapped ?? false;

  const leftData = isSwapped 
    ? { url: item.modelB_Url, voteVal: 'B' as VoteType } 
    : { url: item.modelA_Url, voteVal: 'A' as VoteType };

  const rightData = isSwapped 
    ? { url: item.modelA_Url, voteVal: 'A' as VoteType } 
    : { url: item.modelB_Url, voteVal: 'B' as VoteType };

  // Handle keys for voting AND gallery navigation
  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    // Don't trigger if user is typing
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;

    const key = event.key;

    // Gallery Controls (Only if Modal Open)
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

    // Voting Controls (Only if Modal Closed and Media Loaded)
    if (!showReference && allMediaLoaded) {
      // Key A/Left -> Vote for Left Content (which might be Model A or B depending on swap)
      if (KEYBOARD_SHORTCUTS.A.includes(key)) onVote(leftData.voteVal);
      // Key B/Right -> Vote for Right Content
      else if (KEYBOARD_SHORTCUTS.B.includes(key)) onVote(rightData.voteVal);
      // Tie is always Tie
      else if (KEYBOARD_SHORTCUTS.TIE.includes(key)) onVote('Tie');
    }
  }, [onVote, showReference, effectiveReferenceUrls, leftData.voteVal, rightData.voteVal, allMediaLoaded]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  // Preload next item's media
  useEffect(() => {
    if (nextItem) {
      const preloadMedia = (url: string) => {
        if (!url) return;
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) return;
        
        // Simple preloading strategy based on extension
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
      };

      if (nextItem.modelA_Url) preloadMedia(nextItem.modelA_Url);
      if (nextItem.modelB_Url) preloadMedia(nextItem.modelB_Url);
      
      const nextEffectiveRefs = nextItem.referenceUrls || (() => {
        if (!nextItem.inputs) return undefined;
        let refs: string[] = [];
        for (const [key, val] of Object.entries(nextItem.inputs)) {
          if (typeof val === 'string' && val.match(/^https?:\/\//)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes('ref') || lowerKey.includes('参考')) {
              const urls = val.match(/https?:\/\/[^\s"'\t|,;>]+/g);
              if (urls) refs.push(...urls);
            }
          }
        }
        return refs.length > 0 ? refs : undefined;
      })();
      
      if (nextEffectiveRefs && nextEffectiveRefs.length > 0) {
        nextEffectiveRefs.forEach(preloadMedia);
      }
    }
  }, [nextItem]);

  // Reset states on new item
  useEffect(() => {
    setShowFullPrompt(false);
    setShowReference(false);
    setCurrentRefIndex(0);
    setLeftLoaded(false);
    setRightLoaded(false);
    
    // Trigger saved animation
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [item.id]);

  return (
    <div className="h-full flex flex-col">
      {/* Header / Progress */}
      <div className="h-14 bg-white/5 border-b border-white/10 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="font-bold text-slate-200 text-lg">批量评测</h2>
          <span className="px-2 py-1 bg-white/10 text-slate-200 rounded-md text-xs font-mono">
             {currentIndex + 1} / {totalItems}
          </span>
          
          <div className={`flex items-center gap-1 text-xs font-medium transition-all duration-500 ${justSaved ? 'text-emerald-400 opacity-100' : 'text-slate-200 opacity-50'}`}>
            {justSaved ? <CheckCircle2 size={14} /> : <Cloud size={14} />}
            <span>{justSaved ? '已保存' : '自动保存开启'}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           <div className="hidden lg:flex items-center gap-6 text-xs text-slate-200 font-medium">
            <span className="flex items-center gap-1"><kbd className="bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-slate-200">1</kbd> 投左侧</span>
            <span className="flex items-center gap-1"><kbd className="bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-slate-200">Enter</kbd> 平局</span>
            <span className="flex items-center gap-1"><kbd className="bg-white/10 border border-white/10 rounded px-1.5 py-0.5 text-slate-200">2</kbd> 投右侧</span>
          </div>
          {onGoBack && (
            <button 
              onClick={onGoBack}
              className="text-slate-200 hover:text-slate-200 text-sm font-medium transition-colors border-l border-white/10 pl-4"
            >
              上一题
            </button>
          )}
          {onBack && (
            <button 
              onClick={onBack}
              className="text-slate-200 hover:text-slate-200 text-sm font-medium transition-colors border-l border-white/10 pl-4"
            >
              返回大盘
            </button>
          )}
          <button 
            onClick={onEnd}
            className="text-slate-200 hover:text-slate-200 text-sm font-medium transition-colors border-l border-white/10 pl-4"
          >
            提前结束
          </button>
        </div>
      </div>
      
      {/* Progress Bar */}
      <div className="w-full h-1 bg-white/10 shrink-0">
        <div 
          className="h-full bg-blue-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Main Layout */}
      <div className="flex-1 min-h-0 flex flex-col bg-white/5">
        
        {/* Top Section: Prompt / Inputs */}
        {(item.inputs || item.prompt) && (
          <div className="bg-white/5 border-b border-white/10 px-6 py-3 shrink-0 relative shadow-md shadow-black/20 z-10">
            <div 
              className={`text-slate-200 text-sm leading-relaxed transition-all duration-300 whitespace-pre-wrap ${showFullPrompt ? '' : 'line-clamp-2 pr-8'}`}
            >
              {item.inputs && visibleInputs.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {visibleInputs.map(([key, value]) => (
                    <div key={key} className="flex flex-col sm:flex-row gap-1 sm:gap-3">
                      <span className="font-semibold text-slate-100 select-none uppercase text-xs tracking-wider bg-white/10 px-1.5 py-0.5 rounded shrink-0 self-start mt-0.5">{key}</span>
                      <span className="text-slate-200">
                        {typeof value === 'string' && value.match(/^https?:\/\//) ? (
                          <a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline break-all">
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
                  <span className="font-semibold text-slate-100 mr-2 select-none uppercase text-xs tracking-wider bg-white/10 px-1.5 py-0.5 rounded">输入</span>
                  {item.prompt}
                </>
              ) : null}
            </div>
            {((item.prompt && item.prompt.length > 150) || (visibleInputs.length > 1) || (visibleInputs.some(([, v]) => String(v).length > 150))) && (
              <button 
                onClick={() => setShowFullPrompt(!showFullPrompt)}
                className="absolute right-4 top-3 text-slate-200 hover:text-amber-400 p-1 bg-white/5 rounded-full shadow-md shadow-black/20 border border-white/10"
              >
                {showFullPrompt ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-h-[560px] h-full p-4 md:p-6 flex gap-4 md:gap-6">
          
          {/* Left Side (A or B if swapped) */}
          <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-white/5 rounded-2xl shadow-md shadow-black/20 border border-white/10 overflow-hidden group/card hover:border-blue-400/50 transition-colors">
            <div className="flex-1 relative min-h-0 overflow-hidden p-1 bg-black/40">
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
              disabled={!allMediaLoaded}
              className={`shrink-0 p-4 font-bold flex items-center justify-center gap-2 transition-all border-t border-white/10 ${
                allMediaLoaded 
                  ? 'bg-white/5 hover:bg-blue-500/10 text-slate-200 hover:text-blue-400 cursor-pointer' 
                  : 'bg-white/5 text-slate-200 cursor-not-allowed'
              }`}
            >
              <ThumbsUp className="w-5 h-5" />
              {allMediaLoaded ? '投给选项 1 (左侧)' : '加载中...'}
            </button>
          </div>

          {/* Center Control Column */}
          <div className="flex flex-col items-center justify-center gap-4 w-16 shrink-0">
            
            {/* Blind Test Indicator (Subtle) */}
            <div className="mb-2" title="盲测开启：位置已随机打乱">
              <Shuffle size={14} className="text-slate-200" />
            </div>

            {/* Reference Image Button */}
            {(hasReferences || effectiveStartImageUrl) && (
              <div className="flex flex-col gap-4">
                {effectiveStartImageUrl && (
                  <div className="relative group">
                    <button 
                      onClick={() => {
                        setShowReference(true);
                        setCurrentRefIndex(-1); // Use -1 to indicate start image
                      }}
                      className="w-16 h-16 rounded-xl border-2 border-blue-400/50 bg-white/5 shadow-md shadow-black/20 overflow-hidden hover:border-blue-400 transition-all flex items-center justify-center relative"
                    >
                      <img src={effectiveStartImageUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Expand size={16} className="text-white" />
                      </div>
                    </button>
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-medium text-slate-200 whitespace-nowrap">
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
                      className="w-16 h-16 rounded-xl border-2 border-white/10 bg-white/5 shadow-md shadow-black/20 overflow-hidden hover:border-blue-400 transition-all flex items-center justify-center relative"
                    >
                      <img src={effectiveReferenceUrls![0] || undefined} className="w-full h-full object-cover opacity-80 group-hover:opacity-100" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Expand size={16} className="text-white" />
                      </div>
                    </button>
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-medium text-slate-200 whitespace-nowrap">
                      {effectiveReferenceUrls!.length > 1 ? `${effectiveReferenceUrls!.length} 张参考图` : '参考图'}
                    </div>
                    {effectiveReferenceUrls!.length > 1 && (
                      <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full border border-white">
                        {effectiveReferenceUrls!.length}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {(hasReferences || item.startImageUrl) && <div className="h-8 w-px bg-white/10 rounded-full my-1"></div>}

            {/* Tie Button */}
            <button
              onClick={() => onVote('Tie')}
              disabled={!allMediaLoaded}
              className={`w-12 h-12 rounded-full border-2 transition-all shadow-md shadow-black/20 flex items-center justify-center ${
                allMediaLoaded
                  ? 'bg-white/5 border-white/10 hover:border-slate-400 glass-panel-hover text-slate-200 hover:text-slate-200 cursor-pointer'
                  : 'bg-white/5 border-white/10 text-slate-200 cursor-not-allowed'
              }`}
              title="平局"
            >
              <Equal size={20} />
            </button>
            <span className="text-[10px] font-medium text-slate-200">平局</span>

            <div className="h-8 w-px bg-white/10 rounded-full my-1"></div>

          </div>

          {/* Right Side (B or A if swapped) */}
           <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-white/5 rounded-2xl shadow-md shadow-black/20 border border-white/10 overflow-hidden group/card hover:border-amber-500/50 transition-colors">
            <div className="flex-1 relative min-h-0 overflow-hidden p-1 bg-black/40">
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
              disabled={!allMediaLoaded}
              className={`shrink-0 p-4 font-bold flex items-center justify-center gap-2 transition-all border-t border-white/10 ${
                allMediaLoaded
                  ? 'bg-white/5 hover:bg-amber-500/10 text-slate-200 hover:text-amber-300 cursor-pointer'
                  : 'bg-white/5 text-slate-200 cursor-not-allowed'
              }`}
            >
              <ThumbsUp className="w-5 h-5" />
              {allMediaLoaded ? '投给选项 2 (右侧)' : '加载中...'}
            </button>
          </div>

          </div>
        </div>
      </div>

      {/* Reference Gallery Modal */}
      {showReference && (hasReferences || effectiveStartImageUrl) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowReference(false)}>
           
           <div className="relative w-full max-w-5xl h-full flex flex-col items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
             
             {/* Main Image */}
             <div className="relative w-full h-[80vh] min-h-0 mb-4">
                <MediaRenderer 
                  url={currentRefIndex === -1 ? effectiveStartImageUrl! : effectiveReferenceUrls![currentRefIndex]} 
                  isActive={true}
                  className="bg-transparent border-none shadow-none"
                />
             </div>

             {/* Controls / Info */}
             <div className="flex items-center gap-4 bg-black/50 backdrop-blur-md px-6 py-3 rounded-full border border-white/10">
               {currentRefIndex === -1 ? (
                 <span className="text-white text-sm font-medium">首帧图</span>
               ) : (
                 <>
                   {effectiveReferenceUrls && effectiveReferenceUrls.length > 1 && (
                      <>
                        <button 
                          onClick={() => setCurrentRefIndex(prev => (prev === 0 ? effectiveReferenceUrls.length - 1 : prev - 1))}
                          className="p-2 glass-panel-hover rounded-full text-white transition-colors"
                        >
                          <ArrowLeft size={20} />
                        </button>
                        <span className="text-white font-mono text-sm mx-2">
                          {currentRefIndex + 1} / {effectiveReferenceUrls.length}
                        </span>
                        <button 
                          onClick={() => setCurrentRefIndex(prev => (prev === effectiveReferenceUrls.length - 1 ? 0 : prev + 1))}
                          className="p-2 glass-panel-hover rounded-full text-white transition-colors"
                        >
                          <ArrowRight size={20} />
                        </button>
                      </>
                   )}
                   {effectiveReferenceUrls && effectiveReferenceUrls.length === 1 && <span className="text-white text-sm font-medium">参考图像</span>}
                 </>
               )}
             </div>

             {/* Close Button */}
             <button 
               onClick={() => setShowReference(false)}
               className="absolute top-6 right-6 text-white/50 hover:text-white p-2 rounded-full glass-panel-hover transition-colors"
             >
               <span className="text-sm font-medium mr-2">关闭</span>
               <kbd className="bg-white/10 px-1.5 rounded text-xs">Esc</kbd>
             </button>

           </div>
        </div>
      )}
    </div>
  );
};

export default VotingScreen;
