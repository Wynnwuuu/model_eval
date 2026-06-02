import React from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import MediaRenderer from './MediaRenderer';
import { inferPreviewMediaType, looksLikeUrl, PreviewMediaType } from '../mediaTypeUtils';
import { resolvePlaybackUrl } from '../mediaUrlUtils';

interface BenchmarkOutputCellProps {
  label: string;
  value: unknown;
  preferredType?: PreviewMediaType;
  isActive?: boolean;
}

const stringifyValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const BenchmarkOutputCell: React.FC<BenchmarkOutputCellProps> = ({ label, value, preferredType, isActive = false }) => {
  const textValue = stringifyValue(value);
  const playbackUrl = resolvePlaybackUrl(textValue);
  const fallbackType: PreviewMediaType = preferredType || 'text';
  const mediaType = inferPreviewMediaType(textValue, fallbackType, label);
  const isMedia = mediaType === 'image' || mediaType === 'video' || mediaType === 'audio';

  return (
    <section className="flex min-h-[220px] flex-col overflow-hidden border border-white/10 bg-white/5">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-100" title={label}>{label}</h3>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-slate-500">{mediaType}</p>
        </div>
        {looksLikeUrl(textValue) && playbackUrl && (
          <a
            href={playbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            title="打开原始链接"
          >
            <ExternalLink size={15} />
          </a>
        )}
      </header>

      <div className="relative min-h-[180px] flex-1 bg-black/20">
        {isMedia ? (
          <MediaRenderer
            url={playbackUrl || textValue}
            label={label}
            isActive={isActive}
            forceType={mediaType}
            videoPreload="metadata"
            className="rounded-none border-0 shadow-none"
          />
        ) : (
          <div className="h-full min-h-[180px] overflow-auto p-4">
            {textValue ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-200">{textValue}</pre>
            ) : (
              <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-slate-500">
                <FileText size={24} />
                <span className="mt-2 text-sm">内容为空</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default BenchmarkOutputCell;
