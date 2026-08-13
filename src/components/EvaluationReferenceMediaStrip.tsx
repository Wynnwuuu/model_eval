import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Expand, X } from 'lucide-react';

import {
  resolveEvaluationReferenceMedia,
  type EvaluationReferenceMedia,
} from '../evaluationReferenceMedia';
import type { EvaluationItem } from '../types';
import MediaRenderer from './MediaRenderer';

interface EvaluationReferenceMediaStripProps {
  item: EvaluationItem;
  className?: string;
  onViewerOpenChange?: (open: boolean) => void;
}

const MEDIA_TYPE_LABELS: Record<EvaluationReferenceMedia['type'], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

const EvaluationReferenceMediaStrip: React.FC<EvaluationReferenceMediaStripProps> = ({
  item,
  className = '',
  onViewerOpenChange,
}) => {
  const media = useMemo(() => resolveEvaluationReferenceMedia(item), [item]);
  const visualMedia = useMemo(
    () => media.filter(entry => entry.type !== 'audio'),
    [media],
  );
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerOpen = viewerIndex !== null;
  const activeMedia = viewerIndex === null ? undefined : visualMedia[viewerIndex];

  useEffect(() => {
    setViewerIndex(null);
  }, [item.id]);

  useEffect(() => {
    onViewerOpenChange?.(viewerOpen);
  }, [onViewerOpenChange, viewerOpen]);

  useEffect(() => {
    if (!viewerOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (event.key === 'Escape') {
        setViewerIndex(null);
      } else if (visualMedia.length > 1) {
        setViewerIndex(current => {
          const index = current ?? 0;
          return event.key === 'ArrowLeft'
            ? (index === 0 ? visualMedia.length - 1 : index - 1)
            : (index === visualMedia.length - 1 ? 0 : index + 1);
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [viewerOpen, visualMedia.length]);

  if (media.length === 0) return null;

  const moveViewer = (direction: -1 | 1) => {
    if (visualMedia.length <= 1) return;
    setViewerIndex(current => {
      const index = current ?? 0;
      const next = index + direction;
      if (next < 0) return visualMedia.length - 1;
      if (next >= visualMedia.length) return 0;
      return next;
    });
  };

  const renderMediaTile = (entry: EvaluationReferenceMedia, index: number) => {
    const accessibleLabel = `参考素材 ${index + 1}，${MEDIA_TYPE_LABELS[entry.type]}`;

    if (entry.type === 'audio') {
      return (
        <div
          key={entry.id}
          role="group"
          aria-label={accessibleLabel}
          title={accessibleLabel}
          className="h-28 w-full max-w-full shrink-0 overflow-hidden border border-white/15 bg-black/45 sm:w-80"
          data-reference-media-type="audio"
        >
          <MediaRenderer
            url={entry.url}
            isActive={false}
            forceType="audio"
            videoPreload="metadata"
            compact
            className="rounded-none border-0 shadow-none"
          />
        </div>
      );
    }

    const visualIndex = visualMedia.findIndex(candidate => candidate.id === entry.id);

    return (
      <div
        key={entry.id}
        role="group"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        className="relative h-28 w-40 max-w-full shrink-0 overflow-hidden border border-white/15 bg-black/45 sm:h-32 sm:w-48"
        data-reference-media-type={entry.type}
      >
        <MediaRenderer
          url={entry.url}
          isActive={false}
          forceType={entry.type}
          videoPreload="metadata"
          compact
          className={`${entry.type === 'image' ? 'pointer-events-none' : ''} rounded-none border-0 shadow-none`}
        />
        {entry.type === 'image' ? (
          <button
            type="button"
            onClick={() => setViewerIndex(visualIndex)}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/0 text-white opacity-0 transition-colors hover:bg-black/25 hover:opacity-100 focus-visible:bg-black/25 focus-visible:opacity-100"
            aria-label={`全屏查看${accessibleLabel}`}
          >
            <Expand size={18} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setViewerIndex(visualIndex)}
            className="absolute right-2 top-2 z-30 flex h-8 w-8 items-center justify-center border border-white/20 bg-black/70 text-white transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            aria-label={`全屏查看${accessibleLabel}`}
            title={`全屏查看${accessibleLabel}`}
          >
            <Expand size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <section
        className={`border-b border-white/10 bg-black/20 px-4 py-3 md:px-6 ${className}`}
        aria-label="参考素材"
        data-testid="evaluation-reference-media-strip"
      >
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-200">参考素材</h3>
          <span className="font-mono text-[11px] text-slate-500">{media.length}</span>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          {media.map(renderMediaTile)}
        </div>
      </section>

      {viewerOpen && activeMedia && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95"
          role="dialog"
          aria-modal="true"
          aria-label="参考素材全屏预览"
          onMouseDown={() => setViewerIndex(null)}
        >
          <div
            className="relative flex h-full w-full max-w-6xl flex-col items-center justify-center p-4 md:p-8"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="relative min-h-0 w-full flex-1">
              <MediaRenderer
                key={`${activeMedia.id}-${activeMedia.url}`}
                url={activeMedia.url}
                isActive={true}
                forceType={activeMedia.type}
                className="rounded-none border-0 bg-transparent shadow-none"
              />
            </div>

            <div className="mt-4 flex shrink-0 items-center gap-3 border border-white/15 bg-black/80 px-3 py-2">
              {visualMedia.length > 1 && (
                <button
                  type="button"
                  onClick={() => moveViewer(-1)}
                  className="flex h-9 w-9 items-center justify-center border border-white/10 text-slate-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  aria-label="上一项参考素材"
                >
                  <ArrowLeft size={18} aria-hidden="true" />
                </button>
              )}
              <span className="min-w-16 text-center font-mono text-sm text-white">
                {(viewerIndex ?? 0) + 1} / {visualMedia.length}
              </span>
              {visualMedia.length > 1 && (
                <button
                  type="button"
                  onClick={() => moveViewer(1)}
                  className="flex h-9 w-9 items-center justify-center border border-white/10 text-slate-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  aria-label="下一项参考素材"
                >
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setViewerIndex(null)}
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center border border-white/15 bg-black/80 text-slate-200 hover:border-[var(--accent)] hover:text-[var(--accent)] md:right-8 md:top-8"
              aria-label="关闭参考素材全屏预览"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default EvaluationReferenceMediaStrip;
