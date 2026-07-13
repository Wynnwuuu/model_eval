import React from 'react';
import { Download, Trash2, Calendar, User, ArrowLeft, BarChart3 } from 'lucide-react';
import { HistorySession, VotingStats } from '../types';
import { calculateArenaRankModelStats, formatRanking, getArenaRankModelOutputUrl, getRankingEntryMetrics, getRankingTieSummary, isArenaRankVote, resolveEvaluationItemPrompt, sortRanking } from '../rankingUtils';
import { getEffectiveVotes, getSkippedVoteCount, isSkippedVote } from '../voteUtils';

interface HistoryScreenProps {
  history: HistorySession[];
  onBack: () => void;
  onClearHistory: () => void;
  onDeleteSession: (id: string) => void;
  onGoToDashboard?: () => void;
}

const HistoryScreen: React.FC<HistoryScreenProps> = ({ history, onBack, onClearHistory, onDeleteSession, onGoToDashboard }) => {
  
  const calculateStats = (votes: any[]): VotingStats => {
    return getEffectiveVotes(votes).reduce(
      (acc, curr) => {
        acc.total++;
        if (curr.vote === 'A') acc.aCount++;
        else if (curr.vote === 'B') acc.bCount++;
        else acc.tieCount++;
        return acc;
      },
      { total: 0, aCount: 0, bCount: 0, tieCount: 0 }
    );
  };

  const downloadCSV = (session: HistorySession) => {
    if (session.paradigm === 'Arena-rank') {
      const rankVotes = getEffectiveVotes(session.votes).filter(isArenaRankVote);
      const modelList = session.models?.length
        ? session.models
        : calculateArenaRankModelStats(rankVotes).map(stat => ({ id: stat.modelId, name: stat.modelName }));
      const maxRankCount = Math.max(0, ...rankVotes.map(v => v.ranking?.length || 0));
      const rankHeaders = Array.from({ length: maxRankCount }, (_, idx) => `rank_${idx + 1}`);
      const rankVideoHeaders = Array.from({ length: maxRankCount }, (_, idx) => `排名${idx + 1}视频链接`);
      const modelHeaders = modelList.flatMap(model => [
        `${model.name}_rank`,
        `${model.name}_score`,
        `${model.name}_midrank`,
        `${model.name}_borda_score`,
        `${model.name}_normalized_borda`
      ]);
      const headers = ['ItemID', 'Prompt', 'Status', 'Timestamp', 'User', 'RankingDisplay', 'HasTie', 'AllTied', 'TieGroupCount', 'TopTieSize', ...rankHeaders, ...rankVideoHeaders, ...modelHeaders, 'ranking_json'];
      const rows = session.votes.filter(v => isArenaRankVote(v) || isSkippedVote(v)).map(v => {
        const item = session.items.find(candidate => candidate.id === v.itemId);
        const ranking = sortRanking(v.ranking);
        const tieSummary = getRankingTieSummary(ranking);
        const rankValues = rankHeaders.map((_, idx) => {
          const entry = ranking[idx];
          return entry ? `${entry.modelName} (${entry.modelId})` : '';
        });
        const rankVideoValues = rankHeaders.map((_, idx) => {
          const entry = ranking[idx];
          return entry ? getArenaRankModelOutputUrl(item, entry, modelList) : '';
        });
        const modelValues = modelList.flatMap(model => {
          const entry = ranking.find(candidate => candidate.modelId === model.id);
          const metrics = entry ? getRankingEntryMetrics(ranking, entry.modelId) : null;
          return metrics
            ? [String(entry!.rank), String(metrics.bordaScore), String(metrics.midRank), String(metrics.bordaScore), String(metrics.normalizedBorda)]
            : ['', '', '', '', ''];
        });
        return [
          v.itemId,
          resolveEvaluationItemPrompt(item),
          isSkippedVote(v) ? 'skipped' : 'ranked',
          new Date(v.timestamp).toISOString(),
          session.userName || 'Anonymous',
          formatRanking(ranking),
          tieSummary.hasTie ? 'true' : 'false',
          tieSummary.allTied ? 'true' : 'false',
          tieSummary.tieGroupCount,
          tieSummary.topTieSize,
          ...rankValues,
          ...rankVideoValues,
          ...modelValues,
          JSON.stringify(ranking)
        ].map(field => `"${String(field ?? '').replace(/"/g, '""')}"`).join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `arena_rank_results_${session.userName || 'anon'}_${new Date(session.timestamp).toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    const headers = ['ItemID', 'Status', 'ModelA_URL', 'ModelB_URL', 'Winner', 'Timestamp', 'User', 'ModelA_Name', 'ModelB_Name', 'References'];
    const rows = session.votes.map(v => {
      const item = session.items.find(i => i.id === v.itemId);
      return [
        v.itemId,
        isSkippedVote(v) ? 'skipped' : 'voted',
        item?.modelA_Url || '',
        item?.modelB_Url || '',
        isSkippedVote(v) ? '' : v.vote,
        new Date(v.timestamp).toISOString(),
        session.userName || 'Anonymous',
        session.modelNames.a,
        session.modelNames.b,
        item?.referenceUrls ? item.referenceUrls.join(' | ') : ''
      ].map(field => `"${field}"`).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `results_${session.userName || 'anon'}_${new Date(session.timestamp).toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-5xl mx-auto p-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8 relative">
        {onGoToDashboard && (
          <button 
            onClick={onGoToDashboard}
            className="absolute left-0 top-0 bg-white/5 glass-panel-hover text-slate-300 px-4 py-2 rounded-xl font-medium text-sm flex items-center gap-2 transition-colors border border-white/10"
          >
            <ArrowLeft size={16} /> 返回大盘
          </button>
        )}
        <div className={onGoToDashboard ? "ml-32" : ""}>
          <h1 className="text-3xl font-bold text-slate-100">评测历史</h1>
          <p className="text-slate-300">查看并下载您过去会话的结果。</p>
        </div>
        <div className="flex gap-4">
           {history.length > 0 && (
            <button 
              onClick={onClearHistory}
              className="text-red-500 hover:text-red-700 font-medium text-sm flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={16} /> 清除全部
            </button>
          )}
          <button 
            onClick={onBack}
            className="flex items-center gap-2 bg-black/40 hover:bg-white/5 text-white px-5 py-2.5 rounded-xl font-medium text-sm shadow-md transition-all transform hover:-translate-y-0.5"
          >
            返回发起任务
          </button>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="glass-panel border-2 border-dashed border-white/20 rounded-2xl p-16 text-center">
          <div className="w-16 h-16 bg-white/5 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/10">
            <Calendar size={32} />
          </div>
          <h3 className="text-xl font-semibold text-slate-200 mb-2">暂无历史记录</h3>
          <p className="text-slate-400">已完成的评测将自动显示在这里。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {history.sort((a, b) => b.timestamp - a.timestamp).map((session) => {
            const isRankSession = session.paradigm === 'Arena-rank';
            const effectiveRankVotes = getEffectiveVotes(session.votes).filter(isArenaRankVote);
            const rankStats = calculateArenaRankModelStats(effectiveRankVotes);
            const leadingRankModels = rankStats.length
              ? rankStats.filter(model => Math.abs(model.normalizedScore - rankStats[0].normalizedScore) < 1e-9)
              : [];
            const rankTieRate = effectiveRankVotes.length
              ? effectiveRankVotes.filter(vote => getRankingTieSummary(vote.ranking).hasTie).length / effectiveRankVotes.length
              : 0;
            const stats = calculateStats(session.votes);
            const skippedCount = getSkippedVoteCount(session.votes);
            const aPercent = stats.total ? Math.round((stats.aCount / stats.total) * 100) : 0;
            const bPercent = stats.total ? Math.round((stats.bCount / stats.total) * 100) : 0;
            const tiePercent = stats.total ? 100 - aPercent - bPercent : 0;

            return (
              <div key={session.id} className="glass-panel rounded-xl p-6 hover:shadow-lg transition-shadow">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  
                  {/* Meta Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-3 text-sm text-slate-400 mb-2">
                      <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(session.timestamp).toLocaleDateString()} {new Date(session.timestamp).toLocaleTimeString()}</span>
                      <span className="w-1 h-1 bg-white/20 rounded-full"></span>
                      <span className="flex items-center gap-1"><User size={14} /> {session.userName}</span>
                    </div>
                    <div className="flex items-center gap-2 font-bold text-slate-200 text-lg">
                      {isRankSession ? (
                        <>
                          <span className="text-amber-400">Arena-rank</span>
                          <span className="text-slate-400">领先:</span>
                          <span className="text-slate-200">{leadingRankModels.map(model => model.modelName).join(' = ') || '-'}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-blue-400">{session.modelNames.a}</span>
                          <span className="text-slate-400">vs</span>
                          <span className="text-indigo-400">{session.modelNames.b}</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm text-slate-400 mt-1">
                      已评测 {session.items.length} 项{skippedCount > 0 ? `，跳过 ${skippedCount} 项` : ''}
                    </div>
                  </div>

                  {/* Mini Charts */}
                  <div className="flex-1 min-w-[200px]">
                    {isRankSession ? (
                      <>
                        <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-1">
                          <span>领先模型归一化 Borda</span>
                          <span>{((rankStats[0]?.normalizedScore || 0) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-4 overflow-hidden bg-white/10">
                          <div style={{ width: `${(rankStats[0]?.normalizedScore || 0) * 100}%` }} className="h-full bg-amber-400" />
                        </div>
                        <div className="mt-1 flex justify-between text-xs text-slate-500">
                          <span>含并列票 {Math.round(rankTieRate * 100)}%</span>
                          <span>{effectiveRankVotes.length} 条排名</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs font-medium text-slate-400 mb-1">
                          <span>胜率分布</span>
                        </div>
                        <div className="h-4 rounded-full overflow-hidden flex w-full bg-white/10">
                          <div style={{ width: `${aPercent}%` }} className="bg-blue-500 h-full" title={`${session.modelNames.a}: ${aPercent}%`} />
                          <div style={{ width: `${tiePercent}%` }} className="bg-slate-400 h-full" title={`平局: ${tiePercent}%`} />
                          <div style={{ width: `${bPercent}%` }} className="bg-indigo-500 h-full" title={`${session.modelNames.b}: ${bPercent}%`} />
                        </div>
                        <div className="flex justify-between text-xs mt-1 text-slate-500">
                          <span>A: {aPercent}%</span>
                          <span>平局: {tiePercent}%</span>
                          <span>B: {bPercent}%</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6">
                    <button 
                      onClick={() => downloadCSV(session)}
                      className="flex items-center gap-2 px-4 py-2 bg-black/40 hover:bg-white/5 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    >
                      <Download size={16} /> CSV
                    </button>
                    <button 
                      onClick={() => onDeleteSession(session.id)}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                      title="删除记录"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HistoryScreen;
