import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, BarChart3, Download, Play, RefreshCw, RotateCcw, Check, Users, UploadCloud } from 'lucide-react';
import { EvalParadigm, EvaluationConfig, ResultsVoteScope, TaskVoteGroup, VoteRecord, EvaluationItem } from '../types';
import { isArenaRankVote, resolveEvaluationItemPrompt, sortRanking } from '../rankingUtils';
import { getDimensionColumnsForCsv, getDimensionCsvValues, getDimensionValuesForItem } from '../dimensionUtils';
import ResultsInsightsScreen from './ResultsInsightsScreen';
import ScoreInsightsScreen from './ScoreInsightsScreen';
import { getDefaultEvaluationConfig, getMethodFromParadigm, isPairwiseMethod, isPreviewMethod, isRankMethod, isScoreMethod } from '../evaluationMethods';
import { getEffectiveVotes, getSkippedVoteCount, isSkippedVote } from '../voteUtils';
import { DATA_SOURCE_LABEL, IS_OFFLINE_LOCAL_DEMO } from '../runtimeConfig';
import { itemFromVoteSnapshot, resolveVoteDisplayItem } from '../taskItemSnapshot';
import { countUniqueReviewers, withTaskVoteGroupReviewer } from '../taskResults';
import type { InsightExportContext } from '../insightExports';

interface ResultsScreenProps {
  votes: VoteRecord[];
  items: EvaluationItem[];
  onReset: () => void;
  userName?: string;
  modelNames: { a: string; b: string };
  models?: { id: string; name: string }[];
  paradigm?: EvalParadigm;
  evaluationConfig?: EvaluationConfig;
  allUserVoteGroups?: TaskVoteGroup[];
  teamVotesLoading?: boolean;
  teamVotesError?: string | null;
  onRefreshTeamVotes?: () => void | Promise<void>;
  taskId?: string | null;
  reviewerIdentity?: { id: string; displayName: string; email?: string };
  onResyncMyVotes?: () => void | Promise<void>;
  resyncLoading?: boolean;
  resyncError?: string | null;
  onBackToTasks?: () => void;
  onGoToDashboard?: () => void;
  onContinueEvaluation?: () => void;
}

const escapeCsvField = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const ResultsScreen: React.FC<ResultsScreenProps> = ({
  votes,
  items,
  onReset,
  userName,
  modelNames,
  models = [],
  paradigm = 'Arena',
  evaluationConfig,
  allUserVoteGroups = [],
  teamVotesLoading = false,
  teamVotesError = null,
  onRefreshTeamVotes,
  taskId = null,
  reviewerIdentity,
  onResyncMyVotes,
  resyncLoading = false,
  resyncError = null,
  onBackToTasks,
  onGoToDashboard,
  onContinueEvaluation
}) => {
  const [voteScope, setVoteScope] = useState<ResultsVoteScope>('mine');
  const [scopeTouched, setScopeTouched] = useState(false);
  const activeConfig = evaluationConfig || getDefaultEvaluationConfig(getMethodFromParadigm(paradigm as EvalParadigm));
  const isArenaRank = isRankMethod(activeConfig);
  const isBenchmarkPreview = isPreviewMethod(activeConfig);
  const teamScopedVotes = useMemo(
    () => allUserVoteGroups.flatMap(withTaskVoteGroupReviewer),
    [allUserVoteGroups],
  );
  const hasTeamVotes = teamScopedVotes.length > 0;
  const teamScopeAvailable = hasTeamVotes && !teamVotesError;
  const scopedVotes = voteScope === 'all' && teamScopeAvailable ? teamScopedVotes : votes;
  const effectiveVotes = getEffectiveVotes(scopedVotes);
  const itemMap = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const snapshotAwareItems = useMemo(() => {
    const merged = new Map<string, EvaluationItem>();
    items.forEach(item => merged.set(item.id, item));
    scopedVotes.forEach(vote => {
      const snapshotItem = itemFromVoteSnapshot(vote);
      if (snapshotItem) merged.set(snapshotItem.id, snapshotItem);
    });
    return Array.from(merged.values());
  }, [items, scopedVotes]);
  const getDisplayItemForVote = (vote: VoteRecord) =>
    resolveVoteDisplayItem(vote, itemMap.get(vote.itemId)) as EvaluationItem | undefined;
  const skippedCount = getSkippedVoteCount(scopedVotes);
  const teamVoterCount = countUniqueReviewers(teamScopedVotes);
  const currentUserCompleted = items.length > 0 && votes.length >= items.length;
  const scopeLabel = voteScope === 'all' && teamScopeAvailable ? '全员汇总' : '我的结果';
  const exportScopeTag = voteScope === 'all' && teamScopeAvailable ? 'all' : 'mine';
  const reviewerLabel = reviewerIdentity?.displayName || userName || 'Anonymous';
  const insightExportContext: InsightExportContext = {
    projectId: '',
    projectName: '当前评测',
    materialId: taskId || '',
    materialName: taskId ? `评测物料_${taskId}` : '当前评测',
    evaluationMethod: activeConfig.method,
    reviewerScope: exportScopeTag,
    reviewerScopeLabel: scopeLabel,
  };

  useEffect(() => {
    if (!teamScopeAvailable && voteScope === 'all') {
      setVoteScope('mine');
      return;
    }
    if (!scopeTouched && teamScopeAvailable) {
      setVoteScope('all');
    }
  }, [scopeTouched, teamScopeAvailable, voteScope]);

  const selectScope = (nextScope: ResultsVoteScope) => {
    setScopeTouched(true);
    setVoteScope(nextScope);
    if (nextScope === 'all') {
      void onRefreshTeamVotes?.();
    }
  };
  const rankVotes = effectiveVotes.filter(isArenaRankVote);
  const arenaRankModelList = models.length > 0
    ? models
    : Array.from(new Map(rankVotes.flatMap(vote => sortRanking(vote.ranking)).map(entry => [entry.modelId, {
        id: entry.modelId,
        name: entry.modelName,
      }])).values());
  const dimensionColumns = getDimensionColumnsForCsv(snapshotAwareItems);

  const scopeControls = (
    <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Users size={16} className="text-amber-300" />
            结果范围：{scopeLabel}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            当前数据源：{DATA_SOURCE_LABEL}{IS_OFFLINE_LOCAL_DEMO ? '（仅本机数据，不代表团队共享结果）' : '（共享任务数据源）'}。我的结果用于复盘个人评审；全员汇总会聚合当前评测物料下所有成员投票。当前全员数据包含 {teamVoterCount} 位成员、{teamScopedVotes.length} 条记录。
            {currentUserCompleted ? ' 当前用户已完成本轮评测。' : ' 当前用户尚未完成全部 case。'}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            任务：{taskId || '本地会话'}；当前账号：{reviewerLabel}{reviewerIdentity?.email ? `（${reviewerIdentity.email}）` : ''}。
          </p>
          {teamVotesError && (
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-300">
              <AlertTriangle size={13} />
              {teamVotesError}；已保留“我的结果”可用。
            </div>
          )}
          {resyncError && (
            <div className="mt-2 flex items-center gap-2 text-xs text-red-300">
              <AlertTriangle size={13} />
              {resyncError}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onBackToTasks && (
            <button
              type="button"
              onClick={onBackToTasks}
              className="inline-flex items-center gap-2 border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              <ArrowLeft size={14} />
              返回评测物料
            </button>
          )}
          {onContinueEvaluation && (
            <button
              type="button"
              onClick={onContinueEvaluation}
              className="inline-flex items-center gap-2 border border-amber-400/40 bg-amber-400 px-3 py-2 text-xs font-bold text-black hover:bg-amber-300"
            >
              <Play size={14} />
              继续贡献
            </button>
          )}
          <div className="inline-flex overflow-hidden rounded-lg border border-white/10 bg-black/30 p-1">
            <button
              type="button"
              onClick={() => selectScope('mine')}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${voteScope === 'mine' || !teamScopeAvailable ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/10'}`}
            >
              我的结果
            </button>
            <button
              type="button"
              onClick={() => selectScope('all')}
              disabled={!teamScopeAvailable}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${voteScope === 'all' && teamScopeAvailable ? 'bg-amber-400 text-black' : 'text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-600'}`}
            >
              全员汇总
            </button>
          </div>
          {onRefreshTeamVotes && (
            <button
              type="button"
              onClick={onRefreshTeamVotes}
              disabled={teamVotesLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60"
            >
              <RefreshCw size={14} className={teamVotesLoading ? 'animate-spin' : ''} />
              刷新全员结果
            </button>
          )}
          {onResyncMyVotes && (
            <button
              type="button"
              onClick={onResyncMyVotes}
              disabled={resyncLoading || votes.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <UploadCloud size={14} className={resyncLoading ? 'animate-pulse' : ''} />
              重新同步我的结果
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const downloadPreviewCSV = () => {
    const inputHeaders: string[] = Array.from(new Set(snapshotAwareItems.flatMap(item => Object.keys(item.inputs || {}))));
    const outputHeaders = models.length > 0
      ? models.map(model => model.name)
      : Array.from(new Set(snapshotAwareItems.flatMap(item => item.modelOutputs?.map(output => output.modelName) || [])));
    const headers = ['ItemID', 'Status', 'Comment', 'Timestamp', 'User', ...dimensionColumns.map(col => col.header), ...inputHeaders, ...outputHeaders];
    const rows = scopedVotes.map(vote => {
      const item = getDisplayItemForVote(vote);
      const dimensionValues = getDimensionValuesForItem(item);
      const outputByName = new Map((item?.modelOutputs || []).map(output => [output.modelName, output.url]));
      return [
        vote.itemId,
        vote.choice || 'previewed',
        vote.reason || '',
        new Date(vote.timestamp).toISOString(),
        vote.user || userName || 'Anonymous',
        ...getDimensionCsvValues(dimensionValues, dimensionColumns.map(col => col.key)),
        ...inputHeaders.map(header => item?.inputs?.[header] || ''),
        ...outputHeaders.map((header, index) => outputByName.get(header) || (index === 0 ? item?.modelA_Url : index === 1 ? item?.modelB_Url : '') || '')
      ].map(escapeCsvField).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `benchmark_preview_${exportScopeTag}_${userName || 'anon'}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (scopedVotes.length === 0) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        {scopeControls}
        <div className="border border-white/10 bg-[var(--surface-panel)] px-6 py-16 text-center shadow-[10px_10px_0_rgba(0,0,0,0.28)]">
          {teamVotesLoading ? (
            <>
              <RefreshCw size={28} className="mx-auto mb-4 animate-spin text-amber-300" />
              <h1 className="text-xl font-bold text-white">正在加载评测结果</h1>
              <p className="mt-2 text-sm text-slate-400">正在读取该任务的团队提交记录。</p>
            </>
          ) : (
            <>
              <BarChart3 size={30} className="mx-auto mb-4 text-slate-500" />
              <h1 className="text-xl font-bold text-white">
                {voteScope === 'mine' && hasTeamVotes ? '当前账号尚未提交结果' : '此任务尚无已提交结果'}
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                {voteScope === 'mine' && hasTeamVotes
                  ? '可切换到“全员汇总”查看团队已有结果，或返回评测继续提交。'
                  : '完成至少一个 case 并成功提交后，这里会显示个人结果与全员汇总。'}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (isBenchmarkPreview) {
    const previewedCount = scopedVotes.filter(vote => vote.choice !== 'skipped').length;
    const skippedCount = scopedVotes.filter(vote => vote.choice === 'skipped').length;
    const commentedCount = scopedVotes.filter(vote => vote.reason?.trim()).length;

    return (
      <div className="mx-auto max-w-6xl p-6 animate-in zoom-in-95 duration-500">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-300 ring-8 ring-amber-500/5">
            <Check size={32} />
          </div>
          <h1 className="mb-2 text-4xl font-bold text-slate-200">Benchmark 预览完成</h1>
          <p className="text-slate-300">{userName || 'Reviewer'} 的数据预览记录</p>
        </div>

        {scopeControls}

        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">总 Case</div>
            <div className="mt-2 text-3xl font-bold text-slate-100">{items.length}</div>
          </div>
          <div className="border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">已预览</div>
            <div className="mt-2 text-3xl font-bold text-amber-300">{previewedCount}</div>
          </div>
          <div className="border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">已跳过</div>
            <div className="mt-2 text-3xl font-bold text-slate-100">{skippedCount}</div>
          </div>
          <div className="border border-white/10 bg-white/5 p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">有评论</div>
            <div className="mt-2 text-3xl font-bold text-slate-100">{commentedCount}</div>
          </div>
        </div>

        <div className="overflow-hidden border border-white/10 bg-white/5">
          <div className="flex flex-col gap-3 border-b border-white/10 bg-black/20 p-5 md:flex-row md:items-center md:justify-between">
            <h3 className="font-semibold text-slate-200">逐 case 预览明细</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={onReset} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10">
                <RotateCcw size={16} /> 清除当前会话
              </button>
              {onGoToDashboard && (
                <button onClick={onGoToDashboard} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10">
                  返回大盘
                </button>
              )}
              <button onClick={downloadPreviewCSV} className="flex items-center gap-2 bg-black/40 px-5 py-2 text-sm font-medium text-white hover:bg-white/10">
                <Download size={16} /> 下载 CSV
              </button>
            </div>
          </div>
          <div className="max-h-[520px] overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="sticky top-0 bg-white/5">
                <tr>
                  <th className="border-b border-white/10 p-4 text-xs font-semibold uppercase text-slate-300">ID</th>
                  <th className="border-b border-white/10 p-4 text-xs font-semibold uppercase text-slate-300">状态</th>
                  <th className="border-b border-white/10 p-4 text-xs font-semibold uppercase text-slate-300">输入摘要</th>
                  <th className="border-b border-white/10 p-4 text-xs font-semibold uppercase text-slate-300">评论</th>
                  <th className="border-b border-white/10 p-4 text-right text-xs font-semibold uppercase text-slate-300">时间</th>
                </tr>
              </thead>
              <tbody>
                {scopedVotes.map((vote, index) => {
                  const item = getDisplayItemForVote(vote);
                  return (
                    <tr key={`${vote.itemId}-${index}`} className="border-b border-white/10 hover:bg-white/5">
                      <td className="p-4 font-mono text-sm text-slate-200">{vote.itemId}</td>
                      <td className="p-4">
                        <span className={`inline-flex px-2.5 py-1 text-xs font-medium ${vote.choice === 'skipped' ? 'bg-white/10 text-slate-300' : 'bg-amber-500/15 text-amber-300'}`}>
                          {vote.choice === 'skipped' ? '已跳过' : '已预览'}
                        </span>
                      </td>
                      <td className="max-w-sm p-4 text-sm text-slate-300">
                        <div className="line-clamp-3 whitespace-pre-wrap break-words">{resolveEvaluationItemPrompt(item) || '-'}</div>
                      </td>
                      <td className="max-w-md p-4 text-sm text-slate-200">
                        <div className="whitespace-pre-wrap break-words">{vote.reason || '-'}</div>
                      </td>
                      <td className="p-4 text-right text-sm text-slate-300">{new Date(vote.timestamp).toLocaleTimeString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  const resultReturnAction = onBackToTasks
    ? { label: '返回评测物料', onClick: onBackToTasks }
    : onGoToDashboard
      ? { label: '返回大盘', onClick: onGoToDashboard }
      : undefined;
  if (isScoreMethod(activeConfig)) {
    return (
      <ScoreInsightsScreen
        mode="score"
        title={activeConfig.method === 'rubric_score' ? 'Rubric 结果洞察' : 'MOS 结果洞察'}
        description={`当前展示范围：${scopeLabel}`}
        controls={scopeControls}
        items={snapshotAwareItems}
        votes={effectiveVotes}
        models={models.length ? models : [
          { id: 'model-0', name: modelNames.a },
          { id: 'model-1', name: modelNames.b },
        ]}
        config={activeConfig}
        skippedCount={skippedCount}
        reportSkippedVotes={scopedVotes}
        returnAction={resultReturnAction}
        exportContext={insightExportContext}
      />
    );
  }

  if (isPairwiseMethod(activeConfig)) {
    return (
      <ScoreInsightsScreen
        mode="pairwise"
        title="Pairwise 结果洞察"
        description={`当前展示范围：${scopeLabel}`}
        controls={scopeControls}
        items={snapshotAwareItems}
        votes={effectiveVotes}
        models={models.length ? models : [
          { id: 'model-0', name: modelNames.a },
          { id: 'model-1', name: modelNames.b },
        ]}
        skippedCount={skippedCount}
        reportSkippedVotes={scopedVotes}
        returnAction={resultReturnAction}
        exportContext={insightExportContext}
      />
    );
  }

  return (
    <ResultsInsightsScreen
      mode={isArenaRank ? 'rank' : 'ab'}
      title="结果洞察"
      description={`当前展示范围：${scopeLabel}`}
      controls={scopeControls}
      items={snapshotAwareItems}
      votes={effectiveVotes}
      modelNames={modelNames}
      models={arenaRankModelList}
      skippedCount={skippedCount}
      reportSkippedVotes={scopedVotes}
      returnAction={resultReturnAction}
      exportContext={insightExportContext}
    />
  );


};

export default ResultsScreen;
