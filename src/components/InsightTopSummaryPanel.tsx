import React, { useEffect, useState } from 'react';
import { BarChart3, ChevronRight, Info, X } from 'lucide-react';
import type {
  InsightDistributionSegment,
  InsightTopMetric,
  InsightTopSummary,
} from '../insightPresentation';

interface InsightTopSummaryPanelProps {
  summary: InsightTopSummary;
  eyebrow: string;
}

const segmentClass: Record<InsightDistributionSegment['color'], string> = {
  'model-a': 'bg-sky-400',
  'model-b': 'bg-violet-400',
  tie: 'bg-slate-500',
  accent: 'bg-amber-400',
  success: 'bg-emerald-400',
  neutral: 'bg-slate-500',
};

const metricToneClass: Record<NonNullable<InsightTopMetric['tone']>, string> = {
  neutral: 'border-t-slate-500',
  accent: 'border-t-amber-400',
  success: 'border-t-emerald-400',
  warning: 'border-t-orange-400',
};

const InsightDistribution: React.FC<{ summary: InsightTopSummary }> = ({ summary }) => {
  const distribution = summary.distribution;
  if (!distribution || distribution.segments.length === 0) return null;
  const total = distribution.segments.reduce((sum, segment) => sum + segment.value, 0);
  const max = Math.max(0, ...distribution.segments.map(segment => segment.value));

  if (distribution.style === 'bars') {
    return (
      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{distribution.label}</div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {distribution.segments.map(segment => (
            <div key={segment.id} className="border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-slate-300" title={segment.label}>{segment.label}</span>
                <span className="shrink-0 font-mono font-semibold text-white">{segment.displayValue}</span>
              </div>
              <div className="mt-2 h-1.5 bg-white/[0.06]">
                <div className={segmentClass[segment.color]} style={{ width: `${max ? (segment.value / max) * 100 : 0}%`, height: '100%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-white/10 pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{distribution.label}</span>
        <span className="text-xs text-slate-500">共 {total} 票</span>
      </div>
      <div className="flex h-3 overflow-hidden bg-white/[0.06]" aria-label={distribution.label}>
        {distribution.segments.filter(segment => segment.value > 0).map(segment => (
          <div
            key={segment.id}
            className={segmentClass[segment.color]}
            style={{ width: `${total ? (segment.value / total) * 100 : 0}%` }}
            title={`${segment.label}: ${segment.displayValue}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
        {distribution.segments.map(segment => (
          <span key={segment.id} className="inline-flex items-center gap-2">
            <span className={`h-2 w-2 ${segmentClass[segment.color]}`} />
            <span>{segment.label}</span>
            <strong className="font-mono font-semibold text-slate-200">{segment.displayValue}</strong>
          </span>
        ))}
      </div>
    </div>
  );
};

const MetricDetailDrawer: React.FC<{
  metric: InsightTopMetric;
  onClose: () => void;
}> = ({ metric, onClose }) => (
  <div className="fixed inset-0 z-[120] flex justify-end bg-black/65" onMouseDown={onClose}>
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby={`metric-detail-${metric.id}`}
      className="h-full w-full max-w-md overflow-y-auto border-l border-white/15 bg-[#0c0f13] shadow-2xl shadow-black"
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/10 bg-[#0c0f13] px-5 py-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-400">指标计算与审核</div>
          <h2 id={`metric-detail-${metric.id}`} className="mt-1 text-xl font-bold text-white">{metric.label}</h2>
          <div className="mt-1 font-mono text-sm text-slate-300">{metric.value}</div>
        </div>
        <button type="button" onClick={onClose} className="icon-btn" aria-label="关闭指标详情" title="关闭">
          <X size={18} />
        </button>
      </div>

      <div className="space-y-6 p-5 text-sm">
        <section>
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">这个指标表示什么</h3>
          <p className="mt-2 leading-6 text-slate-200">{metric.detail.meaning}</p>
        </section>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">计算方法</h3>
          <p className="mt-2 border-l-2 border-amber-400 bg-white/[0.035] px-3 py-3 leading-6 text-slate-200">{metric.detail.calculation}</p>
        </section>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">本次代入数据</h3>
          <dl className="mt-2 divide-y divide-white/10 border border-white/10 bg-black/20">
            {metric.detail.inputs.map((input, index) => (
              <div key={`${input.label}-${index}`} className="flex items-start justify-between gap-4 px-3 py-3">
                <dt className="text-slate-400">{input.label}</dt>
                <dd className="text-right font-mono font-semibold text-slate-100">{input.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {metric.detail.limitation && (
          <section className="border border-amber-400/20 bg-amber-400/[0.055] p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300"><Info size={14} /> 解读限制</div>
            <p className="mt-2 leading-6 text-amber-100/80">{metric.detail.limitation}</p>
          </section>
        )}
      </div>
    </aside>
  </div>
);

const InsightTopSummaryPanel: React.FC<InsightTopSummaryPanelProps> = ({ summary, eyebrow }) => {
  const [selectedMetric, setSelectedMetric] = useState<InsightTopMetric | null>(null);

  useEffect(() => {
    if (!selectedMetric) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedMetric(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMetric]);

  return (
    <>
      <section className="border border-white/12 bg-[#0d1116] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
        <div className="border-l-4 border-amber-400 px-5 py-5 lg:px-7 lg:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <BarChart3 size={14} className="text-amber-400" /> {eyebrow}
              </div>
              <h2 className="mt-3 text-2xl font-black text-white lg:text-3xl">{summary.headline}</h2>
              <p className="mt-2 text-base font-semibold text-slate-200">{summary.basis}</p>
              <p className="mt-1 text-sm leading-6 text-slate-400">{summary.supporting}</p>
            </div>
            <span className={`border px-3 py-1.5 text-xs font-semibold ${summary.tone === 'success' ? 'border-emerald-400/30 text-emerald-300' : summary.tone === 'warning' ? 'border-orange-400/30 text-orange-300' : 'border-slate-500/40 text-slate-300'}`}>
              {summary.tone === 'success' ? '证据较明确' : summary.tone === 'warning' ? '需要谨慎解读' : '结果持续更新'}
            </span>
          </div>
          <InsightDistribution summary={summary} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summary.metrics.map(item => (
          <button
            key={item.id}
            type="button"
            aria-haspopup="dialog"
            onClick={() => setSelectedMetric(item)}
            className={`group border border-white/10 border-t-2 bg-[#12171d] p-4 text-left transition-colors hover:border-white/25 hover:bg-[#171d24] ${metricToneClass[item.tone || 'neutral']}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs font-semibold text-slate-400">{item.label}</span>
              <ChevronRight size={15} className="text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-300" />
            </div>
            <div className="mt-3 text-2xl font-bold text-white">{item.value}</div>
            <div className="mt-1 min-h-5 text-xs leading-5 text-slate-400">{item.secondary}</div>
            <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-600 group-hover:text-slate-400">查看计算与数据</div>
          </button>
        ))}
      </div>

      {selectedMetric && <MetricDetailDrawer metric={selectedMetric} onClose={() => setSelectedMetric(null)} />}
    </>
  );
};

export default InsightTopSummaryPanel;
