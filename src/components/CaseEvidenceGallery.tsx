import React from 'react';
import { ExternalLink, FileSearch, MessageSquareText } from 'lucide-react';
import type { CaseEvidenceOutput, CaseEvidenceViewModel } from '../caseEvidence';
import { getDimensionEntries } from '../dimensionUtils';
import DeferredMediaRenderer from './DeferredMediaRenderer';

const formatReviewTime = (timestamp?: number) => {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
};

const EvidenceOutput: React.FC<{
  output: CaseEvidenceOutput;
  caseItem: CaseEvidenceViewModel;
}> = ({ output, caseItem }) => (
  <div className="min-w-0 overflow-hidden border border-white/10 bg-[#0b0f13]">
    <div className="flex min-h-11 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {output.rankLabel && (
          <span className="shrink-0 border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-200">
            {output.rankLabel}
          </span>
        )}
        <span className="truncate text-sm font-semibold text-slate-100" title={output.modelName}>{output.modelName}</span>
        {output.metricLabel && <span className="hidden truncate text-[11px] text-slate-500 sm:inline">{output.metricLabel}</span>}
      </div>
      {output.url && (
        <a href={output.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-slate-400 hover:text-white" title="打开产物链接" aria-label={`打开 ${output.modelName} 产物链接`}>
          <ExternalLink size={15} />
        </a>
      )}
    </div>
    <div className="h-[clamp(220px,28vw,460px)] w-full bg-black/45">
      {!output.url ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-500">暂无可预览产物</div>
      ) : caseItem.mediaType === 'text' || caseItem.mediaType === 'markdown' ? (
        <div className="h-full overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-slate-300">{output.url || '暂无文本产物'}</div>
      ) : (
        <DeferredMediaRenderer
          url={output.url}
          isActive={false}
          forceType={caseItem.mediaType === 'video' || caseItem.mediaType === 'image' || caseItem.mediaType === 'audio' ? caseItem.mediaType : undefined}
          videoPreload="metadata"
          className="rounded-none border-0 shadow-none"
        />
      )}
    </div>
  </div>
);

const RawReviewRecords: React.FC<{ item: CaseEvidenceViewModel }> = ({ item }) => (
  <details className="mt-4 border border-white/10 bg-black/20">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-200 marker:hidden">
      <span className="inline-flex items-center gap-2"><MessageSquareText size={15} /> 原始人工评审记录</span>
      <span className="font-mono text-xs text-slate-500">{item.reviews.length} 条</span>
    </summary>
    <div className="border-t border-white/10 p-3">
      {item.reviews.length ? (
        <div className="divide-y divide-white/10">
          {item.reviews.map(review => (
            <div key={review.id} className="grid gap-2 py-3 text-xs md:grid-cols-[minmax(120px,180px)_minmax(0,1fr)]">
              <div>
                <div className="font-semibold text-slate-200">{review.reviewer}</div>
                {review.timestamp && <div className="mt-1 text-slate-600">{formatReviewTime(review.timestamp)}</div>}
              </div>
              <div className="min-w-0">
                <div className="whitespace-pre-wrap break-words text-slate-300">{review.summary}</div>
                {review.details.length > 0 && (
                  <div className="mt-2 space-y-1 border-l border-white/10 pl-3 text-slate-500">
                    {review.details.map((detail, index) => <div key={`${review.id}-detail-${index}`} className="whitespace-pre-wrap break-words">{detail}</div>)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-4 text-center text-xs text-slate-500">当前导入数据未包含逐评委原始记录。</div>
      )}
    </div>
  </details>
);

export interface CaseEvidenceGalleryProps {
  cases: CaseEvidenceViewModel[];
  filterLabel?: string;
  sectionRef?: React.Ref<HTMLElement>;
}

const CaseEvidenceGallery: React.FC<CaseEvidenceGalleryProps> = ({
  cases,
  filterLabel = '全部 case',
  sectionRef,
}) => (
  <section ref={sectionRef} className="scroll-mt-24 border border-white/10 bg-[#101419]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 lg:px-5">
      <div>
        <div className="mb-1 flex items-center gap-2 text-slate-100">
          <FileSearch size={17} className="text-amber-300" />
          <h2 className="text-base font-bold">逐 case 结果与证据</h2>
        </div>
        <p className="text-xs text-slate-500">{filterLabel} · 当前显示 {cases.length} 个 case；核心结论和产物直接展示，逐评委记录可在 case 内展开。</p>
      </div>
    </div>
    <div className="space-y-5 p-4 lg:p-5">
      {cases.length ? cases.map(item => (
        <article
          key={item.itemId}
          className="border border-white/10 bg-[#0d1116] p-4 lg:p-5"
          style={{ contentVisibility: 'auto', containIntrinsicSize: '820px' }}
          data-case-evidence-id={item.itemId}
        >
          <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-bold text-amber-300">{item.originalItemId}</div>
              <div className="mt-2 max-w-5xl whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{item.prompt || '-'}</div>
              {getDimensionEntries(item.dimensionValues).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {getDimensionEntries(item.dimensionValues).map(([key, value]) => (
                    <span key={`${item.itemId}-${key}-${value}`} className="border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">{key}: {value}</span>
                  ))}
                </div>
              )}
              {item.referenceUrls.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {item.referenceUrls.map((url, index) => (
                    <a key={`${item.itemId}-reference-${index}`} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200">
                      <ExternalLink size={12} /> 参考素材 {index + 1}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="min-w-[260px] border border-white/10 bg-black/25 p-3 xl:max-w-[420px]">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">本 case 结论</div>
              <div className="mt-1 break-words text-base font-bold text-slate-100">{item.outcomeLabel}</div>
              <div className="mt-1 break-words text-xs text-slate-400">{item.outcomeDetail}</div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
                {item.metrics.map(metric => (
                  <div key={`${item.itemId}-${metric.label}`} className="min-w-0">
                    <div className="truncate text-[10px] text-slate-600" title={metric.label}>{metric.label}</div>
                    <div className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-200" title={metric.value}>{metric.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {item.outputs.length ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
              {item.outputs.map(output => (
                <EvidenceOutput key={`${item.itemId}-${output.modelId}-${output.modelName}`} output={output} caseItem={item} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-28 items-center justify-center border border-white/10 bg-black/25 text-xs text-slate-500">暂无可预览产物链接</div>
          )}

          <RawReviewRecords item={item} />
        </article>
      )) : (
        <div className="flex min-h-40 items-center justify-center border border-dashed border-white/10 text-sm text-slate-500">当前筛选下没有 case。</div>
      )}
    </div>
  </section>
);

export default CaseEvidenceGallery;
