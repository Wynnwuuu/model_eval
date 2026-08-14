import React, { useState } from 'react';
import { ArrowLeft, Calendar, Download, Trash2, User } from 'lucide-react';
import type { HistorySession, HistorySessionSummary } from '../types';
import { buildHistoryCsv } from '../historyCsv';

interface HistoryScreenProps {
  history: HistorySessionSummary[];
  onBack: () => void;
  onClearHistory: () => void;
  onDeleteSession: (id: string) => void;
  onLoadSession: (id: string) => Promise<HistorySession | undefined>;
  onGoToDashboard?: () => void;
}

const downloadHistoryCsv = (session: HistorySession) => {
  const result = buildHistoryCsv(session);
  const blob = new Blob([result.content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const HistoryScreen: React.FC<HistoryScreenProps> = ({
  history,
  onBack,
  onClearHistory,
  onDeleteSession,
  onLoadSession,
  onGoToDashboard,
}) => {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    setDownloadError(null);
    try {
      const session = await onLoadSession(id);
      if (!session) throw new Error('未找到这条历史记录的完整详情。');
      downloadHistoryCsv(session);
    } catch (error: any) {
      setDownloadError(error?.message || '历史详情读取失败，请重试。');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 animate-in fade-in duration-500">
      <div className="relative mb-8 flex items-center justify-between gap-6">
        {onGoToDashboard && (
          <button type="button" onClick={onGoToDashboard} className="btn-secondary">
            <ArrowLeft size={16} /> 返回总览
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-slate-100">评测历史</h1>
          <p className="mt-1 text-slate-400">历史列表仅加载摘要，下载时再读取完整记录。</p>
        </div>
        <div className="flex gap-3">
          {history.length > 0 && (
            <button type="button" onClick={onClearHistory} className="btn-secondary border-red-500/35 text-red-200 hover:bg-red-500/10">
              <Trash2 size={16} /> 清除全部
            </button>
          )}
          <button type="button" onClick={onBack} className="btn-secondary">返回发起任务</button>
        </div>
      </div>

      {downloadError && (
        <div className="mb-4 border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {downloadError}
        </div>
      )}

      {history.length === 0 ? (
        <div className="glass-panel border-2 border-dashed border-white/20 p-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400">
            <Calendar size={32} />
          </div>
          <h3 className="text-xl font-semibold text-slate-200">暂无历史记录</h3>
          <p className="mt-2 text-slate-400">已完成并成功写入本地历史的评测会显示在这里。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...history].sort((left, right) => right.timestamp - left.timestamp).map(session => {
            const isRank = session.paradigm === 'Arena-rank';
            const stats = session.stats;
            const aPercent = stats.total ? Math.round((stats.aCount / stats.total) * 100) : 0;
            const bPercent = stats.total ? Math.round((stats.bCount / stats.total) * 100) : 0;
            const tiePercent = stats.total ? Math.max(0, 100 - aPercent - bPercent) : 0;
            return (
              <article key={session.id} className="glass-panel p-6">
                <div className="flex flex-col gap-6 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                      <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(session.timestamp).toLocaleString()}</span>
                      <span className="flex items-center gap-1"><User size={14} /> {session.userName}</span>
                    </div>
                    <div className="text-lg font-bold text-slate-200">
                      {isRank
                        ? `Arena-rank · 领先：${session.rankSummary?.leadingModelNames.join(' = ') || '-'}`
                        : `${session.modelNames.a} vs ${session.modelNames.b}`}
                    </div>
                    <div className="mt-1 text-sm text-slate-400">
                      {session.itemCount} 个 case，{session.voteCount} 条记录
                      {session.skippedCount > 0 ? `，跳过 ${session.skippedCount} 条` : ''}
                    </div>
                  </div>

                  <div className="min-w-[220px] flex-1">
                    {isRank ? (
                      <>
                        <div className="mb-1 flex justify-between text-xs text-slate-400">
                          <span>领先模型归一化 Borda</span>
                          <span>{((session.rankSummary?.normalizedScore || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-4 overflow-hidden bg-white/10">
                          <div className="h-full bg-amber-400" style={{ width: `${(session.rankSummary?.normalizedScore || 0) * 100}%` }} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">含并列票 {Math.round((session.rankSummary?.tieRate || 0) * 100)}%</div>
                      </>
                    ) : (
                      <>
                        <div className="mb-1 text-xs text-slate-400">胜率分布</div>
                        <div className="flex h-4 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full bg-blue-500" style={{ width: `${aPercent}%` }} />
                          <div className="h-full bg-slate-400" style={{ width: `${tiePercent}%` }} />
                          <div className="h-full bg-indigo-500" style={{ width: `${bPercent}%` }} />
                        </div>
                        <div className="mt-1 flex justify-between text-xs text-slate-500">
                          <span>A {aPercent}%</span><span>平局 {tiePercent}%</span><span>B {bPercent}%</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex gap-2 border-t border-white/10 pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                    <button
                      type="button"
                      onClick={() => void handleDownload(session.id)}
                      disabled={downloadingId === session.id}
                      className="btn-secondary"
                    >
                      <Download size={16} /> {downloadingId === session.id ? '读取中' : 'CSV'}
                    </button>
                    <button type="button" onClick={() => onDeleteSession(session.id)} className="flex h-10 w-10 items-center justify-center border border-white/10 text-slate-400 hover:border-red-500/35 hover:text-red-400" title="删除记录">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HistoryScreen;
