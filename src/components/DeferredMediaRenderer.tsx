import React, { useEffect, useId, useRef, useState } from 'react';
import { Image as ImageIcon, MousePointerClick } from 'lucide-react';
import { insightMediaLoadScheduler } from '../mediaLoadScheduler';
import MediaRenderer, { type MediaRendererProps } from './MediaRenderer';

export interface DeferredMediaRendererProps extends MediaRendererProps {
  rootMargin?: string;
  placeholderLabel?: string;
}

const INITIALIZATION_TIMEOUT_MS = 15_000;

const DeferredMediaRenderer: React.FC<DeferredMediaRendererProps> = ({
  rootMargin = '700px 0px',
  placeholderLabel = '滚动到附近后自动加载',
  onLoadStatusChange,
  onPlaybackStateChange,
  ...mediaProps
}) => {
  const reactId = useId();
  const schedulerId = `${reactId}:${mediaProps.url}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cancelScheduledRef = useRef<(() => void) | null>(null);
  const slotActiveRef = useRef(false);
  const watchdogRef = useRef<number | null>(null);
  const [observerAvailable, setObserverAvailable] = useState<boolean | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [manualLoad, setManualLoad] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);

  const releaseSlot = () => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (slotActiveRef.current) {
      insightMediaLoadScheduler.complete(schedulerId);
      slotActiveRef.current = false;
    }
    cancelScheduledRef.current = null;
  };

  useEffect(() => {
    setMounted(false);
    setManualLoad(false);
    setPlaying(false);
    releaseSlot();
    // schedulerId changes whenever the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedulerId]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setObserverAvailable(false);
      return;
    }

    setObserverAvailable(true);
    const observer = new IntersectionObserver(entries => {
      setNearViewport(entries.some(entry => entry.isIntersecting));
    }, { rootMargin, threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  const eligibleToLoad = observerAvailable === true ? nearViewport : manualLoad;

  useEffect(() => {
    if (!mediaProps.url) {
      setMounted(true);
      return;
    }

    if (!eligibleToLoad && !playing) {
      cancelScheduledRef.current?.();
      cancelScheduledRef.current = null;
      slotActiveRef.current = false;
      setMounted(false);
      return;
    }

    if (mounted || cancelScheduledRef.current) return;
    cancelScheduledRef.current = insightMediaLoadScheduler.enqueue(schedulerId, () => {
      slotActiveRef.current = true;
      setMounted(true);
      watchdogRef.current = window.setTimeout(releaseSlot, INITIALIZATION_TIMEOUT_MS);
    });
  }, [eligibleToLoad, mediaProps.url, mounted, playing, schedulerId]);

  useEffect(() => () => {
    cancelScheduledRef.current?.();
    cancelScheduledRef.current = null;
    if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
    if (slotActiveRef.current) insightMediaLoadScheduler.complete(schedulerId);
  }, [schedulerId]);

  const handleLoadStatusChange = (isLoaded: boolean) => {
    if (isLoaded) releaseSlot();
    onLoadStatusChange?.(isLoaded);
  };

  const handlePlaybackStateChange = (isPlaying: boolean) => {
    setPlaying(isPlaying);
    onPlaybackStateChange?.(isPlaying);
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-0"
      data-deferred-media-state={mounted ? (playing ? 'playing' : 'mounted') : eligibleToLoad ? 'queued' : 'deferred'}
    >
      {mounted ? (
        <MediaRenderer
          {...mediaProps}
          onLoadStatusChange={handleLoadStatusChange}
          onPlaybackStateChange={handlePlaybackStateChange}
        />
      ) : (
        <div className="flex h-full w-full min-h-[140px] flex-col items-center justify-center gap-2 border border-white/10 bg-black/35 px-4 text-center text-xs text-slate-500">
          {observerAvailable === false ? <MousePointerClick size={22} /> : <ImageIcon size={22} />}
          <span>{observerAvailable === false ? '点击加载媒体预览' : placeholderLabel}</span>
          {observerAvailable === false && (
            <button
              type="button"
              className="btn-secondary mt-1 px-3 py-1.5 text-xs"
              onClick={() => setManualLoad(true)}
            >
              加载预览
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DeferredMediaRenderer;
