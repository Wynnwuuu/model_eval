import type { SupportedInsightExportBundle } from '../insightExports';
import { formatPercent, formatNumber, formatPValue } from '../analysisInsights';

export const escapeReportHtml = (value: unknown): string => String(value ?? '')
  .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export const reportPalette = ['#2674bf', '#8661c5', '#198678', '#b96537', '#aa5082', '#63773f'];
const modelColor = (id: string) => {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return reportPalette[hash % reportPalette.length];
};
export const reportNumber = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? '不可计算' : formatNumber(value, digits);
export const reportPercent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '不可计算' : formatPercent(value, 1);
const h = escapeReportHtml;
const finite = (value: number) => Number.isFinite(value) ? value : 0;
export const reportTable = (headers: string[], rows: unknown[][]) => `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th scope="col">${h(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${h(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const reportBars = (rows: Array<{label: string; value: number; detail: string; color?: string}>, maximum?: number) => {
  const max = Math.max(maximum ?? Math.max(...rows.map(row => finite(row.value))), 1);
  return rows.map((row, index) => `<div class="bar-row"><div class="bar-label"><span>${h(row.label)}</span><strong>${h(row.detail)}</strong></div><svg viewBox="0 0 600 12" preserveAspectRatio="none" role="img" aria-label="${h(row.label + '：' + row.detail)}"><rect width="600" height="12" rx="3" fill="#e9eef3"/><rect width="${Math.max(0, Math.min(1, finite(row.value) / max)) * 600}" height="12" rx="3" fill="${row.color || reportPalette[index % reportPalette.length]}"/></svg></div>`).join('');
};
export const reportStack = (rows: Array<{label:string;value:number;color:string}>) => {
  const total = rows.reduce((sum, row) => sum + finite(row.value), 0);
  let position = 0;
  return `<div class="stacked"><svg viewBox="0 0 1000 28" preserveAspectRatio="none" role="img" aria-label="${h(rows.map(row => row.label + ' ' + row.value + ' 票').join('，'))}">${rows.map(row => {
    const width = total ? row.value / total * 1000 : 0;
    const rect = `<rect x="${position}" width="${width}" height="28" fill="${row.color}"/>`;
    position += width;
    return rect;
  }).join('')}</svg><div class="legend">${rows.map(row => `<span style="--key-color:${row.color}">${h(row.label)} <strong>${h(row.value)} 票</strong> · ${total ? reportPercent(row.value / total) : '无数据'}</span>`).join('')}</div></div>`;
};
const confidence = (label: string, share: number, lower: number, upper: number, color: string, denominator: number) => {
  const point = (value: number) => 30 + Math.max(0, Math.min(1, finite(value))) * 540;
  const description = denominator ? `${reportPercent(share)} · Wilson 95% CI ${reportPercent(lower)}–${reportPercent(upper)} · 分母 ${denominator} 非平局票` : '无非平局票，区间不可计算';
  return `<div class="ci-row"><div class="bar-label"><span>${h(label)}</span><strong>${h(description)}</strong></div>${denominator ? `<svg viewBox="0 0 600 56" role="img" aria-label="${h(description)}"><line x1="30" y1="25" x2="570" y2="25" stroke="#d4dde5" stroke-width="2"/><line x1="300" x2="300" y1="7" y2="42" stroke="#8795a5" stroke-dasharray="3 3"/><line x1="${point(lower)}" x2="${point(upper)}" y1="25" y2="25" stroke="${color}" stroke-width="8"/><circle cx="${point(share)}" cy="25" r="6" fill="${color}" stroke="white" stroke-width="2"/></svg><div class="axis"><span>0%</span><span>50% 无偏好</span><span>100%</span></div>` : ''}</div>`;
};
const chart = (title: string, description: string, content: string, wide = false) => `<div class="chart${wide ? ' wide' : ''}"><h3>${h(title)}</h3><p>${h(description)}</p>${content}</div>`;
const matrix = (models: Array<{modelId:string;modelName:string}>, pairs: Array<{a:string;b:string;wins:number;losses:number;ties:number}>) => {
  return `<div class="table-wrap"><table class="matrix"><caption>行模型相对列模型的实际胜 / 负 / 平记录；无对战不视为平局。</caption><thead><tr><th scope="col">行模型 / 列模型</th>${models.map(model => `<th scope="col">${h(model.modelName)}</th>`).join('')}</tr></thead><tbody>${models.map(model => `<tr><th scope="row">${h(model.modelName)}</th>${models.map(other => {
    if (model.modelId === other.modelId) return '<td>—</td>';
    const pair = pairs.find(pair => pair.a === model.modelId && pair.b === other.modelId || pair.b === model.modelId && pair.a === other.modelId);
    if (!pair) return '<td>无对战</td>';
    const wins = pair.a === model.modelId ? pair.wins : pair.losses;
    const losses = pair.a === model.modelId ? pair.losses : pair.wins;
    const total = wins + losses + pair.ties;
    return `<td style="background:${wins > losses ? '#e5f0fa' : wins < losses ? '#f1edf7' : '#f1f3f5'}"><strong>${wins} / ${losses} / ${pair.ties}</strong><small>${total} 次 · 非平局胜率 ${wins + losses ? reportPercent(wins / (wins + losses)) : '不可计算'}</small></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
};

export const buildReportCharts = (bundle: SupportedInsightExportBundle): string => {
  if (bundle.mode === 'ab') {
    const s = bundle.summary;
    const counts = ['A', 'B', 'Tie'].map(side => bundle.cases.filter(item => item.winnerSide === side).length);
    const trend = bundle.trend.filter(point => Number.isFinite(point.timestamp) && point.timestamp > 0);
    let trendChart = '';
    if (trend.length > 1) {
      const min = trend[0].timestamp;
      const span = Math.max(1, trend[trend.length - 1].timestamp - min);
      const line = (key: 'aShare' | 'bShare' | 'tieRate') => trend.map(point => `${30 + (point.timestamp - min) / span * 540},${160 - Math.max(0, Math.min(1, point[key])) * 140}`).join(' ');
      trendChart = chart('累计投票趋势', '反映评审过程中的累计比例变化，不代表模型随时间改进。', `<div class="trend"><svg viewBox="0 0 600 190" role="img" aria-label="累计投票比例随评审时间变化"><line x1="30" x2="570" y1="160" y2="160" stroke="#c1ccd6"/>${(['aShare','bShare','tieRate'] as const).map((key, index) => `<polyline points="${line(key)}" fill="none" stroke="${[reportPalette[0],reportPalette[1],'#8994a3'][index]}" stroke-width="3"/>`).join('')}</svg></div>${reportTable(['时间', '累计票数', bundle.models.a, bundle.models.b, '平局比例'], trend.map(point => [new Date(point.timestamp).toISOString(), point.totalVotes, reportPercent(point.aShare), reportPercent(point.bShare), reportPercent(point.tieRate)]))}`, true);
    }
    return chart('投票分布', `全部有效票 ${s.totalVotes}；平局保留为独立类别。`, reportStack([
      {label:bundle.models.a,value:s.votes.A,color:reportPalette[0]}, {label:bundle.models.b,value:s.votes.B,color:reportPalette[1]}, {label:'平局',value:s.votes.Tie,color:'#8994a3'},
    ])) + chart('非平局胜率与不确定性', '两条区间互为补集；虚线为 50% 无偏好基线。', confidence(bundle.models.a,s.nonTieAShare,s.confidenceInterval.lower,s.confidenceInterval.upper,reportPalette[0],s.nonTieVotes) + confidence(bundle.models.b,s.nonTieBShare,1-s.confidenceInterval.upper,1-s.confidenceInterval.lower,reportPalette[1],s.nonTieVotes))
      + chart('逐 case 胜者分布', '按平台现有 case 共识结果计数，不等同于逐票胜率。', reportBars([
        {label:bundle.models.a,value:counts[0],detail:`${counts[0]} / ${bundle.cases.length} case`},
        {label:bundle.models.b,value:counts[1],detail:`${counts[1]} / ${bundle.cases.length} case`},
        {label:'平局或无明确胜者',value:counts[2],detail:`${counts[2]} / ${bundle.cases.length} case`,color:'#8994a3'},
      ], bundle.cases.length))
      + chart('可信度与评委一致性', '平均多数共识描述集中程度；Alpha 校正偶然一致，两者不能互换。', reportTable(['指标','当前值'], [
        ['双侧二项符号检验 p-value',formatPValue(s.pValue)], ['平均多数共识',reportPercent(s.averageAgreement)], ['Krippendorff’s Alpha',reportNumber(s.krippendorffAlpha,3)], ['低共识 case',s.lowConsensusCount],
      ])) + trendChart;
  }
  if (bundle.mode === 'rank') {
    return chart('Borda 排名', '总分反映当前已收集排名；参与次数不同的模型需同时观察平均名次。', reportBars(bundle.models.map(model => ({label:model.modelName,value:model.totalScore,color:modelColor(model.modelId),detail:model.rankedCount ? `${reportNumber(model.totalScore)} 分 · ${model.rankedCount} 条排名` : '无排名数据'}))))
      + chart('名次、第一名与并列', '共同第一会拆分第一名贡献；并列不会被强行打散。', reportTable(['模型','平均名次','独占第一','共同第一','第一名率','参与排名'], bundle.models.map(model => [model.modelName,reportNumber(model.averageRank),model.outrightFirstCount,model.coFirstCount,reportPercent(model.firstPlaceRate),model.rankedCount])))
      + chart('两两优势矩阵', '由同一条排名中的模型关系派生，不是额外独立投票。', matrix(bundle.models,bundle.pairwise.map(pair=>({a:pair.modelAId,b:pair.modelBId,wins:pair.aWins,losses:pair.bWins,ties:pair.ties}))),true)
      + chart('排序一致性', 'Kendall tau-b 衡量排序方向的一致程度；区分度描述评委是否给出不同名次。',reportTable(['指标','值'],[['平均 Kendall tau-b',reportNumber(bundle.summary.averageKendallTau,3)],['关系一致率',reportPercent(bundle.summary.averageRelationAgreement)],['平均区分度',reportPercent(bundle.summary.averageDistinctionRate)],['含并列排名',bundle.summary.tieBallots],['全部并列排名',bundle.summary.allTieBallots]]));
  }
  if (bundle.mode === 'score') {
    return chart('模型平均加权分', '沿用评分配置的权重归一化；分值越高越好。每模型记录数分别列出。',reportBars(bundle.models.map(model=>({label:model.modelName,value:model.averageScore,color:modelColor(model.modelId),detail:model.responseCount ? `${reportNumber(model.averageScore)} 分 · ${model.responseCount} 条评分` : '无评分数据'}))))
      + chart('评分分布摘要', '标准差是评分离散程度，不是置信区间；单条评分的标准差没有稳定解释。',reportTable(['模型','平均加权分','中位数','标准差','评分记录'],bundle.models.map(model=>[model.modelName,model.responseCount?reportNumber(model.averageScore):'无数据',model.responseCount?reportNumber(model.medianScore):'无数据',model.responseCount>1?reportNumber(model.stdDev):'不可估计（少于 2 条）',model.responseCount])))
      + bundle.dimensions.map(dimension=>chart(`评分维度：${dimension.dimensionName}`,`原始维度分，不是加权贡献；配置权重 ${dimension.weight}。`,reportBars(dimension.modelAverages.map(model=>({label:model.modelName,value:model.averageScore,color:modelColor(model.modelId),detail:model.responseCount ? `${reportNumber(model.averageScore)} 分 · ${model.responseCount} 条` : '无评分数据'})) ))).join('');
  }
  const bt = bundle.bradleyTerry;
  return (!bundle.summary.connected ? '<p class="notice wide">对战图不连通：不同连通分量之间不能直接比较模型强弱；以下保留分量编号，不宣称全局胜者。</p>' : '')
    + (bundle.summary.maturity !== 'ready' ? '<p class="notice wide">样本尚不足以形成稳定榜单。当前排名仅描述已收集对战，请结合区间和覆盖度。</p>' : '')
    + chart('Bradley–Terry 模型强度', '沿用平台当前估计及区间，不以原始胜率替代模型强度。',reportBars(bt.models.map(model=>({label:`${model.modelName} · 分量 ${model.component}`,value:model.battles ? model.rating : 0,color:modelColor(model.modelId),detail:model.battles ? `${reportNumber(model.rating,1)} · 95% 区间 ${reportNumber(model.ratingLower,1)}–${reportNumber(model.ratingUpper,1)}` : '无对战数据'}))))
    + chart('对战覆盖', '实际记录与用于估计的有效样本量分别呈现。',reportTable(['指标','值'],[['实际对战记录',bundle.summary.comparisonCount],['模型对覆盖率',reportPercent(bundle.summary.pairCoverage)],['连通分量',bt.componentCount],['有效样本量',reportNumber(bundle.summary.effectiveSampleSize)],['评委数',bundle.summary.voterCount]]))
    + chart('实际对战矩阵', '每个单元格表示行模型相对列模型的胜负平，未对战不填零胜率。',matrix(bundle.models,bundle.matchups.map(pair=>({a:pair.modelAId,b:pair.modelBId,wins:pair.modelAWins,losses:pair.modelBWins,ties:pair.ties}))),true)
    + chart('胜负平记录', '原始计数不经过模型强度估计；平局独立保留。',reportTable(['模型','胜','负','平','对战数','非平局胜率'],bundle.models.map(model=>[model.modelName,model.wins,model.losses,model.ties,model.total,model.wins+model.losses?reportPercent(model.nonTieWinRate):'不可计算'])),true);
};

export const buildReportDimensions = (bundle: SupportedInsightExportBundle) => {
  const note = '<p class="muted">多值标签按现有规则拆分。一个 case 可以属于多个分组，分组样本数不可直接相加；已应用的筛选按 AND 条件组合。</p>';
  if (!bundle.dimensions.length) return note + '<p class="empty">没有可展示的维度分组。</p>';
  if (bundle.mode === 'ab') return note + bundle.dimensions.map(row => chart(`${row.dimensionKey} · ${row.dimensionValue}`,`${row.itemCount} case / ${row.totalVotes} 票${row.smallSample?' · 样本不足':''}；当前结果：${row.winnerLabel}`,reportStack([{label:bundle.models.a,value:row.votes.A,color:reportPalette[0]},{label:bundle.models.b,value:row.votes.B,color:reportPalette[1]},{label:'平局',value:row.votes.Tie,color:'#8994a3'}]))).join('');
  if (bundle.mode === 'rank') return note + bundle.dimensions.map(row=>chart(`${row.dimensionKey} · ${row.dimensionValue}`,`${row.itemCount} case / ${row.rankingRecords} 条排名${row.smallSample?' · 样本不足':''}`,reportBars(row.modelStats.map(model=>({label:model.modelName,value:model.totalScore,color:modelColor(model.modelId),detail:`Borda ${reportNumber(model.totalScore)} · 平均名次 ${reportNumber(model.averageRank)} · ${model.rankedCount} 条`}))))).join('');
  if (bundle.mode === 'score') return '<p class="muted">以下是评分 Rubric 维度，不是 case 标签分层；当前评分统计模块尚未提供 case 标签分层估计。标签保留在案例中并可筛选。</p>' + reportTable(['评分维度','权重','模型','原始维度均分','评分数'],bundle.dimensions.flatMap(row=>row.modelAverages.map(model=>[row.dimensionName,row.weight,model.modelName,reportNumber(model.averageScore),model.responseCount])));
  return note + reportTable(['维度','取值','case','对战记录','领先模型','强度分','状态'],bundle.dimensions.map(row=>[row.dimension,row.value,row.itemCount,row.battleCount,row.connected?row.leader:'不作跨分量比较',row.connected?reportNumber(row.leaderScore):'不可比较',!row.connected?'对战图不连通':row.sufficient?'数据可用':'样本不足']));
};
