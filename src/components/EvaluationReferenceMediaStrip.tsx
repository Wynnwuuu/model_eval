import React, { useEffect, useMemo, useState } from 'react';

import {
  resolveEvaluationReferenceMedia,
  type EvaluationReferenceMedia,
} from '../evaluationReferenceMedia';
import type { EvaluationItem } from '../types';
import EvaluationMediaViewer, {
  EvaluationMediaExpandButton,
  type EvaluationMediaViewerItem,
} from './EvaluationMediaViewer';
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

  useEffect(() => {
    setViewerIndex(null);
  }, [item.id]);

  useEffect(() => {
    onViewerOpenChange?.(viewerOpen);
  }, [onViewerOpenChange, viewerOpen]);

  if (media.length === 0) return null;

  const viewerItems: EvaluationMediaViewerItem[] = visualMedia.map((entry, index) => ({
    id: entry.id,
    url: entry.url,
    type: entry.type as 'image' | 'video',
    label: `参考素材 ${index + 1}`,
  }));

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
          suspendPlayback={viewerOpen}
          className={`${entry.type === 'image' ? 'pointer-events-none' : ''} rounded-none border-0 shadow-none`}
        />
        <EvaluationMediaExpandButton
          label={accessibleLabel}
          onClick={() => setViewerIndex(visualIndex)}
        />
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

      <EvaluationMediaViewer
        items={viewerItems}
        activeIndex={viewerIndex}
        onIndexChange={setViewerIndex}
        onClose={() => setViewerIndex(null)}
        ariaLabel="参考素材全屏预览"
      />
    </>
  );
};

export default EvaluationReferenceMediaStrip;
