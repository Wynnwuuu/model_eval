import React, { useMemo } from 'react';
import { ArrowLeft, BarChart3, Download, FileText, Grid3X3, Trophy, Users } from 'lucide-react';
import { EvaluationConfig, EvaluationItem, VoteRecord } from '../types';
import {
  buildPairwiseCaseCsv,
  buildPairwiseInsights,
  buildPairwiseSummaryCsv,
  buildScoreCaseCsv,
  buildScoreInsights,
  buildScoreSummaryCsv
} from '../scoringInsights';
import { formatNumber, formatPercent } from '../analysisInsights';
import MediaRenderer from './MediaRenderer';
import DimensionChips from './DimensionChips';

interface ScoreInsightsScreenProps {
  mode: 'score' | 'pairwise';
  title?: string;
  description?: React.ReactNode;
  controls?: React.ReactNode;
  items: Array<Partial<EvaluationItem> & { id: string }>;
  votes: VoteRecord[];
  models: { id: string; name: string }[];
  config?: EvaluationConfig;
  onBack?: () => void;
  backLabel?: string;
}

const downloadTextFile = (filename: string, content: string, mimeType = 'text/csv;charset=utf-8;') => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const StatCard: React.FC<{ title: string; value: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode }> = ({ title, value, subtitle, icon }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-sm shadow-black/20">
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {icon && <div className="text-amber-300">{icon}</div>}
    </div>
    <div className="mt-3 text-2xl font-bold text-slate-100">{value}</div>
    {subtitle && <div className="mt-1 text-xs text-slate-400">{subtitle}</div>}
  </div>
);

const MiniMedia: React.FC<{ url?: string; type?: EvaluationItem['type']; label: string }> = ({ url, type, label }) => {
  if (!url) return <div className="flex h-28 items-center justify-center border border-white/10 bg-black/30 text-xs text-slate-500">无预览</div>;
  if (type === 'text' || type === 'unknown') {
    return <div className="h-28 overflow-auto border border-white/10 bg-black/30 p-3 text-xs text-slate-300 whitespace-pre-wrap">{url}</div>;
  }
  return (
    <div className="h-28 overflow-hidden border border-white/10 bg-black/40 p-1">
      <MediaRenderer url={url} label={label} isActive={true} forceType={type || 'video'} />
    </div>
  );
};

const ScoreInsightsScreen: React.FC<ScoreInsightsScreenProps> = ({
  mode,
  title,
  description,
  controls,
  items,
  votes,
  models,
  config,
  onBack,
  backLabel = '返回明细'
}) => {
  const dateTag = new Date().toISOString().slice(0, 10);
  const scoreBundle = useMemo(() => {
    if (mode !== 'score' || !config) return null;
    return buildScoreInsights({ items, votes, models, config });
  }, [config, items, mode, models, votes]);

  const pairwiseBundle = useMemo(() => {
    if (mode !== 'pairwise') return null;
    return buildPairwiseInsights({ items, votes, models });
  }, [items, mode, models, votes]);

  if (mode === 'score' && scoreBundle) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            {onBack && (
              <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white">
                <ArrowLeft size={16} /> {backLabel}
              </button>
            )}
            <h1 className="text-3xl font-black text-slate-100">{title || scoreBundle.title}</h1>
            {description && <div className="mt-2 max-w-3xl text-sm text-slate-400">{description}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => downloadTextFile(`score_summary_${dateTag}.csv`, buildScoreSummaryCsv(scoreBundle))} className="btn-secondary">
              <Download size={16} /> 导出模型汇总
            </button>
            <button onClick={() => downloadTextFile(`score_cases_${dateTag}.csv`, buildScoreCaseCsv(scoreBundle))} className="btn-secondary">
              <Download size={16} /> 导出 case 明细
            </button>
          </div>
        </div>

        {controls}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard title="样本量" value={scoreBundle.summary.itemCount} subtitle={`${scoreBundle.summary.responseCount} 条模型评分`} icon={<FileText size={18} />} />
          <StatCard title="评委数" value={scoreBundle.summary.voterCount} subtitle="有效评分用户" icon={<Users size={18} />} />
          <StatCard title="领先模型" value={scoreBundle.summary.topModelName} subtitle={`${formatNumber(scoreBundle.summary.topAverageScore, 2)} 平均分`} icon={<Trophy size={18} />} />
          <StatCard title="评分分歧" value={formatNumber(scoreBundle.summary.averageStdDev, 2)} subtitle="模型平均标准差" icon={<BarChart3 size={18} />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="glass-panel overflow-hidden">
            <div className="border-b border-white/10 p-4">
              <h2 className="text-lg font-bold text-slate-100">模型评分榜单</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-white/5 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="p-4">排名</th>
                    <th className="p-4">模型</th>
                    <th className="p-4">平均分</th>
                    <th className="p-4">中位数</th>
                    <th className="p-4">标准差</th>
                    <th className="p-4">评分数</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreBundle.models.map((model, index) => (
                    <tr key={model.modelId} className="border-t border-white/10 hover:bg-white/5">
                      <td className="p-4 font-mono text-amber-300">#{index + 1}</td>
                      <td className="p-4 font-bold text-slate-100">{model.modelName}</td>
                      <td className="p-4 text-slate-200">{formatNumber(model.averageScore, 2)}</td>
                      <td className="p-4 text-slate-300">{formatNumber(model.medianScore, 2)}</td>
                      <td className="p-4 text-slate-300">{formatNumber(model.stdDev, 2)}</td>
                      <td className="p-4 text-slate-300">{model.responseCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="glass-panel p-4">
            <h2 className="mb-4 text-lg font-bold text-slate-100">维度表现</h2>
            <div className="space-y-4">
              {scoreBundle.dimensions.map(dimension => (
                <div key={dimension.dimensionId} className="border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-bold text-slate-100">{dimension.dimensionName}</div>
                    <div className="font-mono text-xs text-amber-300">w {dimension.weight}</div>
                  </div>
                  <div className="space-y-2">
                    {dimension.modelAverages.map(model => (
                      <div key={model.modelId}>
                        <div className="mb-1 flex justify-between text-xs text-slate-400">
                          <span>{model.modelName}</span>
                          <span>{formatNumber(model.averageScore, 2)}</span>
                        </div>
                        <div className="h-2 bg-white/10">
                          <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, model.averageScore * 20)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="glass-panel overflow-hidden">
          <div className="border-b border-white/10 p-4">
            <h2 className="text-lg font-bold text-slate-100">Case 证据画廊</h2>
          </div>
          <div className="grid gap-4 p-4 xl:grid-cols-2">
            {scoreBundle.cases.map(item => (
              <article key={item.itemId} className="border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs text-amber-300">{item.itemId}</div>
                    <div className="mt-1 line-clamp-3 text-sm text-slate-300">{item.prompt || '-'}</div>
                  </div>
                  <DimensionChips values={item.dimensionValues} label="" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {item.modelScores.map(model => (
                    <div key={model.modelId} className="border border-white/10 bg-black/20 p-3">
                      <MiniMedia url={model.outputUrl} type={items.find(candidate => candidate.id === item.itemId)?.type as any} label={model.modelName} />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold text-slate-100">{model.modelName}</span>
                        <span className="font-mono text-sm text-amber-300">{formatNumber(model.weightedScore, 2)}</span>
                      </div>
                      {model.reasons.length > 0 && (
                        <div className="mt-2 line-clamp-2 text-xs text-slate-400">{model.reasons.join(' / ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (mode === 'pairwise' && pairwiseBundle) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            {onBack && (
              <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-300 hover:text-white">
                <ArrowLeft size={16} /> {backLabel}
              </button>
            )}
            <h1 className="text-3xl font-black text-slate-100">{title || 'Pairwise 对战洞察'}</h1>
            {description && <div className="mt-2 max-w-3xl text-sm text-slate-400">{description}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => downloadTextFile(`pairwise_summary_${dateTag}.csv`, buildPairwiseSummaryCsv(pairwiseBundle))} className="btn-secondary">
              <Download size={16} /> 导出模型矩阵
            </button>
            <button onClick={() => downloadTextFile(`pairwise_cases_${dateTag}.csv`, buildPairwiseCaseCsv(pairwiseBundle))} className="btn-secondary">
              <Download size={16} /> 导出 case 明细
            </button>
          </div>
        </div>

        {controls}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard title="对战 case" value={pairwiseBundle.summary.itemCount} subtitle="模型对 × 原始 case" icon={<Grid3X3 size={18} />} />
          <StatCard title="评委数" value={pairwiseBundle.summary.voterCount} subtitle="有效对战投票用户" icon={<Users size={18} />} />
          <StatCard title="领先模型" value={pairwiseBundle.summary.topModelName} subtitle={`${formatPercent(pairwiseBundle.summary.topWinRate, 1)} 非平局胜率`} icon={<Trophy size={18} />} />
          <StatCard title="对战票数" value={pairwiseBundle.summary.comparisonCount} subtitle="包含平局" icon={<BarChart3 size={18} />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
          <section className="glass-panel overflow-hidden">
            <div className="border-b border-white/10 p-4">
              <h2 className="text-lg font-bold text-slate-100">模型胜率榜</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-white/5 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="p-4">排名</th>
                    <th className="p-4">模型</th>
                    <th className="p-4">胜</th>
                    <th className="p-4">负</th>
                    <th className="p-4">平</th>
                    <th className="p-4">非平局胜率</th>
                  </tr>
                </thead>
                <tbody>
                  {pairwiseBundle.models.map((model, index) => (
                    <tr key={model.modelId} className="border-t border-white/10 hover:bg-white/5">
                      <td className="p-4 font-mono text-amber-300">#{index + 1}</td>
                      <td className="p-4 font-bold text-slate-100">{model.modelName}</td>
                      <td className="p-4 text-emerald-300">{model.wins}</td>
                      <td className="p-4 text-red-300">{model.losses}</td>
                      <td className="p-4 text-slate-300">{model.ties}</td>
                      <td className="p-4 text-slate-200">{formatPercent(model.nonTieWinRate, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="glass-panel p-4">
            <h2 className="mb-4 text-lg font-bold text-slate-100">Pairwise 矩阵</h2>
            <div className="space-y-3">
              {pairwiseBundle.matchups.map(matchup => {
                const aRate = matchup.total ? matchup.modelAWins / matchup.total : 0;
                const bRate = matchup.total ? matchup.modelBWins / matchup.total : 0;
                return (
                  <div key={matchup.pairKey} className="border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 flex justify-between text-xs text-slate-300">
                      <span>{matchup.modelAName}</span>
                      <span>{matchup.modelBName}</span>
                    </div>
                    <div className="flex h-4 overflow-hidden bg-white/10">
                      <div className="bg-emerald-500" style={{ width: `${aRate * 100}%` }} title={`${matchup.modelAName}: ${matchup.modelAWins}`} />
                      <div className="bg-slate-500" style={{ width: `${matchup.total ? matchup.ties / matchup.total * 100 : 0}%` }} title={`平局: ${matchup.ties}`} />
                      <div className="bg-indigo-500" style={{ width: `${bRate * 100}%` }} title={`${matchup.modelBName}: ${matchup.modelBWins}`} />
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      {matchup.modelAName} {matchup.modelAWins} / 平局 {matchup.ties} / {matchup.modelBName} {matchup.modelBWins}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="glass-panel overflow-hidden">
          <div className="border-b border-white/10 p-4">
            <h2 className="text-lg font-bold text-slate-100">逐 case 对战明细</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-white/5 text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-4">Case</th>
                  <th className="p-4">Prompt</th>
                  <th className="p-4">对战模型</th>
                  <th className="p-4">票数</th>
                  <th className="p-4">胜者</th>
                </tr>
              </thead>
              <tbody>
                {pairwiseBundle.cases.map(item => (
                  <tr key={item.itemId} className="border-t border-white/10 hover:bg-white/5">
                    <td className="p-4 font-mono text-xs text-slate-300">{item.originalItemId}</td>
                    <td className="p-4 min-w-[260px] whitespace-pre-wrap text-sm text-slate-300">{item.prompt || '-'}</td>
                    <td className="p-4 text-sm text-slate-200">{item.modelAName} vs {item.modelBName}</td>
                    <td className="p-4 text-sm text-slate-300">{item.votes.A} / {item.votes.Tie} / {item.votes.B}</td>
                    <td className="p-4 text-sm font-bold text-amber-300">{item.winner || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="p-8 text-center text-slate-400">
      暂无可展示的评分结果。
    </div>
  );
};

export default ScoreInsightsScreen;
