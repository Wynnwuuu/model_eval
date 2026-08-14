import type { HistorySession } from './types';
import {
  calculateArenaRankModelStats,
  formatRanking,
  getArenaRankModelOutputUrl,
  getRankingEntryMetrics,
  getRankingTieSummary,
  isArenaRankVote,
  resolveEvaluationItemPrompt,
  sortRanking,
} from './rankingUtils';
import { isSkippedVote } from './voteUtils';

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const buildHistoryCsv = (session: HistorySession) => {
  const day = new Date(session.timestamp).toISOString().slice(0, 10);
  if (session.paradigm === 'Arena-rank') {
    const rankVotes = session.votes.filter(isArenaRankVote);
    const models = session.models?.length
      ? session.models
      : calculateArenaRankModelStats(rankVotes).map(stat => ({ id: stat.modelId, name: stat.modelName }));
    const maxRankCount = Math.max(0, ...rankVotes.map(vote => vote.ranking?.length || 0));
    const rankHeaders = Array.from({ length: maxRankCount }, (_, index) => `rank_${index + 1}`);
    const videoHeaders = Array.from({ length: maxRankCount }, (_, index) => `排名${index + 1}视频链接`);
    const modelHeaders = models.flatMap(model => [
      `${model.name}_rank`, `${model.name}_score`, `${model.name}_midrank`, `${model.name}_borda_score`, `${model.name}_normalized_borda`,
    ]);
    const headers = ['ItemID', 'Prompt', 'Status', 'Timestamp', 'User', 'RankingDisplay', 'HasTie', 'AllTied', 'TieGroupCount', 'TopTieSize', ...rankHeaders, ...videoHeaders, ...modelHeaders, 'ranking_json'];
    const rows = session.votes.filter(vote => isArenaRankVote(vote) || isSkippedVote(vote)).map(vote => {
      const item = session.items.find(candidate => candidate.id === vote.itemId);
      const ranking = sortRanking(vote.ranking);
      const ties = getRankingTieSummary(ranking);
      const rankValues = rankHeaders.map((_, index) => ranking[index] ? `${ranking[index].modelName} (${ranking[index].modelId})` : '');
      const videos = rankHeaders.map((_, index) => ranking[index] ? getArenaRankModelOutputUrl(item, ranking[index], models) : '');
      const modelValues = models.flatMap(model => {
        const entry = ranking.find(candidate => candidate.modelId === model.id);
        const metrics = entry ? getRankingEntryMetrics(ranking, entry.modelId) : null;
        return metrics
          ? [entry!.rank, metrics.bordaScore, metrics.midRank, metrics.bordaScore, metrics.normalizedBorda].map(String)
          : ['', '', '', '', ''];
      });
      return [
        vote.itemId, resolveEvaluationItemPrompt(item), isSkippedVote(vote) ? 'skipped' : 'ranked', new Date(vote.timestamp).toISOString(),
        session.userName || 'Anonymous', formatRanking(ranking), ties.hasTie, ties.allTied, ties.tieGroupCount, ties.topTieSize,
        ...rankValues, ...videos, ...modelValues, JSON.stringify(ranking),
      ].map(csvCell).join(',');
    });
    return {
      fileName: `arena_rank_results_${session.userName || 'anon'}_${day}.csv`,
      content: [headers.join(','), ...rows].join('\n'),
    };
  }

  const headers = ['ItemID', 'Status', 'ModelA_URL', 'ModelB_URL', 'Winner', 'Timestamp', 'User', 'ModelA_Name', 'ModelB_Name', 'References'];
  const rows = session.votes.map(vote => {
    const item = session.items.find(candidate => candidate.id === vote.itemId);
    return [
      vote.itemId, isSkippedVote(vote) ? 'skipped' : 'voted', item?.modelA_Url || '', item?.modelB_Url || '',
      isSkippedVote(vote) ? '' : vote.vote, new Date(vote.timestamp).toISOString(), session.userName || 'Anonymous',
      session.modelNames.a, session.modelNames.b, item?.referenceUrls?.join(' | ') || '',
    ].map(csvCell).join(',');
  });
  return {
    fileName: `results_${session.userName || 'anon'}_${day}.csv`,
    content: [headers.join(','), ...rows].join('\n'),
  };
};
