import React, { useMemo } from 'react';
import { AlertTriangle, ArrowLeft, BarChart3, Brain, Download, FileText, Grid3X3, Trophy, Users } from 'lucide-react';
import { EvaluationConfig, EvaluationItem, VoteRecord } from '../types';
import {
  PairwiseInsightBundle,
  ScoreInsightBundle,
  buildPairwiseCaseCsv,
  buildPairwiseBattleCsv,
  buildPairwiseDimensionCsv,
  buildPairwiseInsights,
  buildPairwiseMatchupCsv,
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
  skippedCount?: number;
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

const StatCard: React.FC<{ title: string; value: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode; tone?: 'amber' | 'green' | 'blue' | 'purple' | 'slate' }> = ({ title, value, subtitle, icon, tone = 'slate' }) => {
  const toneClass = {
    amber: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
    green: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    blue: 'border-blue-400/20 bg-blue-500/10 text-blue-200',
    purple: 'border-purple-400/20 bg-purple-500/10 text-purple-200',
    slate: 'border-white/10 bg-white/5 text-slate-200'
  }[tone];
  return (
    <div className={`rounded-xl border p-4 shadow-sm shadow-black/20 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
        {icon && <div className="text-current opacity-85">{icon}</div>}
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-100">{value}</div>
      {subtitle && <div className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</div>}
    </div>
  );
};

const Meter: React.FC<{ value: number; className?: string }> = ({ value, className = 'bg-amber-400' }) => (
  <div className="h-2 overflow-hidden rounded-full bg-white/10">
    <div className={`h-full ${className}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
  </div>
);

const ConclusionPanel: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  meta: React.ReactNode;
}> = ({ eyebrow, title, subtitle, meta }) => (
  <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-amber-100 shadow-lg shadow-black/20">
    <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-100/70">{eyebrow}</div>
    <div className="mt-3 text-3xl font-black tracking-tight text-slate-50">{title}</div>
    <div className="mt-2 max-w-4xl text-sm leading-6 text-amber-100/85">{subtitle}</div>
    <div className="mt-4 flex flex-wrap gap-2 text-xs text-amber-100/85">{meta}</div>
  </section>
);

const Chip: React.FC<{ children: React.ReactNode; tone?: 'amber' | 'green' | 'blue' | 'slate' }> = ({ children, tone = 'slate' }) => {
  const toneClass = {
    amber: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
    green: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200',
    blue: 'border-blue-400/20 bg-blue-500/10 text-blue-200',
    slate: 'border-white/10 bg-white/10 text-slate-300'
  }[tone];
  return <span className={`rounded-full border px-2.5 py-1 ${toneClass}`}>{children}</span>;
};

const MiniMedia: React.FC<{ url?: string; type?: EvaluationItem['type']; label: string }> = ({ url, type, label }) => {
  if (!url) return <div className="flex h-28 items-center justify-center border border-white/10 bg-black/30 text-xs text-slate-500">暂无预览</div>;
  if (type === 'text' || type === 'unknown') {
    return <div className="h-28 overflow-auto border border-white/10 bg-black/30 p-3 text-xs text-slate-300 whitespace-pre-wrap">{url}</div>;
  }
  return (
    <div className="h-28 overflow-hidden border border-white/10 bg-black/40 p-1">
      <MediaRenderer url={url} label={label} isActive={false} forceType={type && type !== 'unknown' ? type : undefined} videoPreload="metadata" />
    </div>
  );
};

const ScoreConclusion: React.FC<{ bundle: ScoreInsightBundle }> = ({ bundle }) => {
  const isRubric = bundle.method === 'rubric_score';
  return (
    <ConclusionPanel
      eyebrow={isRubric ? 'Rubric 多维评分结论' : 'MOS / 直接评分结论'}
      title={bundle.summary.topModelName || '暂无领先模型'}
      subtitle={`${bundle.summary.topModelName || '当前最高模型'} 的平均分为 ${formatNumber(bundle.summary.topAverageScore, 2)}。评分型结果的重点是均分、稳定性和维度短板；请结合标准差、维度表现和低分 case 判断真实优势。`}
      meta={
        <>
          <Chip tone="amber">评分记录: {bundle.summary.responseCount}</Chip>
          <Chip tone="blue">评委数: {bundle.summary.voterCount}</Chip>
          <Chip>平均标准差: {formatNumber(bundle.summary.averageStdDev, 2)}</Chip>
          <Chip tone={bundle.summary.itemCount < 5 || bundle.summary.responseCount < 10 ? 'amber' : 'green'}>
            {bundle.summary.itemCount < 5 || bundle.summary.responseCount < 10 ? '样本不足' : '样本量可读'}
          </Chip>
        </>
      }
    />
  );
};

const PairwiseConclusion: React.FC<{ bundle: PairwiseInsightBundle }> = ({ bundle }) => (
  <ConclusionPanel
    eyebrow="Arena 竞技场结论"
    title={bundle.summary.connected ? bundle.summary.topModelName : '对战图尚未连通'}
    subtitle={bundle.summary.connected
      ? `${bundle.summary.topModelName} 当前 Arena Score 最高。请结合 95% 置信区间、近似排名范围与原始胜负平判断优势是否稳定。`
      : '当前模型分处不同对战连通分量，平台不会生成误导性的跨分量总排名；继续贡献对战可补齐比较桥梁。'}
    meta={
      <>
        <Chip tone="amber">有效对战: {bundle.summary.comparisonCount}</Chip>
        <Chip tone="blue">评委数: {bundle.summary.voterCount}</Chip>
        <Chip>模型对覆盖: {formatPercent(bundle.summary.pairCoverage, 1)}</Chip>
        <Chip>有效样本量: {formatNumber(bundle.summary.effectiveSampleSize, 1)}</Chip>
        <Chip tone={bundle.summary.maturity === 'ready' ? 'green' : 'amber'}>
          {bundle.summary.maturity === 'ready' ? '数据可读' : bundle.summary.maturity === 'warming' ? '仍在预热' : '数据不足'}
        </Chip>
      </>
    }
  />
);

const ScoreLeaderboard: React.FC<{ bundle: ScoreInsightBundle }> = ({ bundle }) => {
  const maxScore = Math.max(...bundle.models.map(model => model.averageScore), 1);
  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-white/10 p-4">
        <h2 className="text-lg font-bold text-slate-100">模型评分榜单</h2>
        <p className="mt-1 text-xs text-slate-500">均分用于排序，中位数与标准差帮助判断稳定性。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
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
            {bundle.models.map((model, index) => (
              <tr key={model.modelId} className="border-t border-white/10 hover:bg-white/5">
                <td className="p-4 font-mono text-amber-300">#{index + 1}</td>
                <td className="p-4 font-bold text-slate-100">{model.modelName}</td>
                <td className="p-4 text-slate-200">
                  <div className="mb-1 font-semibold">{formatNumber(model.averageScore, 2)}</div>
                  <Meter value={model.averageScore / maxScore} />
                </td>
                <td className="p-4 text-slate-300">{formatNumber(model.medianScore, 2)}</td>
                <td className="p-4 text-slate-300">{formatNumber(model.stdDev, 2)}</td>
                <td className="p-4 text-slate-300">{model.responseCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const ScoreDimensionPanel: React.FC<{ bundle: ScoreInsightBundle }> = ({ bundle }) => (
  <section className="glass-panel p-4">
    <h2 className="mb-4 text-lg font-bold text-slate-100">评分维度表现</h2>
    {bundle.dimensions.length ? (
      <div className="space-y-4">
        {bundle.dimensions.map(dimension => {
          const max = Math.max(...dimension.modelAverages.map(model => model.averageScore), 1);
          return (
            <div key={dimension.dimensionId} className="border border-white/10 bg-white/5 p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-bold text-slate-100">{dimension.dimensionName}</div>
                <div className="font-mono text-xs text-amber-300">权重 {dimension.weight}</div>
              </div>
              <div className="space-y-2">
                {dimension.modelAverages.map(model => (
                  <div key={model.modelId}>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span className="truncate">{model.modelName}</span>
                      <span>{formatNumber(model.averageScore, 2)} / n={model.responseCount}</span>
                    </div>
                    <Meter value={model.averageScore / max} className="bg-emerald-400" />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="flex h-36 items-center justify-center text-sm text-slate-500">当前评分配置没有可聚合的评分维度。</div>
    )}
  </section>
);

const ScoreCaseGallery: React.FC<{ bundle: ScoreInsightBundle; items: Array<Partial<EvaluationItem> & { id: string }> }> = ({ bundle, items }) => (
  <section className="glass-panel overflow-hidden">
    <div className="border-b border-white/10 p-4">
      <h2 className="text-lg font-bold text-slate-100">Case 证据画廊</h2>
      <p className="mt-1 text-xs text-slate-500">展示每个 case 的模型产物、综合分和评审理由。</p>
    </div>
    <div className="grid gap-4 p-4 xl:grid-cols-2">
      {bundle.cases.map(item => (
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
                <div className="mt-1 text-xs text-slate-400">平均分 {formatNumber(model.averageScore, 2)} / 评分数 {model.responseCount}</div>
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
);

const ArenaScoreLeaderboard: React.FC<{ bundle: PairwiseInsightBundle }> = ({ bundle }) => {
  const rows = bundle.summary.connected
    ? bundle.bradleyTerry.models
    : [...bundle.bradleyTerry.models].sort((left, right) => left.component - right.component || left.modelName.localeCompare(right.modelName));
  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-white/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Arena Score 榜单</h2>
            <p className="mt-1 text-xs text-slate-500">Bradley-Terry 加权估计，基准约 1000；区间越窄，当前结论越稳定。</p>
          </div>
          <span className={`border px-2.5 py-1 text-xs font-bold ${bundle.summary.connected ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-300'}`}>
            {bundle.summary.connected ? '对战图已连通' : `${bundle.bradleyTerry.componentCount} 个连通分量`}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead className="bg-white/5 text-xs uppercase text-slate-400">
            <tr>
              <th className="p-4">排名</th>
              <th className="p-4">模型</th>
              <th className="p-4">Arena Score</th>
              <th className="p-4">95% CI</th>
              <th className="p-4">近似排名范围</th>
              <th className="p-4">曝光场次</th>
              <th className="p-4">连通分量</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(model => (
              <tr key={model.modelId} className="border-t border-white/10 hover:bg-white/5">
                <td className="p-4 font-mono text-amber-300">{bundle.summary.connected ? `#${model.rank}` : '-'}</td>
                <td className="p-4 font-bold text-slate-100">{model.modelName}</td>
                <td className="p-4 font-mono text-lg text-slate-100">{bundle.summary.connected ? formatNumber(model.rating, 1) : '-'}</td>
                <td className="p-4 font-mono text-xs text-slate-300">
                  {bundle.summary.connected ? `${formatNumber(model.ratingLower, 1)} - ${formatNumber(model.ratingUpper, 1)}` : '跨分量不可比较'}
                </td>
                <td className="p-4 text-sm text-slate-300">{bundle.summary.connected ? `#${model.rankLower} - #${model.rankUpper}` : '-'}</td>
                <td className="p-4 text-sm text-slate-300">{model.battles}</td>
                <td className="p-4 text-sm text-slate-400">组件 {model.component + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const PairwiseLeaderboard: React.FC<{ bundle: PairwiseInsightBundle }> = ({ bundle }) => (
  <section className="glass-panel overflow-hidden">
    <div className="border-b border-white/10 p-4">
      <h2 className="text-lg font-bold text-slate-100">原始胜负平统计</h2>
      <p className="mt-1 text-xs text-slate-500">仅展示未经模型校正的观察计数，不作为 Arena 总排名；平局单独保留。</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left">
        <thead className="bg-white/5 text-xs uppercase text-slate-400">
          <tr>
            <th className="p-4">记录</th>
            <th className="p-4">模型</th>
            <th className="p-4">胜</th>
            <th className="p-4">负</th>
            <th className="p-4">平</th>
            <th className="p-4">总计</th>
            <th className="p-4">非平局胜率</th>
          </tr>
        </thead>
        <tbody>
          {bundle.models.map((model) => (
            <tr key={model.modelId} className="border-t border-white/10 hover:bg-white/5">
              <td className="p-4 font-mono text-slate-500">RAW</td>
              <td className="p-4 font-bold text-slate-100">{model.modelName}</td>
              <td className="p-4 text-emerald-300">{model.wins}</td>
              <td className="p-4 text-red-300">{model.losses}</td>
              <td className="p-4 text-slate-300">{model.ties}</td>
              <td className="p-4 text-slate-300">{model.total}</td>
              <td className="p-4 text-slate-200">
                <div className="mb-1">{formatPercent(model.nonTieWinRate, 1)}</div>
                <Meter value={model.nonTieWinRate} className="bg-emerald-400" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

const PairwiseMatrix: React.FC<{ bundle: PairwiseInsightBundle }> = ({ bundle }) => (
  <section className="glass-panel p-4">
    <h2 className="mb-4 text-lg font-bold text-slate-100">对战矩阵</h2>
    <div className="space-y-3">
      {bundle.matchups.map(matchup => {
        const aRate = matchup.total ? matchup.modelAWins / matchup.total : 0;
        const bRate = matchup.total ? matchup.modelBWins / matchup.total : 0;
        const tieRate = matchup.total ? matchup.ties / matchup.total : 0;
        return (
          <div key={matchup.pairKey} className="border border-white/10 bg-white/5 p-3">
            <div className="mb-2 flex justify-between gap-3 text-xs text-slate-300">
              <span className="truncate">{matchup.modelAName}</span>
              <span className="truncate text-right">{matchup.modelBName}</span>
            </div>
            <div className="flex h-4 overflow-hidden bg-white/10">
              <div className="bg-emerald-500" style={{ width: `${aRate * 100}%` }} title={`${matchup.modelAName}: ${matchup.modelAWins}`} />
              <div className="bg-slate-500" style={{ width: `${tieRate * 100}%` }} title={`平局: ${matchup.ties}`} />
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
);

const ArenaCoverageMatrix: React.FC<{ bundle: PairwiseInsightBundle }> = ({ bundle }) => {
  const models = bundle.bradleyTerry.models;
  const matchupMap = new Map<string, PairwiseInsightBundle['matchups'][number]>(
    bundle.matchups.map(matchup => [matchup.pairKey, matchup])
  );
  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-white/10 p-4">
        <h2 className="text-lg font-bold text-slate-100">对战覆盖矩阵</h2>
        <p className="mt-1 text-xs text-slate-500">单元格显示该模型对的有效场次与行模型胜场；空白代表尚未观察。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-white/5 text-slate-400">
            <tr>
              <th className="sticky left-0 z-10 bg-[#111316] p-3 text-left">模型</th>
              {models.map(model => <th key={model.modelId} className="min-w-28 p-3 text-center">{model.modelName}</th>)}
            </tr>
          </thead>
          <tbody>
            {models.map(rowModel => (
              <tr key={rowModel.modelId} className="border-t border-white/10">
                <th className="sticky left-0 z-10 bg-[#111316] p-3 text-left text-slate-200">{rowModel.modelName}</th>
                {models.map(columnModel => {
                  if (rowModel.modelId === columnModel.modelId) {
                    return <td key={columnModel.modelId} className="bg-white/5 p-3 text-center text-slate-600">-</td>;
                  }
                  const key = [rowModel.modelId, columnModel.modelId].sort().join('__');
                  const matchup = matchupMap.get(key);
                  if (!matchup) return <td key={columnModel.modelId} className="p-3 text-center text-slate-600">未覆盖</td>;
                  const rowWins = matchup.modelAId === rowModel.modelId ? matchup.modelAWins : matchup.modelBWins;
                  return (
                    <td key={columnModel.modelId} className="p-3 text-center text-slate-300" title={`平局 ${matchup.ties}`}>
                      <div className="font-mono font-bold text-slate-100">{matchup.total} 场</div>
                      <div className="mt-1 text-[10px] text-emerald-300">行胜 {rowWins}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const ArenaDimensionTable: React.FC<{ bundle: PairwiseInsightBundle }> = ({ bundle }) => {
  if (!bundle.dimensions.length) return null;
  return (
    <section className="glass-panel overflow-hidden">
      <div className="border-b border-white/10 p-4">
        <h2 className="text-lg font-bold text-slate-100">按评测维度聚合</h2>
        <p className="mt-1 text-xs text-slate-500">每组至少 5 个 case、10 场有效对战且图连通时才给出 BT 领先模型。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase text-slate-400">
            <tr><th className="p-4">维度</th><th className="p-4">取值</th><th className="p-4">Case</th><th className="p-4">对战</th><th className="p-4">领先模型</th><th className="p-4">状态</th></tr>
          </thead>
          <tbody>
            {bundle.dimensions.map(dimension => (
              <tr key={`${dimension.dimension}-${dimension.value}`} className="border-t border-white/10">
                <td className="p-4 text-slate-200">{dimension.dimension}</td>
                <td className="p-4 text-slate-300">{dimension.value}</td>
                <td className="p-4 text-slate-300">{dimension.itemCount}</td>
                <td className="p-4 text-slate-300">{dimension.battleCount}</td>
                <td className="p-4 font-bold text-amber-300">{dimension.sufficient ? `${dimension.leader} (${formatNumber(dimension.leaderScore || 0, 1)})` : '-'}</td>
                <td className="p-4 text-xs text-slate-400">{dimension.sufficient ? '可读' : dimension.connected ? '样本不足' : '图未连通'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const PairwiseCaseTable: React.FC<{ bundle: PairwiseInsightBundle }> = ({ bundle }) => (
  <section className="glass-panel overflow-hidden">
    <div className="border-b border-white/10 p-4">
      <h2 className="text-lg font-bold text-slate-100">逐 case 对战明细</h2>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left">
        <thead className="bg-white/5 text-xs uppercase text-slate-400">
          <tr>
            <th className="p-4">Case</th>
            <th className="p-4">Prompt</th>
            <th className="p-4">对战模型</th>
            <th className="p-4">产物证据</th>
            <th className="p-4">票数</th>
            <th className="p-4">胜出模型</th>
          </tr>
        </thead>
        <tbody>
          {bundle.cases.map(item => (
            <tr key={item.itemId} className="border-t border-white/10 hover:bg-white/5">
              <td className="p-4 font-mono text-xs text-slate-300">{item.originalItemId}</td>
              <td className="p-4 min-w-[260px] whitespace-pre-wrap text-sm text-slate-300">{item.prompt || '-'}</td>
              <td className="p-4 text-sm text-slate-200">{item.modelAName} vs {item.modelBName}</td>
              <td className="p-4">
                <div className="grid min-w-[300px] grid-cols-2 gap-2">
                  <MiniMedia url={item.representativeOutputs.find(output => output.modelName === item.modelAName)?.url} label={item.modelAName} />
                  <MiniMedia url={item.representativeOutputs.find(output => output.modelName === item.modelBName)?.url} label={item.modelBName} />
                </div>
              </td>
              <td className="p-4 text-sm text-slate-300">{item.modelAName}: {item.votes.A} / 平局: {item.votes.Tie} / {item.modelBName}: {item.votes.B}</td>
              <td className="p-4 text-sm font-bold text-amber-300">{item.winner || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

const AiReportPlaceholder: React.FC = () => (
  <section className="rounded-xl border border-dashed border-purple-400/30 bg-purple-500/5 p-5">
    <div className="mb-2 flex items-center gap-2 text-purple-200">
      <Brain size={18} />
      <h3 className="font-semibold">AI 分析与报告（占位）</h3>
    </div>
    <p className="text-sm text-slate-400">后续可基于本页统计、case 证据、AI judge rationale 和代表性产物生成 Markdown / Word / 飞书报告。</p>
  </section>
);

const ScoreInsightsScreen: React.FC<ScoreInsightsScreenProps> = ({
  mode,
  title,
  description,
  controls,
  items,
  votes,
  models,
  config,
  skippedCount = 0,
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

        {skippedCount > 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            已跳过 {skippedCount} 条；本页统计和导出仅使用有效评审记录。
          </div>
        )}

        {(scoreBundle.summary.itemCount < 5 || scoreBundle.summary.responseCount < 10) && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>样本不足，均分和标准差仅作为方向信号。</div>
          </div>
        )}

        <ScoreConclusion bundle={scoreBundle} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard title="领先模型" value={scoreBundle.summary.topModelName} subtitle={`${formatNumber(scoreBundle.summary.topAverageScore, 2)} 平均分`} icon={<Trophy size={18} />} tone="amber" />
          <StatCard title="样本量" value={scoreBundle.summary.itemCount} subtitle={`${scoreBundle.summary.responseCount} 条模型评分`} icon={<FileText size={18} />} tone="blue" />
          <StatCard title="评委数" value={scoreBundle.summary.voterCount} subtitle="有效评分用户" icon={<Users size={18} />} tone="purple" />
          <StatCard title="评分分歧" value={formatNumber(scoreBundle.summary.averageStdDev, 2)} subtitle="模型平均标准差" icon={<BarChart3 size={18} />} tone="slate" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <ScoreLeaderboard bundle={scoreBundle} />
          <ScoreDimensionPanel bundle={scoreBundle} />
        </div>

        <ScoreCaseGallery bundle={scoreBundle} items={items} />
        <AiReportPlaceholder />
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
              <Download size={16} /> 导出 Arena 榜单
            </button>
            <button onClick={() => downloadTextFile(`pairwise_matchups_${dateTag}.csv`, buildPairwiseMatchupCsv(pairwiseBundle))} className="btn-secondary">
              <Download size={16} /> 导出模型对矩阵
            </button>
            <button onClick={() => downloadTextFile(`pairwise_battles_${dateTag}.csv`, buildPairwiseBattleCsv(pairwiseBundle))} className="btn-secondary">
              <Download size={16} /> 导出原始对战
            </button>
            <button onClick={() => downloadTextFile(`pairwise_cases_${dateTag}.csv`, buildPairwiseCaseCsv(pairwiseBundle))} className="btn-secondary">
              <Download size={16} /> 导出 case 明细
            </button>
            {pairwiseBundle.dimensions.length > 0 && (
              <button onClick={() => downloadTextFile(`pairwise_dimensions_${dateTag}.csv`, buildPairwiseDimensionCsv(pairwiseBundle))} className="btn-secondary">
                <Download size={16} /> 导出维度统计
              </button>
            )}
          </div>
        </div>

        {controls}

        {skippedCount > 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            已跳过 {skippedCount} 条；本页统计和导出仅使用有效评审记录。
          </div>
        )}

        {(pairwiseBundle.summary.comparisonCount < 10 || !pairwiseBundle.summary.connected) && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>{pairwiseBundle.summary.connected ? '样本不足，当前区间仍较宽，请结合更多对战记录判断。' : '对战图尚未连通，暂不生成跨分量总排名；请继续补充连接不同模型分量的对战。'}</div>
          </div>
        )}

        <PairwiseConclusion bundle={pairwiseBundle} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <StatCard title="领先模型" value={pairwiseBundle.summary.topModelName} subtitle={pairwiseBundle.summary.connected ? `${formatNumber(pairwiseBundle.bradleyTerry.models[0]?.rating || 0, 1)} Arena Score` : '等待对战图连通'} icon={<Trophy size={18} />} tone="amber" />
          <StatCard title="模型对覆盖" value={formatPercent(pairwiseBundle.summary.pairCoverage, 1)} subtitle={`${pairwiseBundle.summary.itemCount} 个实际 case`} icon={<Grid3X3 size={18} />} tone="blue" />
          <StatCard title="评委数" value={pairwiseBundle.summary.voterCount} subtitle="有效对战投票用户" icon={<Users size={18} />} tone="purple" />
          <StatCard title="有效样本量" value={formatNumber(pairwiseBundle.summary.effectiveSampleSize, 1)} subtitle={`${pairwiseBundle.summary.comparisonCount} 场原始对战`} icon={<BarChart3 size={18} />} tone="slate" />
        </div>

        <ArenaScoreLeaderboard bundle={pairwiseBundle} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
          <PairwiseLeaderboard bundle={pairwiseBundle} />
          <PairwiseMatrix bundle={pairwiseBundle} />
        </div>

        <ArenaCoverageMatrix bundle={pairwiseBundle} />
        <ArenaDimensionTable bundle={pairwiseBundle} />
        <PairwiseCaseTable bundle={pairwiseBundle} />
        <AiReportPlaceholder />
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
