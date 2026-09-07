import { buildCaseEvidenceViewModels } from '../caseEvidence';
import type { CaseEvidenceViewModel } from '../caseEvidence';
import { getDimensionOptionEntries, type DimensionOptionSelection } from '../dimensionUtils';
import { buildInsightArtifactFilename, resolveCaseExportIdentity, type InsightExportRequest } from '../insightExports';
import { buildAbTopSummary, buildRankTopSummary, buildScoreTopSummary, buildPairwiseTopSummary } from '../insightPresentation';
import { getEvaluationMethodShortLabel } from '../evaluationMethods';
import { getModelOutputsForItem, resolveEvaluationItemPrompt } from '../rankingUtils';
import type { VoteRecord } from '../types';
import { reportStyles, reportScript } from './insightReportAssets';
import { escapeReportHtml as h, buildReportCharts, buildReportDimensions, reportTable } from './insightReportCharts';

export interface InsightHtmlReportRequest extends InsightExportRequest {
  report?: {
    originalItemCount?: number;
    skippedCount?: number | null;
    dimensionSelection?: DimensionOptionSelection;
  };
}

export const resolveReportMediaUrl = (source: unknown, depth = 0): string => {
  const raw = String(source ?? '').trim();
  if (!raw || depth > 3) return '';
  try {
    const url = new URL(raw, 'https://report.invalid');
    if (url.pathname === '/api/media-proxy') return resolveReportMediaUrl(url.searchParams.get('url'), depth + 1);
    if (url.pathname.startsWith('/media-proxy/')) return resolveReportMediaUrl('https://vidmuse.sandcdn.com/' + url.pathname.slice('/media-proxy/'.length) + url.search, depth + 1);
    if (url.pathname.startsWith('/media-dev-proxy/')) return resolveReportMediaUrl('https://vidmuse-dev.sandcdn.com/' + url.pathname.slice('/media-dev-proxy/'.length) + url.search, depth + 1);
    if (!/^https?:\/\//i.test(raw) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '[::1]' || host === '0.0.0.0' || /^127\./.test(host)) return '';
    // Return the source verbatim: reconstructing a signed query can invalidate its signature.
    return raw;
  } catch {
    return '';
  }
};

const mediaKind = (url: string, declared?: string): 'image' | 'video' | 'audio' | 'text' | 'link' => {
  if (['image', 'video', 'audio', 'text'].includes(declared || '')) return declared as 'image' | 'video' | 'audio' | 'text';
  const path = url.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif|bmp|svg)$/.test(path)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(path)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(path)) return 'audio';
  return 'link';
};

const renderMedia = (source: string, label: string, declared?: string) => {
  if (declared === 'text') return `<div class="text-output">${h(source || '未提供文本产物')}</div>`;
  const url = resolveReportMediaUrl(source);
  if (!url) return `<div class="empty">${source ? '未提供可携带的媒体地址；本机代理、临时地址或不安全链接未导出。' : '未提供产物'}</div>`;
  const kind = mediaKind(url, declared);
  const link = `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">打开原链接</a><span class="print-link">${h(url)}</span>`;
  if (kind === 'link') return `<div class="empty">未指定可预览的媒体类型。${link}</div>`;
  const native = (enhanced: boolean) => kind === 'image'
    ? `<img ${enhanced ? 'data-src' : 'src'}="${h(url)}" alt="${h(label)}" ${enhanced ? '' : 'loading="lazy"'} referrerpolicy="no-referrer">`
    : `<${kind} ${enhanced ? 'data-src' : 'src'}="${h(url)}" aria-label="${h(label)}" controls preload="metadata" ${kind === 'video' ? 'playsinline' : ''}></${kind}>`;
  return `<figure class="media-frame" data-media-state="idle"><div class="media-stage"><span class="media-placeholder" aria-hidden="true">媒体预览</span>${native(true)}${kind === 'image' ? '<button type="button" data-zoom aria-label="放大图片">放大</button>' : ''}</div><figcaption><span class="media-status">媒体联网加载</span><button type="button" data-retry hidden>重试</button>${link}</figcaption><noscript><div class="media-stage">${native(false)}</div></noscript></figure>`;
};
const safeTimestamp = (timestamp?: number) => timestamp && Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : '时间未提供';
const reviewerName = (name: string) => /@/.test(name) ? '评委（未提供姓名）' : name || '匿名评委';

const renderCase = (entry: CaseEvidenceViewModel, request: InsightHtmlReportRequest) => {
  const item = request.items.find(item => item.id === entry.itemId || item.id === entry.originalItemId || item.originalItemId === entry.originalItemId);
  const vote = request.votes?.find(vote => vote.itemId === entry.itemId || vote.itemId === entry.originalItemId || vote.pairContext?.originalItemId === entry.originalItemId);
  const historical = vote?.evaluatedItemSnapshot && (vote.contentUpdatedAfterVote || !item) ? vote.evaluatedItemSnapshot : undefined;
  const identity = resolveCaseExportIdentity({ item, vote, items: request.items, fallbackCaseId: entry.originalItemId || entry.itemId });
  const dimensions = getDimensionOptionEntries(entry.dimensionValues).map(([key,value]) => key + '：' + value);
  const prompt = historical?.prompt || entry.prompt || '未提供 Prompt';
  const outputs = entry.outputs.map((output,index) => {
    const previous = historical?.modelOutputs?.find(candidate => candidate.modelId === output.modelId || candidate.modelName === output.modelName);
    return { ...output, url: previous?.url || (historical && entry.method === 'ab' && index < 2 ? index === 0 ? historical.modelA_Url : historical.modelB_Url : '') || output.url };
  });
  const references = [...new Set([...(historical?.referenceUrls || entry.referenceUrls), historical?.startImageUrl || item?.startImageUrl || ''].filter(Boolean))];
  const promptHtml = prompt.length > 350
    ? `<p class="prompt prompt-preview">${h(prompt.slice(0,350))}…</p><details><summary>完整 Prompt（${prompt.length} 字符）</summary><p class="prompt prompt-full">${h(prompt)}</p></details>`
    : `<p class="prompt">${h(prompt)}</p>`;
  return {
    order: identity.caseIndex === '' ? Number.MAX_SAFE_INTEGER : identity.caseIndex,
    id: identity.caseId,
    html: `<article class="case-report" data-case-id="${h(identity.caseId)}" data-search="${h((identity.caseId + ' ' + prompt).toLocaleLowerCase())}" data-outcome="${h(entry.outcomeLabel)}" data-dimensions="${h(JSON.stringify(dimensions))}">
      <header><div><small>原始序号 ${identity.caseIndex === '' ? '未提供' : identity.caseIndex}</small><h3>${h(identity.caseId)}</h3></div><div class="case-result"><strong>${h(entry.outcomeLabel)}</strong><div>${h(entry.outcomeDetail)}</div></div></header>
      <div class="chips">${dimensions.map(value=>`<span class="chip">${h(value)}</span>`).join('')}</div>${promptHtml}
      <div class="case-metrics">${entry.metrics.map(metric=>`<span>${h(metric.label)}：<strong>${h(metric.value)}</strong></span>`).join('')}</div>
      ${historical ? '<p class="muted">此 case 内容在评审后发生变化或已被移除；以下展示评测时保存的产物与 Prompt。</p>' : ''}
      <div class="outputs">${outputs.map(output=>`<div class="output"><div class="output-title">${h(output.rankLabel ? output.rankLabel + ' · ' : '')}${h(output.modelName)}</div>${output.metricLabel ? `<p class="output-note">${h(output.metricLabel)}</p>` : ''}${renderMedia(output.url, output.modelName, historical?.type || entry.mediaType)}</div>`).join('')}</div>
      ${references.length ? `<details><summary>参考素材（${references.length}）</summary><div class="reference-grid">${references.map((url,index)=>renderMedia(url,`参考素材 ${index + 1}`)).join('')}</div></details>` : ''}
      <details><summary>逐评委记录与反馈（${entry.reviews.length}）</summary>${entry.reviews.length ? `<ul class="review-list">${entry.reviews.map(review=>`<li><strong>${h(reviewerName(review.reviewer))}</strong> <small>${h(safeTimestamp(review.timestamp))}</small><p>${h(review.summary)}</p>${review.details.map(detail=>`<p>${h(detail)}</p>`).join('')}</li>`).join('')}</ul>` : '<p class="muted">未提供原始逐票记录，不能从汇总数还原评审证据。</p>'}</details>
    </article>`,
  };
};

export const countReportSkippedVotes = (votes: VoteRecord[] | undefined, itemIds: Set<string>, dimensionActive: boolean, fallback?: number): number | null => {
  if (!votes) return dimensionActive ? null : fallback ?? null;
  return votes.filter(vote => vote.choice === 'skipped' && (!dimensionActive || itemIds.has(vote.itemId) || itemIds.has(vote.pairContext?.originalItemId || ''))).length;
};

export const buildInsightHtmlReport = (request: InsightHtmlReportRequest): string => {
  const { bundle, context } = request;
  const report = request.report || {};
  const totalCases = request.items.length;
  const top = bundle.mode === 'ab' ? buildAbTopSummary(bundle,totalCases)
    : bundle.mode === 'rank' ? buildRankTopSummary(bundle,totalCases)
    : bundle.mode === 'score' ? buildScoreTopSummary(bundle,totalCases) : buildPairwiseTopSummary(bundle,totalCases);
  top.metrics = top.metrics.map(metric => ({...metric,value:metric.value.replace('p = <','p <')}));
  if (bundle.mode === 'ab' && bundle.summary.nonTieVotes === 0) {
    top.metrics = top.metrics.map(metric => metric.id === 'confidence'
      ? {...metric,value:'不可计算',secondary:'无非平局投票，无法估计偏好区间或检验差异'}
      : metric.id === 'lead' ? {...metric,secondary:'无非平局投票；平局保留在分布中'} : metric);
  }
  const validCount = bundle.mode === 'ab' ? bundle.summary.totalVotes : bundle.mode === 'rank' ? bundle.summary.rankingRecords : bundle.mode === 'score' ? bundle.summary.responseCount : bundle.summary.comparisonCount;
  const entries = buildCaseEvidenceViewModels({bundle,items:request.items,votes:request.votes});
  const represented = new Set(entries.flatMap(entry => [entry.itemId, entry.originalItemId]));
  const models = bundle.mode === 'ab'
    ? [{id:'model-0',name:bundle.models.a},{id:'model-1',name:bundle.models.b}]
    : bundle.models.map(model=>({id:model.modelId,name:model.modelName}));
  request.items.forEach((item,index) => {
    if (represented.has(item.id) || item.originalItemId && represented.has(item.originalItemId)) return;
    entries.push({
      method: bundle.mode, itemId:item.id, originalItemId:item.originalItemId || item.id, itemOrder:item.itemOrder ?? index,
      prompt:resolveEvaluationItemPrompt(item), dimensionValues:item.dimensionValues || {}, mediaType:item.type,
      outcomeLabel:'暂无有效评审',outcomeDetail:'本 case 尚无纳入当前范围的有效记录，不推断胜负。',
      metrics:[],outputs:getModelOutputsForItem({...item,modelA_Url:item.modelA_Url || '',modelB_Url:item.modelB_Url || '',type:item.type || 'unknown'},models),referenceUrls:item.referenceUrls || [],reviews:[],
    });
  });
  const cases = entries.map(entry=>renderCase(entry,request)).sort((a,b)=>a.order-b.order || a.id.localeCompare(b.id,undefined,{numeric:true}));
  const outcomes = [...new Set(entries.map(entry=>entry.outcomeLabel))];
  const dimensionOptions = [...new Set(entries.flatMap(entry=>getDimensionOptionEntries(entry.dimensionValues).map(([key,value])=>key+'：'+value)))];
  const selection = Object.entries(report.dimensionSelection || {}).flatMap(([key,values])=>values.map(value=>key+'：'+value)).join(' AND ');
  const exportedAt = context.exportedAt || new Date().toISOString();
  const methodLabel = getEvaluationMethodShortLabel(context.evaluationMethod);
  const skipLabel = report.skippedCount == null ? '未提供同范围跳过数' : `${report.skippedCount} 条跳过（不纳入有效统计）`;
  const metadata = [context.projectName || '未绑定项目',context.materialName || '未命名评测物料',methodLabel,context.reviewerScopeLabel || (context.reviewerScope==='mine'?'我的结果':'全员汇总')];
  const methods = top.metrics.map(metric=>`<div class="method" id="method-${h(metric.id)}"><h3>${h(metric.label)}</h3><p>${h(metric.detail.meaning)}</p><p>${h(metric.id === 'coverage' ? 'case 按有效记录中的用例标识去重；评委数沿用平台稳定身份统计。评分响应按模型计数，同一评委评价多个模型会贡献多个评分响应；排名按一次完整排名计数，对战按一次提交计数。' : metric.detail.calculation)}</p><dl>${metric.detail.inputs.map(input=>`<dt>${h(input.label)}</dt><dd>${h(input.value)}</dd>`).join('')}</dl>${metric.detail.limitation?`<p class="muted">${h(metric.detail.limitation)}</p>`:''}</div>`).join('');
  const configuration = bundle.mode === 'score' ? reportTable(['评分维度','权重','配置'],(bundle.config.dimensions || []).map(dimension=>[dimension.name,dimension.weight,JSON.stringify(dimension.scale || {})])) : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${h(context.materialName)} · 可视化评测报告</title><style>${reportStyles}</style></head><body>
    <header><div class="container"><p class="eyebrow">MANUEVAL / EVALUATION REPORT</p><h1>${h(context.materialName || '评测结果')} · 可视化报告</h1><div class="report-meta">${metadata.map(value=>`<span>${h(value)}</span>`).join('')}<span>导出时间 ${h(exportedAt)}</span></div><nav aria-label="报告目录"><a href="#report-summary">结果结论</a><a href="#charts">统计图表</a><a href="#dimensions">维度分析</a><a href="#cases">逐 case 对照</a><a href="#methodology">统计说明</a></nav></div></header>
    <main class="container"><section id="report-summary"><div class="conclusion"><h2>${h(validCount ? top.headline : '暂无有效评审记录')}</h2>${validCount ? `<p class="basis">${h(top.basis)}</p><p class="muted">${h(top.supporting)}</p>` : '<p class="muted">当前范围没有可用于统计的有效评审记录，不推断模型优劣。</p>'}</div>
    <p class="muted" style="margin-top:20px">维度筛选：${h(selection || '全部')}。筛选前 ${report.originalItemCount ?? totalCases} case，纳入 ${totalCases} case；${h(skipLabel)}。</p>
    ${validCount ? `<div class="metrics">${top.metrics.map(metric=>`<div class="metric"><small>${h(metric.label)}</small><strong>${h(metric.value)}</strong><p class="muted">${h(metric.secondary)}</p><a href="#method-${h(metric.id)}">计算与解释</a></div>`).join('')}</div>` : ''}
    </section><section id="charts"><h2>主要统计图表</h2>${validCount?'<div class="charts">'+buildReportCharts(bundle)+'</div>':'<p class="empty">无数据，图表不可计算。</p>'}</section>
    <section id="dimensions"><h2>维度分析</h2>${buildReportDimensions(bundle)}</section>
    <section id="cases"><div class="section-heading"><h2>逐 case 产物对照</h2><small>${cases.length} 条案例证据</small></div><p class="muted">以下筛选只影响案例展示，不改变本报告统计。媒体需要联网访问，访问权限或链接有效期可能限制预览。</p>
    <div class="case-toolbar"><label>Case ID / Prompt 搜索<input id="case-search" type="search" placeholder="搜索案例" autocomplete="off"></label><label>案例结果<select id="case-outcome"><option value="">全部结果</option>${outcomes.map(value=>`<option value="${h(value)}">${h(value)}</option>`).join('')}</select></label><label>案例维度<select id="case-dimension"><option value="">全部维度</option>${dimensionOptions.map(value=>`<option value="${h(value)}">${h(value)}</option>`).join('')}</select></label><button type="button" id="reset-cases">恢复全部</button></div><p id="case-count" role="status">显示 ${cases.length} / ${cases.length} 条案例；上方统计保持导出时范围。</p>
    ${cases.map(entry=>entry.html).join('') || '<p class="empty">没有纳入报告的案例。</p>'}</section>
    <section id="methodology"><h2>统计说明与适用限制</h2><p class="muted">本报告是导出时的固定数据快照。统计复用平台现有计算，不随案例浏览筛选或后续投票更新；跳过记录不纳入有效统计，缺失逐票数据不作补造。</p><div class="method-grid">${methods}</div>${configuration}
    ${bundle.mode==='ab'?'<p class="notice">置信区间和显著性检验沿用逐票二项模型；同一 case 的多评委记录可能相关，当前方法未做 case 聚类校正。p-value 不是模型更好的概率，也不代表实际效果大小。Alpha 为偶然一致校正后的系数，不应与平均多数共识百分比比较大小。</p>':''}
    ${bundle.mode==='rank'?'<p class="notice">排名拆出的模型对共享原始排名记录，并非独立样本；Borda、平均名次和第一名次数需结合参与记录数解读。单评委或没有可比较排序时，一致性不可计算。</p>':''}
    </section><footer>ManuEval · 统计与图表可离线阅读；产物仍使用来源链接。本文件包含评测内容与可读评审记录，请仅向有权查看的人分享。</footer></main>
    <dialog id="media-dialog" aria-label="图片放大预览"><button type="button" aria-label="关闭图片预览">关闭</button><img alt=""></dialog><noscript><p class="container">脚本已禁用，报告正文、图表和全部案例仍可阅读；搜索和放大不可用。</p></noscript><script>${reportScript}</script></body></html>`;
};

export const downloadInsightHtmlReport = (request: InsightHtmlReportRequest) => {
  const html = buildInsightHtmlReport(request);
  const filename = buildInsightArtifactFilename(request.context,'可视化报告','html');
  const url = URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor);
  anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
};
