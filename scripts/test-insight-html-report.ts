import assert from 'node:assert/strict';
import { buildInsightHtmlReport, countReportSkippedVotes, resolveReportMediaUrl } from '../src/reports/insightHtmlReport';
import { itemMatchesDimensionOptions } from '../src/dimensionUtils';
import { buildInsightArtifactFilename, buildInsightEvidenceJson } from '../src/insightExports';
import { buildRankInsights } from '../src/analysisInsights';
import { buildScoreInsights, buildPairwiseInsights } from '../src/scoringInsights';
import { makeAbReportRequest, makeReportRequests, reportItems, reportVotes } from './fixtures/insightReportFixtures';

const request = makeAbReportRequest();
const html = buildInsightHtmlReport({ ...request, report: { originalItemCount: 40, skippedCount: 2, dimensionSelection: {} } });
assert.match(html, /<svg/);
assert.match(html, /72 票/);
assert.match(html, /17 票/);
assert.match(html, /10 票/);
assert.match(html, /80\.9%/);
assert.match(html, /71\.5%/);
assert.match(html, /87\.7%/);
assert.match(html, /平均多数共识/);
assert.match(html, /Alpha/);
assert.match(html, /产物质量评测/);
assert.match(html, /全员汇总/);
assert.equal((html.match(/class="case-report"/g) || []).length, 33);
assert(html.indexOf('data-case-id="case-003"') < html.indexOf('data-case-id="case-011"'));
assert.doesNotMatch(html, /private-key-|reviewerKey|<script[^>]+src=/);
assert.match(html, /data-src="https:\/\/report-media.test\/a.png"/);
assert.match(html, /构图完整/);

for (const request of makeReportRequests()) {
  const document = buildInsightHtmlReport(request);
  assert.match(document, /<svg/);
  assert.match(document, /id="methodology"/);
  assert.match(document, /id="cases"/);
  assert.doesNotMatch(document, /NaN|Infinity|private-key-/);
}
const mine = makeAbReportRequest(reportItems, reportVotes.filter(v => v.user === '评委1'));
const mineHtml = buildInsightHtmlReport({ ...mine, context: { ...mine.context, reviewerScope: 'mine', reviewerScopeLabel: '我的结果' } });
assert.match(mineHtml, /我的结果/);
assert.doesNotMatch(mineHtml, /评委2|评委3/);
const empty = buildInsightHtmlReport(makeAbReportRequest([], []));
assert.match(empty, /暂无有效评审记录/);
assert.doesNotMatch(empty, /当前领先|NaN|Infinity/);

const unsafe = structuredClone(request);
unsafe.context.materialName = '</script><script>alert(1)</script>';
unsafe.bundle.cases[0].prompt = '<img src=x onerror=alert(2)>';
const escaped = buildInsightHtmlReport(unsafe);
assert.doesNotMatch(escaped, /<script>alert\(1\)|<img src=x/);
assert.match(escaped, /&lt;img/);
assert.equal(resolveReportMediaUrl('javascript:alert(1)'), '');
assert.equal(resolveReportMediaUrl('blob:https://app.test/temporary'), '');
assert.equal(resolveReportMediaUrl('http://localhost:3000/media.png'), '');
assert.equal(resolveReportMediaUrl('/api/media-proxy?url=https%3A%2F%2Fcdn.test%2Fa.mp4%3Fx%3D1%26sig%3Dabc'), 'https://cdn.test/a.mp4?x=1&sig=abc');
assert.equal(resolveReportMediaUrl('https://cdn.test/a.png?x=1&sig=a%2Bb'), 'https://cdn.test/a.png?x=1&sig=a%2Bb');
const dimensionSelection = { signal_tags:['visual_edit','identity_consistency'] };
const dimensionItems = reportItems.filter(item=>itemMatchesDimensionOptions(item.dimensionValues,dimensionSelection));
const dimensionIds = new Set(dimensionItems.map(item=>item.id));
const dimensionRequest = makeAbReportRequest(dimensionItems, reportVotes.filter(vote=>dimensionIds.has(vote.itemId)));
const filteredHtml = buildInsightHtmlReport({...dimensionRequest,report:{dimensionSelection,originalItemCount:33,skippedCount:1}});
assert.equal((filteredHtml.match(/class="case-report"/g)||[]).length,17);
assert.match(filteredHtml,/signal_tags：visual_edit AND signal_tags：identity_consistency/);
assert.match(filteredHtml,/筛选前 33 case，纳入 17 case/);
assert.doesNotMatch(filteredHtml,/data-case-id="case-002"/);
const skips = [reportItems[0],reportItems[1]].map(item=>({...reportVotes[0],itemId:item.id,choice:'skipped' as const}));
assert.equal(countReportSkippedVotes(skips,dimensionIds,true),1);
assert.equal(countReportSkippedVotes(skips,dimensionIds,false),2);
assert.equal(countReportSkippedVotes(undefined,dimensionIds,true,2),null);
assert.equal(countReportSkippedVotes([],dimensionIds,true),0);

assert.equal(request.bundle.mode,'ab');
if (request.bundle.mode==='ab') {
  const evidence = JSON.parse(buildInsightEvidenceJson({...request,bundle:request.bundle}));
  assert.deepEqual(evidence.summary,request.bundle.summary);
  assert.equal(evidence.cases.length,33);
  for (const item of reportItems) assert(html.includes(`data-case-id="${item.originalItemId}"`));
}
assert.match(buildInsightArtifactFilename(request.context,'可视化报告','html'),/视觉生成对照_A-B_全员汇总_可视化报告_2026-09-07\.html/);
const withPending = makeAbReportRequest(reportItems,reportVotes.filter(vote=>vote.itemId!==reportItems[32].id));
const pendingHtml = buildInsightHtmlReport(withPending);
assert.equal((pendingHtml.match(/class="case-report"/g)||[]).length,33);
assert.match(pendingHtml,/暂无有效评审/);
assert.match(pendingHtml,/data-case-id="case-033"/);

const historic = structuredClone(request);
historic.votes![0].contentUpdatedAfterVote = true;
historic.votes![0].evaluatedItemSnapshot!.prompt = '评测时旧版 Prompt';
historic.votes![0].evaluatedItemSnapshot!.modelOutputs![0].url = 'https://cdn.test/evaluated.png?token=signed';
const historicalHtml = buildInsightHtmlReport(historic);
assert.match(historicalHtml,/评测时旧版 Prompt/);
assert.match(historicalHtml,/https:\/\/cdn.test\/evaluated.png\?token=signed/);
const missingEvidence = structuredClone(request);
missingEvidence.votes = [];
if (missingEvidence.bundle.mode==='ab') missingEvidence.bundle.cases.forEach(item=>item.humanVotes=[]);
assert.match(buildInsightHtmlReport(missingEvidence),/未提供原始逐票记录/);
assert.doesNotMatch(buildInsightHtmlReport(missingEvidence),/<li><strong>评委/);
for (const fixture of makeReportRequests()) {
  const bundle = fixture.bundle.mode === 'ab' ? makeAbReportRequest([],[]).bundle
    : fixture.bundle.mode === 'rank' ? buildRankInsights({items:[],votes:[],models:[]})
    : fixture.bundle.mode === 'score' ? buildScoreInsights({items:[],votes:[],models:[],config:fixture.bundle.config})
    : buildPairwiseInsights({items:[],votes:[],models:[]});
  const emptyReport = buildInsightHtmlReport({...fixture,bundle,items:[],votes:[]});
  assert.match(emptyReport,/暂无有效评审记录/);
  assert.doesNotMatch(emptyReport,/NaN|Infinity/);
}
const tiedVotes = reportVotes.slice(0,3).map(vote=>({...vote,vote:'Tie' as const}));
const allTieReport = buildInsightHtmlReport(makeAbReportRequest(reportItems.slice(0,1),tiedVotes));
assert.match(allTieReport,/无非平局投票，无法估计偏好区间或检验差异/);
assert.doesNotMatch(allTieReport,/当前领先/);
console.log('Visual HTML report regression checks passed.');
