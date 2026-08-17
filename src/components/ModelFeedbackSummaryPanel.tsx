import React, { useMemo } from 'react';
import { ChevronDown, MessageSquareText } from 'lucide-react';
import type { VoteRecord } from '../types';
import { buildModelFeedbackSummaries } from '../modelFeedback';

interface ModelFeedbackSummaryPanelProps {
  votes: VoteRecord[];
  models?: Array<{ id: string; name: string }>;
}

const formatTime = (timestamp?: number) => {
  if (!timestamp || !Number.isFinite(timestamp)) return '时间未知';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
};

const ModelFeedbackSummaryPanel: React.FC<ModelFeedbackSummaryPanelProps> = ({ votes, models = [] }) => {
  const summaries = useMemo(() => buildModelFeedbackSummaries({ votes, models }), [votes, models]);
  const feedbackCount = summaries.reduce((sum, summary) => sum + summary.feedbackCount, 0);

  return (
    <section className="border border-white/10 bg-[#101419]" data-model-feedback-summary>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-4 lg:px-5">
        <div>
          <div className="mb-1 flex items-center gap-2 text-slate-100">
            <MessageSquareText size={17} className="text-amber-300" />
            <h2 className="text-base font-bold">模型评价汇总</h2>
          </div>
          <p className="text-xs text-slate-500">按当前评测物料与评委范围汇总原始评价；不受下方 case 临时筛选影响。</p>
        </div>
        <span className="border border-white/10 bg-black/25 px-2.5 py-1 font-mono text-xs text-slate-400">{feedbackCount} 条备注</span>
      </div>

      {feedbackCount > 0 ? (
        <div className="grid gap-3 p-4 lg:grid-cols-2 lg:p-5">
          {summaries.map(summary => (
            <details key={summary.modelId} className="group min-w-0 border border-white/10 bg-[#0d1116]" open={summaries.length === 1 || undefined}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-slate-100" title={summary.modelName}>{summary.modelName}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>备注 {summary.feedbackCount}</span>
                    <span>覆盖 case {summary.caseCount}</span>
                    <span>评委 {summary.reviewerCount}</span>
                  </div>
                </div>
                <ChevronDown size={16} className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-white/10 p-3">
                {summary.entries.length ? (
                  <div className="divide-y divide-white/10">
                    {summary.entries.map((entry, index) => (
                      <article key={`${entry.itemId}-${entry.reviewerKey}-${entry.timestamp || index}-${index}`} className="py-3 first:pt-0 last:pb-0">
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{entry.reason}</p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-slate-600">
                          <span>case {entry.itemId}</span>
                          <span>{entry.reviewer}</span>
                          <span>{formatTime(entry.timestamp)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="py-3 text-center text-xs text-slate-500">当前范围内暂无该模型的评价备注。</div>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="px-4 py-10 text-center text-sm text-slate-500">当前评测范围内还没有模型评价备注。</div>
      )}
    </section>
  );
};

export default ModelFeedbackSummaryPanel;
