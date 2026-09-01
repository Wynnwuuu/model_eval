import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Expand, X } from 'lucide-react';

import MediaRenderer from './MediaRenderer';

export interface EvaluationMediaViewerItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  label: string;
}

interface EvaluationMediaViewerProps {
  items: EvaluationMediaViewerItem[];
  activeIndex: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  ariaLabel?: string;
}

export const EvaluationMediaExpandButton: React.FC<{
  label: string;
  onClick: () => void;
}> = ({ label, onClick }) => (
  <button
    type="button"
    draggable={false}
    onMouseDown={event => {
      event.preventDefault();
      event.stopPropagation();
    }}
    onClick={event => {
      event.stopPropagation();
      onClick();
    }}
    className="absolute right-2 top-2 z-30 flex h-9 w-9 items-center justify-center border border-white/20 bg-black/75 text-white shadow-lg transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:border-[var(--accent)] focus-visible:text-[var(--accent)]"
    aria-label={`放大查看${label}`}
    title={`放大查看${label}`}
  >
    <Expand size={16} aria-hidden="true" />
  </button>
);

const EvaluationMediaViewer: React.FC<EvaluationMediaViewerProps> = ({
  items,
  activeIndex,
  onIndexChange,
  onClose,
  ariaLabel = '产物全屏预览',
}) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const activeIndexRef = useRef(activeIndex);
  const itemsLengthRef = useRef(items.length);
  const onCloseRef = useRef(onClose);
  const onIndexChangeRef = useRef(onIndexChange);
  activeIndexRef.current = activeIndex;
  itemsLengthRef.current = items.length;
  onCloseRef.current = onClose;
  onIndexChangeRef.current = onIndexChange;
  const activeItem = activeIndex === null ? undefined : items[activeIndex];
  const open = Boolean(activeItem);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      const currentIndex = activeIndexRef.current;
      const itemCount = itemsLengthRef.current;
      if (itemCount <= 1 || currentIndex === null) return;
      const offset = event.key === 'ArrowLeft' ? -1 : 1;
      onIndexChangeRef.current((currentIndex + offset + itemCount) % itemCount);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown, true);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  if (!open || activeIndex === null || !activeItem) return null;

  const move = (offset: -1 | 1) => {
    if (items.length <= 1) return;
    onIndexChange((activeIndex + offset + items.length) % items.length);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={() => onCloseRef.current()}
    >
      <div
        className="relative flex h-full w-full max-w-7xl flex-col items-center justify-center p-3 sm:p-5 md:p-8"
        onClick={event => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[calc(100%-8rem)] border border-white/15 bg-black/80 px-3 py-2 text-sm font-semibold text-white md:left-8 md:top-8">
          {activeItem.label}
        </div>

        <div className="relative min-h-0 w-full flex-1 pt-12 md:pt-10">
          <MediaRenderer
            key={`${activeItem.id}-${activeItem.url}`}
            url={activeItem.url}
            isActive
            forceType={activeItem.type}
            className="rounded-none border-0 bg-transparent shadow-none"
          />
        </div>

        {items.length > 1 && (
          <div className="mt-3 flex shrink-0 items-center gap-3 border border-white/15 bg-black/80 px-3 py-2">
            <button
              type="button"
              onClick={() => move(-1)}
              className="flex h-10 w-10 items-center justify-center border border-white/10 text-slate-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
              aria-label="上一项产物"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <span className="min-w-16 text-center font-mono text-sm text-white">
              {activeIndex + 1} / {items.length}
            </span>
            <button
              type="button"
              onClick={() => move(1)}
              className="flex h-10 w-10 items-center justify-center border border-white/10 text-slate-200 hover:border-[var(--accent)] hover:text-[var(--accent)]"
              aria-label="下一项产物"
            >
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        )}

        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center border border-white/15 bg-black/80 text-slate-200 hover:border-[var(--accent)] hover:text-[var(--accent)] md:right-8 md:top-8"
          aria-label={`关闭${ariaLabel}`}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default EvaluationMediaViewer;
