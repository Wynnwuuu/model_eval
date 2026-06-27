import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Brain,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Gauge,
  Target,
  Trophy,
  Users
} from 'lucide-react';
import { AggregatedResult, EvaluationItem, VoteRecord, VoteType } from '../types';
import {
  AbCaseInsight,
  AbInsightBundle,
  InsightBundle,
  InsightModelNames,
  PairwiseComparisonStat,
  RankCaseInsight,
  RawAbVoteRow,
  buildAbInsights,
  buildEvidenceJson,
  buildInsightDimensionCsv,
  buildInsightSummaryCsv,
  buildRankInsights,
  formatNumber,
  formatPValue,
  formatPercent,
  getSignificanceLabel,
  safeDivide
} from '../analysisInsights';
import { getDimensionEntries, formatDimensionValues } from '../dimensionUtils';
import MediaRenderer from './MediaRenderer';

type InsightItem = Partial<EvaluationItem> & { id: string; originalData?: Record<string, any> };

interface ResultsInsightsScreenProps {
  mode: 'ab' | 'rank';
  title?: string;
  description?: React.ReactNode;
  controls?: React.ReactNode;
  items: InsightItem[];
  votes?: VoteRecord[];
  aggregatedData?: AggregatedResult[];
  rawVoteRows?: RawAbVoteRow[];
  modelNames?: InsightModelNames;
  models?: { id: string; name: string }[];
  skippedCount?: number;
  onBack?: () => void;
  backLabel?: string;
}

type CaseFilter =
  | { type: 'all' }
  | { type: 'lowConsensus' }
  | { type: 'winner'; winner: VoteType }
  | { type: 'dimension'; key: string; value: string }
  | { type: 'pairwise'; a: string; b: string };

const downloadTextFile = (filename: string, content: string, mimeType: string) => {
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

const escapeHtml = (value: any) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildHtmlSnapshot = (bundle: InsightBundle) => {
  const title = bundle.mode === 'rank' ? 'Arena-rank 结果洞察' : 'A/B 结果洞察';
  const caseRows = bundle.cases.map(item => `
    <tr>
      <td>${escapeHtml(item.itemId)}</td>
      <td>${escapeHtml(item.prompt)}</td>
      <td>${escapeHtml(formatDimensionValues(item.dimensionValues))}</td>
      <td>${escapeHtml(JSON.stringify(item.metrics))}</td>
      <td>${escapeHtml(item.representativeOutputs.map(output => `${output.modelName}: ${output.url}`).join(' | '))}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
    h1 { margin-bottom: 4px; }
    .meta { color: #6b7280; margin-bottom: 24px; }
    pre { background: #f3f4f6; padding: 16px; border-radius: 8px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">导出时间：${new Date().toISOString()}</div>
  <h2>核心结论</h2>
  <pre>${escapeHtml(JSON.stringify(bundle.summary, null, 2))}</pre>
  <h2>Case Evidence</h2>
  <table>
    <thead><tr><th>ItemID</th><th>Prompt</th><th>Dimensions</th><th>Metrics</th><th>Outputs</th></tr></thead>
    <tbody>${caseRows}</tbody>
  </table>
</body>
</html>`;
};

const StatCard: React.FC<{
  title: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate';
}> = ({ title, value, subtitle, icon, tone = 'slate' }) => {
  const toneClass = {
    blue: 'text-blue-200 bg-blue-500/10 border-blue-400/20',
    green: 'text-emerald-200 bg-emerald-500/10 border-emerald-400/20',
    amber: 'text-amber-200 bg-amber-500/10 border-amber-400/20',
    red: 'text-red-200 bg-red-500/10 border-red-400/20',
    purple: 'text-purple-200 bg-purple-500/10 border-purple-400/20',
    slate: 'text-slate-200 bg-white/5 border-white/10'
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
  tone?: 'green' | 'amber' | 'slate';
}> = ({ eyebrow, title, subtitle, meta, tone = 'amber' }) => {
  const toneClass = tone === 'green'
    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
    : tone === 'amber'
      ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
      : 'border-white/10 bg-white/5 text-slate-100';

  return (
    <section className={`rounded-2xl border p-5 shadow-lg shadow-black/20 ${toneClass}`}>
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-current/70">{eyebrow}</div>
      <div className="mt-3 text-3xl font-black tracking-tight text-slate-50">{title}</div>
      <div className="mt-2 max-w-4xl text-sm leading-6 text-current/85">{subtitle}</div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-current/85">{meta}</div>
    </section>
  );
};

const Chip: React.FC<{ children: React.ReactNode; tone?: 'blue' | 'amber' | 'green' | 'slate' }> = ({ children, tone = 'slate' }) => {
  const toneClass = {
    blue: 'bg-blue-500/10 text-blue-200 border-blue-400/20',
    amber: 'bg-amber-500/10 text-amber-200 border-amber-400/20',
    green: 'bg-emerald-500/10 text-emerald-200 border-emerald-400/20',
    slate: 'bg-white/10 text-slate-300 border-white/10'
  }[tone];
  return <span className={`rounded-full border px-2.5 py-1 ${toneClass}`}>{children}</span>;
};

const getAbConclusionTone = (bundle: AbInsightBundle) => {
  if (bundle.summary.smallSample || bundle.summary.winnerSide === 'Tie') return 'amber';
  return bundle.summary.pValue !== null && bundle.summary.pValue < 0.05 ? 'green' : 'amber';
};

const AbConclusion: React.FC<{ bundle: AbInsightBundle }> = ({ bundle }) => {
  const winnerIsTie = bundle.summary.winnerSide === 'Tie';
  const winnerText = winnerIsTie ? '暂未分出明确胜负' : bundle.summary.winnerLabel;
  const winnerVotes = winnerIsTie ? '-' : `${bundle.summary.winnerVotes} 票`;
  const nonTieShare = bundle.summary.winnerSide === 'B'
    ? bundle.summary.nonTieBShare
    : bundle.summary.nonTieAShare;

  return (
    <ConclusionPanel
      eyebrow="A/B 偏好结论"
      title={winnerText}
      subtitle={
        winnerIsTie
          ? '当前投票分布未形成单一胜出模型，请优先查看平局比例、低共识 case 和维度分层。'
          : `${bundle.summary.conclusion}。${bundle.summary.winnerLabel} 在非平局投票中的占比为 ${formatPercent(nonTieShare, 1)}，胜出依据为 ${winnerVotes}、p-value ${formatPValue(bundle.summary.pValue)}。`
      }
      meta={
        <>
          <Chip tone="blue">{bundle.models.a}: {bundle.summary.votes.A} 票</Chip>
          <Chip tone="blue">{bundle.models.b}: {bundle.summary.votes.B} 票</Chip>
          <Chip>平局: {bundle.summary.votes.Tie} 票</Chip>
          <Chip tone={bundle.summary.smallSample ? 'amber' : 'green'}>
            {bundle.summary.smallSample ? '样本不足' : getSignificanceLabel(bundle.summary.pValue)}
          </Chip>
        </>
      }
      tone={getAbConclusionTone(bundle)}
    />
  );
};

const RankConclusion: React.FC<{ bundle: Extract<InsightBundle, { mode: 'rank' }> }> = ({ bundle }) => {
  const champion = bundle.models[0];
  return (
    <ConclusionPanel
      eyebrow="Arena-rank 排名结论"
      title={champion?.modelName || '暂无冠军模型'}
      subtitle={
        champion
          ? `${champion.modelName} 当前 Borda 总分最高，平均名次 ${formatNumber(champion.averageRank, 2)}，第一名率 ${formatPercent(champion.firstPlaceRate, 1)}。排序一致性为 ${formatNumber(bundle.summary.averageKendallTau, 2)}，请结合 pairwise 矩阵和低共识 case 判断稳定性。`
          : '当前没有足够的有效排序记录生成冠军结论。'
      }
      meta={
        <>
          <Chip tone="amber">排名记录: {bundle.summary.rankingRecords}</Chip>
          <Chip tone="blue">评委数: {bundle.summary.voterCount}</Chip>
          <Chip tone={bundle.summary.smallSample ? 'amber' : 'green'}>
            {bundle.summary.smallSample ? '样本不足' : '样本量可读'}
          </Chip>
          <Chip>低共识 case: {bundle.summary.lowConsensusCount}</Chip>
        </>
      }
      tone={bundle.summary.smallSample ? 'amber' : 'green'}
    />
  );
};

const AbModelComparison: React.FC<{ bundle: AbInsightBundle }> = ({ bundle }) => {
  const rows = [
    {
      label: bundle.models.a,
      votes: bundle.summary.votes.A,
      share: bundle.summary.aShare,
      nonTieShare: bundle.summary.nonTieAShare,
      className: 'bg-blue-400'
    },
    {
      label: bundle.models.b,
      votes: bundle.summary.votes.B,
      share: bundle.summary.bShare,
      nonTieShare: bundle.summary.nonTieBShare,
      className: 'bg-indigo-400'
    }
  ];

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">模型胜率对比</h3>
        <span className="text-xs text-slate-500">非平局胜率更适合判断偏好方向</span>
      </div>
      <div className="space-y-4">
        {rows.map(row => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-semibold text-slate-200" title={row.label}>{row.label}</span>
              <span className="shrink-0 text-slate-400">{row.votes} 票 / {formatPercent(row.nonTieShare, 1)}</span>
            </div>
            <Meter value={row.nonTieShare} className={row.className} />
            <div className="mt-1 text-[11px] text-slate-500">总票占比 {formatPercent(row.share, 1)}</div>
          </div>
        ))}
        <div>
          <div className="mb-1 flex items-center justify-between text-sm text-slate-300">
            <span>平局</span>
            <span>{bundle.summary.votes.Tie} 票 / {formatPercent(bundle.summary.tieRate, 1)}</span>
          </div>
          <Meter value={bundle.summary.tieRate} className="bg-slate-400" />
        </div>
      </div>
    </section>
  );
};

const AbCaseDistribution: React.FC<{ bundle: AbInsightBundle; setFilter: (filter: CaseFilter) => void }> = ({ bundle, setFilter }) => {
  const counts = bundle.cases.reduce((acc, item) => {
    acc[item.winnerSide] += 1;
    return acc;
  }, { A: 0, B: 0, Tie: 0 } as Record<VoteType, number>);
  const total = Math.max(bundle.cases.length, 1);
  const rows = [
    { side: 'A' as VoteType, label: `${bundle.models.a} 胜出的 case`, count: counts.A, color: 'bg-blue-400' },
    { side: 'B' as VoteType, label: `${bundle.models.b} 胜出的 case`, count: counts.B, color: 'bg-indigo-400' },
    { side: 'Tie' as VoteType, label: '平局或无明确胜者', count: counts.Tie, color: 'bg-slate-400' }
  ];

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">逐 case 胜者分布</h3>
        <button onClick={() => setFilter({ type: 'lowConsensus' })} className="text-xs font-medium text-amber-300 hover:text-amber-200">
          查看低共识 case
        </button>
      </div>
      <div className="space-y-3">
        {rows.map(row => (
          <button
            key={row.side}
            onClick={() => setFilter({ type: 'winner', winner: row.side })}
            className="block w-full rounded-lg border border-white/10 bg-black/20 p-3 text-left hover:bg-white/10"
          >
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-slate-200">{row.label}</span>
              <span className="font-mono text-slate-300">{row.count}/{bundle.cases.length}</span>
            </div>
            <Meter value={row.count / total} className={row.color} />
          </button>
        ))}
      </div>
    </section>
  );
};

const ConfidencePanel: React.FC<{ bundle: AbInsightBundle }> = ({ bundle }) => (
  <section className="rounded-xl border border-white/10 bg-white/5 p-4">
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-slate-100">可信统计</h3>
      <p className="mt-1 text-xs text-slate-500">Wilson 置信区间基于非平局票，显著性检验基于 A/B 胜负票。</p>
    </div>
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex justify-between text-xs text-slate-300">
          <span>{bundle.models.a} 非平局胜率</span>
          <span>{formatPercent(bundle.summary.nonTieAShare, 1)} CI {formatPercent(bundle.summary.confidenceInterval.lower, 1)} - {formatPercent(bundle.summary.confidenceInterval.upper, 1)}</span>
        </div>
        <div className="relative h-4 rounded-full bg-white/10">
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-blue-400/50"
            style={{
              left: `${bundle.summary.confidenceInterval.lower * 100}%`,
              width: `${Math.max(1, (bundle.summary.confidenceInterval.upper - bundle.summary.confidenceInterval.lower) * 100)}%`
            }}
          />
          <div
            className="absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded bg-blue-100"
            style={{ left: `${Math.max(0, Math.min(99, bundle.summary.nonTieAShare * 100))}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-black/20 p-3">
          <div className="text-slate-500">p-value</div>
          <div className="mt-1 text-lg font-bold text-slate-100">{formatPValue(bundle.summary.pValue)}</div>
        </div>
        <div className="rounded-lg bg-black/20 p-3">
          <div className="text-slate-500">评委一致性</div>
          <div className="mt-1 text-lg font-bold text-slate-100">{formatPercent(bundle.summary.averageAgreement, 0)}</div>
        </div>
      </div>
    </div>
  </section>
);

const AbCharts: React.FC<{ bundle: AbInsightBundle; setFilter: (filter: CaseFilter) => void }> = ({ bundle, setFilter }) => (
  <div className="grid gap-4 xl:grid-cols-3">
    <AbModelComparison bundle={bundle} />
    <ConfidencePanel bundle={bundle} />
    <AbCaseDistribution bundle={bundle} setFilter={setFilter} />
  </div>
);

const RankLeaderboard: React.FC<{ bundle: Extract<InsightBundle, { mode: 'rank' }> }> = ({ bundle }) => {
  const maxScore = Math.max(...bundle.models.map(model => model.totalScore), 1);
  return (
    <section className="rounded-xl border border-white/10 bg-white/5">
      <div className="border-b border-white/10 p-4">
        <h3 className="text-sm font-semibold text-slate-100">模型排名榜单</h3>
        <p className="mt-1 text-xs text-slate-500">Borda 总分越高越好，平均名次越低越好。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase text-slate-400">
            <tr>
              <th className="p-3">排名</th>
              <th className="p-3">模型名</th>
              <th className="p-3">Borda 总分</th>
              <th className="p-3">平均名次</th>
              <th className="p-3">第一名次数</th>
              <th className="p-3">第一名率</th>
              <th className="p-3">参与排名数</th>
            </tr>
          </thead>
          <tbody>
            {bundle.models.map((model, index) => (
              <tr key={model.modelId} className="border-t border-white/10 hover:bg-white/5">
                <td className="p-3 font-mono text-amber-300">#{index + 1}</td>
                <td className="p-3 font-bold text-slate-100">{model.modelName}</td>
                <td className="p-3">
                  <div className="mb-1 font-semibold text-slate-200">{model.totalScore}</div>
                  <Meter value={safeDivide(model.totalScore, maxScore)} className="bg-amber-400" />
                </td>
                <td className="p-3 text-slate-300">{formatNumber(model.averageRank, 2)}</td>
                <td className="p-3 text-slate-300">{model.firstPlaceCount}</td>
                <td className="p-3 text-slate-300">{formatPercent(model.firstPlaceRate, 1)}</td>
                <td className="p-3 text-slate-300">{model.rankedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const PairwiseHeatmap: React.FC<{
  stats: PairwiseComparisonStat[];
  models: { modelId: string; modelName: string }[];
  onSelect: (a: string, b: string) => void;
}> = ({ stats, models, onSelect }) => {
  const getCell = (rowId: string, colId: string) => {
    if (rowId === colId) return null;
    const direct = stats.find(item => item.modelAId === rowId && item.modelBId === colId);
    if (direct) return { share: direct.aShare, total: direct.total, pValue: direct.pValue };
    const reverse = stats.find(item => item.modelAId === colId && item.modelBId === rowId);
    if (reverse) return { share: 1 - reverse.aShare, total: reverse.total, pValue: reverse.pValue };
    return null;
  };

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-100">Pairwise dominance 热力矩阵</h3>
        <p className="mt-1 text-xs text-slate-500">每个单元格表示“行模型排在列模型前”的比例。</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-xs">
          <thead>
            <tr>
              <th className="p-2 text-slate-500">模型</th>
              {models.map(model => <th key={model.modelId} className="p-2 text-slate-400">{model.modelName}</th>)}
            </tr>
          </thead>
          <tbody>
            {models.map(row => (
              <tr key={row.modelId}>
                <td className="p-2 font-semibold text-slate-300">{row.modelName}</td>
                {models.map(col => {
                  const cell = getCell(row.modelId, col.modelId);
                  const intensity = cell ? Math.round(cell.share * 100) : 0;
                  return (
                    <td key={col.modelId} className="p-1">
                      {row.modelId === col.modelId ? (
                        <div className="h-12 rounded-lg bg-white/5" />
                      ) : (
                        <button
                          onClick={() => onSelect(row.modelId, col.modelId)}
                          className="h-12 w-full rounded-lg border border-white/10 text-center hover:ring-1 hover:ring-amber-300"
                          style={{ background: `rgba(251, 191, 36, ${0.08 + (intensity / 100) * 0.5})` }}
                          title={`p=${formatPValue(cell?.pValue)} / n=${cell?.total || 0}`}
                        >
                          <div className="font-semibold text-slate-100">{cell ? `${intensity}%` : '-'}</div>
                          <div className="text-[10px] text-slate-400">n={cell?.total || 0}</div>
                        </button>
                      )}
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

const RankCharts: React.FC<{ bundle: Extract<InsightBundle, { mode: 'rank' }>; setFilter: (filter: CaseFilter) => void }> = ({ bundle, setFilter }) => (
  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
    <RankLeaderboard bundle={bundle} />
    <PairwiseHeatmap
      stats={bundle.pairwise}
      models={bundle.models}
      onSelect={(a, b) => setFilter({ type: 'pairwise', a, b })}
    />
  </div>
);

const DimensionTable: React.FC<{ bundle: InsightBundle; onSelect: (key: string, value: string) => void }> = ({ bundle, onSelect }) => (
  <section className="rounded-xl border border-white/10 bg-white/5">
    <div className="border-b border-white/10 p-4">
      <h3 className="text-sm font-semibold text-slate-100">按评测维度聚合</h3>
      <p className="mt-1 text-xs text-slate-500">用于定位模型在场景、能力、难度等维度上的差异。</p>
    </div>
    {bundle.dimensions.length ? (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase text-slate-400">
            <tr>
              <th className="p-3">维度</th>
              <th className="p-3">取值</th>
              <th className="p-3">Case</th>
              <th className="p-3">{bundle.mode === 'rank' ? '排名记录' : '投票数'}</th>
              <th className="p-3">{bundle.mode === 'rank' ? '领先模型' : '胜出模型'}</th>
              <th className="p-3">{bundle.mode === 'rank' ? '一致性' : '共识度'}</th>
              <th className="p-3">样本提示</th>
            </tr>
          </thead>
          <tbody>
            {bundle.dimensions.map(item => {
              const isRank = bundle.mode === 'rank';
              const score = isRank ? (item as any).agreement : (item as any).agreementRate;
              const records = isRank ? (item as any).rankingRecords : (item as any).totalVotes;
              const winner = isRank ? (item as any).leadingModel : (item as any).winnerLabel;
              return (
                <tr key={`${item.dimensionKey}-${item.dimensionValue}`} className="border-t border-white/10 hover:bg-white/5">
                  <td className="p-3 text-slate-300">{item.dimensionKey}</td>
                  <td className="p-3">
                    <button onClick={() => onSelect(item.dimensionKey, item.dimensionValue)} className="font-semibold text-amber-200 hover:text-amber-100">
                      {item.dimensionValue}
                    </button>
                  </td>
                  <td className="p-3 text-slate-300">{item.itemCount}</td>
                  <td className="p-3 text-slate-300">{records}</td>
                  <td className="p-3 font-semibold text-slate-100">{winner || '-'}</td>
                  <td className="p-3 text-slate-300">{score === null || score === undefined ? '-' : formatPercent(score, 0)}</td>
                  <td className="p-3">
                    {item.smallSample ? <Chip tone="amber">样本不足</Chip> : <Chip tone="green">可读</Chip>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="flex h-32 items-center justify-center text-sm text-slate-500">暂无评测维度，分层统计会在有维度字段时自动出现。</div>
    )}
  </section>
);

const EvidenceMediaStrip: React.FC<{ caseItem: AbCaseInsight | RankCaseInsight }> = ({ caseItem }) => {
  const outputs = caseItem.representativeOutputs.length
    ? caseItem.representativeOutputs
    : 'modelA' in caseItem
      ? [caseItem.modelA, caseItem.modelB].filter(output => output.url)
      : [];

  if (!outputs.length) {
    return <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-center text-xs text-slate-500">暂无可预览产物链接</div>;
  }

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}
    >
      {outputs.map(output => (
        <div key={`${caseItem.itemId}-${output.modelId}-${output.modelName}`} className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
            <span className="truncate text-sm font-semibold text-slate-100" title={output.modelName}>{output.modelName}</span>
            {output.url && (
              <a href={output.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white" title="打开产物链接">
                <ExternalLink size={15} />
              </a>
            )}
          </div>
          <div
            className="w-full bg-black/40"
            style={{ height: 'clamp(220px, 28vw, 460px)' }}
          >
            <MediaRenderer
              url={output.url}
              isActive={false}
              forceType={caseItem.mediaType === 'video' || caseItem.mediaType === 'image' || caseItem.mediaType === 'audio' ? caseItem.mediaType : undefined}
              videoPreload="metadata"
              className="rounded-none border-0 shadow-none"
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const EvidenceGallery: React.FC<{
  cases: Array<AbCaseInsight | RankCaseInsight>;
  filterLabel: string;
}> = ({ cases, filterLabel }) => (
  <section className="rounded-xl border border-white/10 bg-white/5">
    <div className="flex items-center justify-between border-b border-white/10 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-100">Case 证据与代表性产物</h3>
        <p className="text-xs text-slate-500">{filterLabel} / 当前显示 {cases.length} 个 case</p>
      </div>
    </div>
    <div className="p-4">
      {cases.length ? (
        <div className="space-y-4">
          {cases.map(item => (
            <article key={item.itemId} className="rounded-xl border border-white/10 bg-black/20 p-4 lg:p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-amber-300">{item.itemId}</div>
                  <div className="mt-1 max-w-3xl whitespace-pre-wrap break-words text-sm text-slate-200">{item.prompt || '-'}</div>
                  {getDimensionEntries(item.dimensionValues).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {getDimensionEntries(item.dimensionValues).map(([key, value]) => (
                        <span key={`${key}-${value}`} className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-slate-300">{key}: {value}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-right text-xs text-slate-300">
                  {'winnerLabel' in item ? (
                    <>
                      <div>胜出模型：<span className="font-semibold text-slate-100">{item.winnerLabel}</span></div>
                      <div>共识度：{formatPercent(item.agreementRate, 0)}</div>
                      <div className="mt-1 text-slate-500">{item.modelA.modelName}: {item.votes.A} / {item.modelB.modelName}: {item.votes.B} / 平局: {item.votes.Tie}</div>
                    </>
                  ) : (
                    <>
                      <div>共识第一：<span className="font-semibold text-slate-100">{item.consensusRanking[0]?.modelName || '-'}</span></div>
                      <div>Kendall tau：{formatNumber(item.kendallTau, 2)}</div>
                    </>
                  )}
                </div>
              </div>

              <EvidenceMediaStrip caseItem={item} />

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-400">人工评审记录</div>
                  <div className="max-h-28 space-y-1 overflow-y-auto text-xs text-slate-300">
                    {item.humanVotes.length ? item.humanVotes.map((vote, index) => (
                      <div key={`${vote.user}-${vote.timestamp}-${index}`} className="flex justify-between gap-3">
                        <span className="truncate">{vote.user}</span>
                        <span className="shrink-0 text-slate-100">{vote.voteLabel}</span>
                      </div>
                    )) : <span className="text-slate-500">当前数据源没有逐条投票明细</span>}
                  </div>
                </div>
                <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <Brain size={14} /> AI judge rationale
                  </div>
                  <p className="text-xs text-slate-500">占位：未来接入 AI judge 后，这里会绑定该 case 的判定理由、置信度和引用证据。</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">当前筛选下没有 case</div>
      )}
    </div>
  </section>
);

const getFilterLabel = (filter: CaseFilter, bundle: InsightBundle) => {
  if (filter.type === 'all') return '全部 case';
  if (filter.type === 'lowConsensus') return '低共识 / 高分歧 case';
  if (filter.type === 'winner' && bundle.mode === 'ab') {
    if (filter.winner === 'A') return `${bundle.models.a} 胜出的 case`;
    if (filter.winner === 'B') return `${bundle.models.b} 胜出的 case`;
    return '平局或无明确胜者的 case';
  }
  if (filter.type === 'dimension') return `${filter.key}: ${filter.value}`;
  return 'Pairwise 证据筛选';
};

const filterCases = (bundle: InsightBundle, filter: CaseFilter) => {
  if (filter.type === 'all') return bundle.cases;
  if (filter.type === 'dimension') {
    return bundle.cases.filter(item => item.dimensionValues?.[filter.key] === filter.value);
  }
  if (bundle.mode === 'ab') {
    if (filter.type === 'lowConsensus') return bundle.cases.filter(item => item.agreementRate < 0.6);
    if (filter.type === 'winner') return bundle.cases.filter(item => item.winnerSide === filter.winner);
    return bundle.cases;
  }
  if (filter.type === 'lowConsensus') return bundle.cases.filter(item => item.kendallTau !== null && item.kendallTau < 0.3);
  if (filter.type === 'pairwise') {
    return bundle.cases.filter(item => item.rankings.some(ranking => {
      const a = ranking.find(entry => entry.modelId === filter.a);
      const b = ranking.find(entry => entry.modelId === filter.b);
      return a && b;
    }));
  }
  return bundle.cases;
};

const AiReportPlaceholder: React.FC = () => (
  <section className="rounded-xl border border-dashed border-purple-400/30 bg-purple-500/5 p-5">
    <div className="mb-3 flex items-center gap-2 text-purple-200">
      <Brain size={18} />
      <h3 className="font-semibold">AI 分析与报告（占位）</h3>
    </div>
    <div className="grid gap-3 text-sm text-slate-400 md:grid-cols-3">
      <div className="rounded-lg bg-black/20 p-3">
        <div className="font-semibold text-slate-200">可选输入</div>
        <p className="mt-1 text-xs">人工评测、AI 评测、AI+人工混合结果，以及本页导出的证据包。</p>
      </div>
      <div className="rounded-lg bg-black/20 p-3">
        <div className="font-semibold text-slate-200">证据绑定</div>
        <p className="mt-1 text-xs">样本 ID、图表、投票记录、AI judge rationale、代表性产物、显著性与置信区间。</p>
      </div>
      <div className="rounded-lg bg-black/20 p-3">
        <div className="font-semibold text-slate-200">未来输出</div>
        <p className="mt-1 text-xs">Markdown / Word / 飞书文档报告、可编辑协作草稿、目标导向的多任务聚合报告。</p>
      </div>
    </div>
  </section>
);

const ResultsInsightsScreen: React.FC<ResultsInsightsScreenProps> = ({
  mode,
  title,
  description,
  controls,
  items,
  votes = [],
  aggregatedData = [],
  rawVoteRows = [],
  modelNames,
  models = [],
  skippedCount = 0,
  onBack,
  backLabel = '返回结果明细'
}) => {
  const [filter, setFilter] = useState<CaseFilter>({ type: 'all' });
  const bundle = useMemo<InsightBundle>(() => {
    if (mode === 'rank') {
      return buildRankInsights({ items: items as any, votes, models });
    }
    return buildAbInsights({ items, votes, aggregatedData, rawVoteRows, modelNames });
  }, [mode, items, votes, aggregatedData, rawVoteRows, modelNames, models]);

  const filteredCases = filterCases(bundle, filter);
  const dateTag = new Date().toISOString().slice(0, 10);
  const exportSummary = () => downloadTextFile(`insights_summary_${bundle.mode}_${dateTag}.csv`, buildInsightSummaryCsv(bundle), 'text/csv;charset=utf-8;');
  const exportDimensions = () => downloadTextFile(`insights_dimensions_${bundle.mode}_${dateTag}.csv`, buildInsightDimensionCsv(bundle), 'text/csv;charset=utf-8;');
  const exportEvidence = () => downloadTextFile(`case_evidence_${bundle.mode}_${dateTag}.json`, buildEvidenceJson(bundle), 'application/json;charset=utf-8;');
  const exportHtml = () => downloadTextFile(`insights_snapshot_${bundle.mode}_${dateTag}.html`, buildHtmlSnapshot(bundle), 'text/html;charset=utf-8;');

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {onBack && (
            <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10">
              <ArrowLeft size={16} /> {backLabel}
            </button>
          )}
          <h1 className="text-3xl font-bold text-slate-100">{title || '结果洞察'}</h1>
          <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {description || '先给出模型结论，再展示可信统计、可视化图表、维度分层和 case 证据。'}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={exportSummary} className="inline-flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 text-xs font-medium text-white hover:bg-white/10">
            <Download size={14} /> 汇总 CSV
          </button>
          <button onClick={exportDimensions} className="inline-flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 text-xs font-medium text-white hover:bg-white/10">
            <Download size={14} /> 维度 CSV
          </button>
          <button onClick={exportEvidence} className="inline-flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 text-xs font-medium text-white hover:bg-white/10">
            <FileJson size={14} /> 证据 JSON
          </button>
          <button onClick={exportHtml} className="inline-flex items-center gap-2 rounded-lg bg-black/40 px-3 py-2 text-xs font-medium text-white hover:bg-white/10">
            <FileText size={14} /> HTML 快照
          </button>
        </div>
      </div>

      {controls}

      {skippedCount > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          已跳过 {skippedCount} 条；本页统计和导出仅使用有效评审记录。
        </div>
      )}

      {bundle.summary.smallSample && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">样本不足提示</div>
            <p className="mt-1 text-amber-100/80">当前总体或部分分层少于 5 个 case / 10 条有效评审，置信区间与显著性仅作为方向信号。</p>
          </div>
        </div>
      )}

      {bundle.mode === 'ab' ? <AbConclusion bundle={bundle} /> : <RankConclusion bundle={bundle} />}

      {bundle.mode === 'ab' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="胜出模型" value={bundle.summary.winnerLabel} subtitle={`${bundle.summary.winnerVotes} 票 / ${formatPercent(bundle.summary.winnerRate, 1)}`} icon={<Trophy size={18} />} tone={bundle.summary.winnerSide === 'Tie' ? 'amber' : 'green'} />
          <StatCard title="样本量" value={bundle.summary.itemCount} subtitle={`${bundle.summary.totalVotes} 票 / ${bundle.summary.voterCount} 位评委`} icon={<FileText size={18} />} tone="blue" />
          <StatCard title="显著性" value={formatPValue(bundle.summary.pValue)} subtitle={getSignificanceLabel(bundle.summary.pValue)} icon={<Activity size={18} />} tone={bundle.summary.pValue !== null && bundle.summary.pValue < 0.05 ? 'green' : 'amber'} />
          <StatCard title="一致性" value={formatPercent(bundle.summary.averageAgreement, 0)} subtitle={`低共识 case ${bundle.summary.lowConsensusCount} 个 / Alpha ${formatNumber(bundle.summary.krippendorffAlpha, 2)}`} icon={<Users size={18} />} tone="purple" />
          <StatCard title="平局比例" value={formatPercent(bundle.summary.tieRate, 0)} subtitle={`Margin ${bundle.summary.marginVotes} 票 / ${formatPercent(bundle.summary.marginRate, 0)}`} icon={<Gauge size={18} />} tone="slate" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="总冠军" value={bundle.summary.bestModel || '-'} subtitle="按 Borda 总分排序" icon={<Trophy size={18} />} tone="amber" />
          <StatCard title="样本量" value={bundle.summary.itemCount} subtitle={`${bundle.summary.rankingRecords} 条排序 / ${bundle.summary.voterCount} 位评委`} icon={<FileText size={18} />} tone="blue" />
          <StatCard title="排序一致性" value={formatNumber(bundle.summary.averageKendallTau, 2)} subtitle="平均 pairwise Kendall tau" icon={<Users size={18} />} tone="purple" />
          <StatCard title="低共识 case" value={bundle.summary.lowConsensusCount} subtitle="Kendall tau < 0.3" icon={<AlertTriangle size={18} />} tone={bundle.summary.lowConsensusCount ? 'amber' : 'green'} />
          <StatCard title="模型对比" value={bundle.pairwise.length} subtitle="两两 dominance 统计" icon={<Target size={18} />} tone="slate" />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter({ type: 'all' })} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/15">全部 case</button>
        <button onClick={() => setFilter({ type: 'lowConsensus' })} className="rounded-lg bg-orange-500/10 px-3 py-2 text-xs font-medium text-orange-300 hover:bg-orange-500/20">低共识 / 高分歧</button>
        {bundle.mode === 'ab' && (
          <>
            <button onClick={() => setFilter({ type: 'winner', winner: 'A' })} className="rounded-lg bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-200 hover:bg-blue-500/20">看 {bundle.models.a} 胜</button>
            <button onClick={() => setFilter({ type: 'winner', winner: 'B' })} className="rounded-lg bg-indigo-500/10 px-3 py-2 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20">看 {bundle.models.b} 胜</button>
            <button onClick={() => setFilter({ type: 'winner', winner: 'Tie' })} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/15">看平局</button>
          </>
        )}
      </div>

      {bundle.mode === 'ab' ? <AbCharts bundle={bundle} setFilter={setFilter} /> : <RankCharts bundle={bundle} setFilter={setFilter} />}
      <DimensionTable bundle={bundle} onSelect={(key, value) => setFilter({ type: 'dimension', key, value })} />
      <EvidenceGallery cases={filteredCases as any} filterLabel={getFilterLabel(filter, bundle)} />
      <AiReportPlaceholder />
    </div>
  );
};

export default ResultsInsightsScreen;
