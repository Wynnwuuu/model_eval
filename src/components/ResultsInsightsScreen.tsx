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
  <h2>Summary</h2>
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
    blue: 'text-blue-300 bg-blue-500/10 border-blue-500/20',
    green: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    red: 'text-red-300 bg-red-500/10 border-red-500/20',
    purple: 'text-purple-300 bg-purple-500/10 border-purple-500/20',
    slate: 'text-slate-200 bg-white/5 border-white/10'
  }[tone];

  return (
    <div className={`rounded-xl border p-4 shadow-sm shadow-black/20 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
        {icon && <div className="text-current opacity-80">{icon}</div>}
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-100">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-slate-400">{subtitle}</div>}
    </div>
  );
};

const IntervalBar: React.FC<{
  label: string;
  point: number;
  lower: number;
  upper: number;
  leftLabel?: string;
  rightLabel?: string;
}> = ({ label, point, lower, upper, leftLabel = '0%', rightLabel = '100%' }) => {
  const left = Math.max(0, lower * 100);
  const width = Math.max(1, (upper - lower) * 100);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span>{formatPercent(point, 1)} CI {formatPercent(lower, 1)} - {formatPercent(upper, 1)}</span>
      </div>
      <div className="relative h-4 rounded-full bg-white/10">
        <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-blue-400/50" style={{ left: `${left}%`, width: `${width}%` }} />
        <div className="absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded bg-blue-200" style={{ left: `${Math.max(0, Math.min(99, point * 100))}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
};

const StackedVoteBar: React.FC<{ votes: Record<VoteType, number>; modelNames: InsightModelNames }> = ({ votes, modelNames }) => {
  const total = votes.A + votes.B + votes.Tie;
  const segments = [
    { key: 'A', label: modelNames.a, value: votes.A, className: 'bg-blue-500' },
    { key: 'Tie', label: '平局', value: votes.Tie, className: 'bg-slate-500' },
    { key: 'B', label: modelNames.b, value: votes.B, className: 'bg-indigo-500' }
  ];
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-white/10">
        {segments.map(segment => (
          <div
            key={segment.key}
            className={segment.className}
            style={{ width: `${safeDivide(segment.value, total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
        {segments.map(segment => (
          <div key={segment.key} className="truncate" title={segment.label}>
            {segment.label}: {segment.value}
          </div>
        ))}
      </div>
    </div>
  );
};

const MiniTrend: React.FC<{
  points: Array<{ timestamp: number; value: number; label: string }>;
  title: string;
}> = ({ points, title }) => {
  const width = 420;
  const height = 120;
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
    const y = height - point.value * height;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <span className="text-xs text-slate-500">{points.length} 个记录点</span>
      </div>
      {points.length > 1 ? (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full overflow-visible">
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="rgba(148,163,184,0.25)" strokeDasharray="4 4" />
          <path d={path} fill="none" stroke="rgb(96,165,250)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => {
            const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
            const y = height - point.value * height;
            return <circle key={`${point.timestamp}-${index}`} cx={x} cy={y} r="3" fill="rgb(191,219,254)" />;
          })}
        </svg>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-slate-500">需要逐票时间戳才能绘制趋势</div>
      )}
    </div>
  );
};

const DimensionRadar: React.FC<{ bundle: InsightBundle; onSelect: (key: string, value: string) => void }> = ({ bundle, onSelect }) => {
  const dimensions = bundle.dimensions.slice(0, 6);
  const size = 220;
  const center = size / 2;
  const radius = 86;
  const values = dimensions.map(item => {
    if (bundle.mode === 'rank') return Math.max(0, (((item as any).agreement ?? 0) + 1) / 2);
    return (item as any).agreementRate || 0;
  });
  const points = values.map((value, index) => {
    const angle = (-Math.PI / 2) + (index / Math.max(dimensions.length, 1)) * Math.PI * 2;
    return `${center + Math.cos(angle) * radius * value},${center + Math.sin(angle) * radius * value}`;
  }).join(' ');

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">维度雷达与分层</h3>
        <span className="text-xs text-slate-500">点击维度筛选证据</span>
      </div>
      {dimensions.length ? (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-56 w-full">
            {[0.25, 0.5, 0.75, 1].map(level => (
              <circle key={level} cx={center} cy={center} r={radius * level} fill="none" stroke="rgba(148,163,184,0.2)" />
            ))}
            {dimensions.map((item, index) => {
              const angle = (-Math.PI / 2) + (index / dimensions.length) * Math.PI * 2;
              const x = center + Math.cos(angle) * radius;
              const y = center + Math.sin(angle) * radius;
              return <line key={`${item.dimensionKey}-${item.dimensionValue}`} x1={center} y1={center} x2={x} y2={y} stroke="rgba(148,163,184,0.18)" />;
            })}
            <polygon points={points} fill="rgba(59,130,246,0.22)" stroke="rgb(96,165,250)" strokeWidth="2" />
          </svg>
          <div className="space-y-2">
            {dimensions.map(item => {
              const score = bundle.mode === 'rank'
                ? (item as any).agreement
                : (item as any).agreementRate;
              return (
                <button
                  key={`${item.dimensionKey}-${item.dimensionValue}`}
                  onClick={() => onSelect(item.dimensionKey, item.dimensionValue)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-sm hover:bg-white/10"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">{item.dimensionKey}: {item.dimensionValue}</span>
                    <span className="text-xs text-slate-500">
                      {item.itemCount} cases
                      {'totalVotes' in item ? ` / ${item.totalVotes} votes` : ` / ${(item as any).rankingRecords} rankings`}
                      {item.smallSample ? ' / 样本不足' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-blue-300">{formatPercent(score, 0)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex h-36 items-center justify-center text-sm text-slate-500">暂无评测维度，分层统计会在有维度字段时自动出现</div>
      )}
    </div>
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
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Pairwise Dominance 热力矩阵</h3>
        <span className="text-xs text-slate-500">单元格=行模型排在列模型前的比例</span>
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
                          className="h-12 w-full rounded-lg border border-white/10 text-center hover:ring-1 hover:ring-blue-300"
                          style={{ background: `rgba(59, 130, 246, ${0.08 + (intensity / 100) * 0.55})` }}
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
    </div>
  );
};

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
    <div className="flex flex-wrap gap-3">
      {outputs.map(output => (
        <div key={`${caseItem.itemId}-${output.modelId}-${output.modelName}`} className="w-[184px] overflow-hidden rounded-lg border border-white/10 bg-white/5">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2.5 py-2">
            <span className="truncate text-xs font-semibold text-slate-200" title={output.modelName}>{output.modelName}</span>
            {output.url && (
              <a href={output.url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white" title="打开产物链接">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
          <div className="h-[104px] bg-black/30">
            <MediaRenderer
              url={output.url}
              isActive={false}
              forceType={caseItem.mediaType === 'video' || caseItem.mediaType === 'image' ? caseItem.mediaType : undefined}
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
  <div className="rounded-xl border border-white/10 bg-white/5">
    <div className="flex items-center justify-between border-b border-white/10 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">样例画廊与证据绑定</h3>
        <p className="text-xs text-slate-500">{filterLabel} / 当前显示 {cases.length} 个 case</p>
      </div>
    </div>
    <div className="max-h-[640px] overflow-y-auto p-4">
      {cases.length ? (
        <div className="space-y-4">
          {cases.map(item => (
            <div key={item.itemId} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-blue-300">{item.itemId}</div>
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
                      <div>获胜者：<span className="font-semibold text-slate-100">{item.winnerLabel}</span></div>
                      <div>共识度：{formatPercent(item.agreementRate, 0)}</div>
                    </>
                  ) : (
                    <>
                      <div>Top：<span className="font-semibold text-slate-100">{item.consensusRanking[0]?.modelName || '-'}</span></div>
                      <div>Kendall τ：{formatNumber(item.kendallTau, 2)}</div>
                    </>
                  )}
                </div>
              </div>

              <EvidenceMediaStrip caseItem={item} />

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-400">人评记录</div>
                  <div className="max-h-28 overflow-y-auto space-y-1 text-xs text-slate-300">
                    {item.humanVotes.length ? item.humanVotes.map((vote, index) => (
                      <div key={`${vote.user}-${vote.timestamp}-${index}`} className="flex justify-between gap-3">
                        <span className="truncate">{vote.user}</span>
                        <span className="shrink-0 text-slate-100">{vote.voteLabel}</span>
                      </div>
                    )) : <span className="text-slate-500">当前数据源没有逐票明细</span>}
                  </div>
                </div>
                <div className="rounded-lg border border-dashed border-white/15 bg-white/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <Brain size={14} /> AI judge rationale
                  </div>
                  <p className="text-xs text-slate-500">占位：未来接入 AI judge 后，这里会绑定该 case 的判定理由、置信度和引用证据。</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex h-48 items-center justify-center text-sm text-slate-500">当前筛选下没有 case</div>
      )}
    </div>
  </div>
);

const getFilterLabel = (filter: CaseFilter) => {
  if (filter.type === 'all') return '全部 case';
  if (filter.type === 'lowConsensus') return '低共识 / 失败样例';
  if (filter.type === 'winner') return `获胜侧：${filter.winner}`;
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

const AbCharts: React.FC<{ bundle: AbInsightBundle; setFilter: (filter: CaseFilter) => void }> = ({ bundle, setFilter }) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">模型榜单与投票分布</h3>
        <div className="flex gap-2 text-xs">
          <button onClick={() => setFilter({ type: 'winner', winner: 'A' })} className="rounded bg-blue-500/10 px-2 py-1 text-blue-300">看 {bundle.models.a} 胜</button>
          <button onClick={() => setFilter({ type: 'winner', winner: 'B' })} className="rounded bg-indigo-500/10 px-2 py-1 text-indigo-300">看 {bundle.models.b} 胜</button>
          <button onClick={() => setFilter({ type: 'winner', winner: 'Tie' })} className="rounded bg-white/10 px-2 py-1 text-slate-300">看平局</button>
        </div>
      </div>
      <StackedVoteBar votes={bundle.summary.votes} modelNames={bundle.models} />
      <div className="mt-5 space-y-3">
        <IntervalBar
          label={`${bundle.models.a} 非平局胜率 Wilson 95% CI`}
          point={bundle.summary.nonTieAShare}
          lower={bundle.summary.confidenceInterval.lower}
          upper={bundle.summary.confidenceInterval.upper}
        />
      </div>
    </div>
    <MiniTrend
      title="趋势图：累计 A/B 偏好变化"
      points={bundle.trend.map(point => ({ timestamp: point.timestamp, value: point.aShare, label: formatPercent(point.aShare) }))}
    />
  </div>
);

const RankCharts: React.FC<{ bundle: Extract<InsightBundle, { mode: 'rank' }>; setFilter: (filter: CaseFilter) => void }> = ({ bundle, setFilter }) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">模型榜单</h3>
        <span className="text-xs text-slate-500">Borda score / 平均名次 / 第一名率</span>
      </div>
      <div className="space-y-3">
        {bundle.models.map((model, index) => {
          const maxScore = Math.max(...bundle.models.map(item => item.totalScore), 1);
          return (
            <div key={model.modelId} className="rounded-lg bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-200">#{index + 1} {model.modelName}</span>
                <span className="text-amber-300">{model.totalScore}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-amber-400" style={{ width: `${safeDivide(model.totalScore, maxScore) * 100}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                <span>avg {model.averageRank.toFixed(2)}</span>
                <span>first {model.firstPlaceCount}</span>
                <span>{formatPercent(model.firstPlaceRate, 0)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    <PairwiseHeatmap
      stats={bundle.pairwise}
      models={bundle.models}
      onSelect={(a, b) => setFilter({ type: 'pairwise', a, b })}
    />
  </div>
);

const AiReportPlaceholder: React.FC = () => (
  <div className="rounded-xl border border-dashed border-purple-400/30 bg-purple-500/5 p-5">
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
  </div>
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

  const isRank = bundle.mode === 'rank';
  const smallSample = bundle.summary.smallSample;

  return (
    <div className="mx-auto max-w-7xl p-6 animate-in fade-in duration-500">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          {onBack && (
            <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10">
              <ArrowLeft size={16} /> {backLabel}
            </button>
          )}
          <h1 className="text-3xl font-bold text-slate-100">{title || '结果洞察'}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            {description || '展示项目评测结果的可信统计、可视化图表、分层分析和 case 证据；AI 分析与报告撰写入口已预留。'}
          </p>
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

      {controls && (
        <div className="mb-6">
          {controls}
        </div>
      )}

      {smallSample && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">样本不足提示</div>
            <p className="mt-1 text-amber-100/80">当前总体或部分分层少于 5 个 case / 10 条有效投票，置信区间与显著性只作为方向信号，不建议单独作为上线结论。</p>
          </div>
        </div>
      )}

      {bundle.mode === 'ab' ? (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="样本量" value={bundle.summary.itemCount} subtitle={`${bundle.summary.totalVotes} 票 / ${bundle.summary.voterCount} 位评委`} icon={<FileText size={18} />} tone="blue" />
          <StatCard title="胜率区间" value={formatPercent(bundle.summary.nonTieAShare, 1)} subtitle={`${bundle.models.a} 非平局胜率，95% CI ${formatPercent(bundle.summary.confidenceInterval.lower, 1)} - ${formatPercent(bundle.summary.confidenceInterval.upper, 1)}`} icon={<Trophy size={18} />} tone="green" />
          <StatCard title="显著性" value={formatPValue(bundle.summary.pValue)} subtitle={getSignificanceLabel(bundle.summary.pValue)} icon={<Activity size={18} />} tone={bundle.summary.pValue !== null && bundle.summary.pValue < 0.05 ? 'green' : 'amber'} />
          <StatCard title="一致性" value={formatPercent(bundle.summary.averageAgreement, 0)} subtitle={`低共识 case ${bundle.summary.lowConsensusCount} 个 / Krippendorff α ${formatNumber(bundle.summary.krippendorffAlpha, 2)}`} icon={<Users size={18} />} tone="purple" />
          <StatCard title="平局率" value={formatPercent(bundle.summary.tieRate, 0)} subtitle={`Margin ${bundle.summary.marginVotes} 票 / ${formatPercent(bundle.summary.marginRate, 0)}`} icon={<BarChart3 size={18} />} tone="slate" />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard title="样本量" value={bundle.summary.itemCount} subtitle={`${bundle.summary.rankingRecords} 条排名 / ${bundle.summary.voterCount} 位评委`} icon={<FileText size={18} />} tone="blue" />
          <StatCard title="榜首模型" value={bundle.summary.bestModel || '-'} subtitle="按 Borda 总分排序" icon={<Trophy size={18} />} tone="amber" />
          <StatCard title="排序一致性" value={formatNumber(bundle.summary.averageKendallTau, 2)} subtitle="平均 pairwise Kendall τ" icon={<Users size={18} />} tone="purple" />
          <StatCard title="低共识 case" value={bundle.summary.lowConsensusCount} subtitle="Kendall τ < 0.3" icon={<AlertTriangle size={18} />} tone={bundle.summary.lowConsensusCount ? 'amber' : 'green'} />
          <StatCard title="Pairwise" value={bundle.pairwise.length} subtitle="模型两两 dominance 统计" icon={<BarChart3 size={18} />} tone="slate" />
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <button onClick={() => setFilter({ type: 'all' })} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/15">全部 case</button>
        <button onClick={() => setFilter({ type: 'lowConsensus' })} className="rounded-lg bg-orange-500/10 px-3 py-2 text-xs font-medium text-orange-300 hover:bg-orange-500/20">低共识 / 失败样例</button>
      </div>

      <div className="mb-6 space-y-4">
        {bundle.mode === 'ab' ? <AbCharts bundle={bundle} setFilter={setFilter} /> : <RankCharts bundle={bundle} setFilter={setFilter} />}
        <DimensionRadar bundle={bundle} onSelect={(key, value) => setFilter({ type: 'dimension', key, value })} />
      </div>

      <div className="mb-6">
        <EvidenceGallery cases={filteredCases as any} filterLabel={getFilterLabel(filter)} />
      </div>

      <AiReportPlaceholder />
    </div>
  );
};

export default ResultsInsightsScreen;
