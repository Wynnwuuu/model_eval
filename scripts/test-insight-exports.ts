import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { buildAbInsights, buildRankInsights } from '../src/analysisInsights';
import {
  buildInsightDetailCsv,
  buildInsightEvidenceJson,
  buildInsightWorkbookBuffer,
  type InsightExportContext,
} from '../src/insightExports';
import { buildPairwiseInsights, buildScoreInsights } from '../src/scoringInsights';
import type { EvaluationConfig, EvaluationItem, VoteRecord } from '../src/types';

const taskItemId = 'task-rank:row-1';
const models = [
  { id: 'a', name: 'Wan 3.0' },
  { id: 'b', name: 'Seedance 2.0' },
  { id: 'c', name: 'Minimax H3' },
];
const item: EvaluationItem = {
  id: taskItemId,
  originalItemId: 'case-001',
  sourceDatasetItemId: 'dataset-row-uuid',
  sourceDatasetVersion: 4,
  itemOrder: 2,
  prompt: '=HYPERLINK("https://example.com","unsafe")',
  dimensionValues: { 场景: '横向测评' },
  modelA_Url: 'https://example.com/a.mp4',
  modelB_Url: 'https://example.com/b.mp4',
  modelOutputs: models.map(model => ({
    modelId: model.id,
    modelName: model.name,
    url: `https://example.com/${model.id}.mp4`,
  })),
  referenceUrls: ['https://example.com/reference.png'],
  type: 'video',
};

const snapshot = {
  itemId: taskItemId,
  originalItemId: item.originalItemId,
  sourceDatasetItemId: item.sourceDatasetItemId,
  sourceDatasetVersion: 3,
  itemOrder: item.itemOrder,
  prompt: item.prompt,
  dimensionValues: item.dimensionValues,
  modelOutputs: item.modelOutputs,
  type: item.type,
};

const rankVotes: VoteRecord[] = [
  {
    itemId: taskItemId,
    method: 'rank_order',
    timestamp: Date.parse('2026-08-19T01:00:00.000Z'),
    user: '评委甲',
    ranking: [
      { modelId: 'a', modelName: models[0].name, rank: 1 },
      { modelId: 'b', modelName: models[1].name, rank: 2 },
      { modelId: 'c', modelName: models[2].name, rank: 3 },
    ],
    evaluatedItemSnapshot: snapshot as any,
    itemSnapshot: { ...snapshot, sourceDatasetVersion: 4 } as any,
    datasetVersionEvaluated: 3,
    datasetVersionCurrent: 4,
    contentUpdatedAfterVote: true,
  },
  {
    itemId: taskItemId,
    method: 'rank_order',
    timestamp: Date.parse('2026-08-19T02:00:00.000Z'),
    user: '评委乙',
    ranking: [
      { modelId: 'a', modelName: models[0].name, rank: 1 },
      { modelId: 'b', modelName: models[1].name, rank: 1 },
      { modelId: 'c', modelName: models[2].name, rank: 3 },
    ],
    evaluatedItemSnapshot: snapshot as any,
  },
];

const context: InsightExportContext = {
  projectId: 'project-1',
  projectName: '视频模型评测',
  materialId: 'task-rank',
  materialName: '多功能rank',
  evaluationMethod: 'rank_order',
  reviewerScope: 'all',
  reviewerScopeLabel: '全员汇总',
  exportedAt: '2026-08-19T03:00:00.000Z',
};

const rankBundle = buildRankInsights({ items: [item], votes: rankVotes, models });
const rankRequest = { bundle: rankBundle, items: [item], votes: rankVotes, context };

const rankCsv = buildInsightDetailCsv(rankRequest);
assert(rankCsv.startsWith('\uFEFF'), 'detail CSV must include an Excel-friendly UTF-8 BOM');
assert.match(rankCsv, /"CaseIndex","CaseID","TaskItemID","DatasetItemID"/);
assert.match(rankCsv, /"3","case-001","task-rank:row-1","dataset-row-uuid"/);
assert.match(rankCsv, /"ReviewerName"/);
assert.doesNotMatch(rankCsv, /ReviewerKey|reviewerKey/);
assert.match(rankCsv, /"Rank_a"/);
assert.match(rankCsv, /"Borda_a"/);
assert.match(rankCsv, /"CaseRelationAgreement","CaseKendallTauB","CaseDistinctionRate"/);
assert.match(rankCsv, /"'=HYPERLINK/);
assert.equal(rankCsv.trim().split('\n').length, 3, 'Arena-rank detail must contain one row per ballot');

const legacySnapshotVote: VoteRecord = {
  ...rankVotes[0],
  evaluatedItemSnapshot: undefined,
  itemSnapshot: {
    ...snapshot,
    originalItemId: 'case-vote-time',
    sourceDatasetItemId: 'dataset-row-vote-time',
    itemOrder: 7,
  } as any,
};
const legacySnapshotBundle = buildRankInsights({ items: [item], votes: [legacySnapshotVote], models });
const legacySnapshotCsv = buildInsightDetailCsv({
  ...rankRequest,
  bundle: legacySnapshotBundle,
  votes: [legacySnapshotVote],
});
assert.match(
  legacySnapshotCsv,
  /"8","case-vote-time","task-rank:row-1","dataset-row-vote-time"/,
  'legacy itemSnapshot must remain the preferred vote-time Case identity',
);

const evidence = JSON.parse(buildInsightEvidenceJson(rankRequest));
assert.equal(evidence.schemaVersion, 2);
assert.equal(evidence.context.materialId, 'task-rank');
assert.equal(evidence.cases[0].caseIndex, 3);
assert.equal(evidence.cases[0].caseId, 'case-001');
assert.equal(evidence.cases[0].taskItemId, taskItemId);
assert.equal(evidence.cases[0].datasetItemId, 'dataset-row-uuid');
assert.equal(evidence.cases[0].ballots.length, 2);
assert.deepEqual(evidence.cases[0].ballots[1].ranking.map((entry: any) => entry.rank), [1, 1, 3]);
assert.equal(typeof evidence.cases[0].aggregate.relationAgreement, 'number');
assert.equal(evidence.cases[0].ballots[0].datasetVersionEvaluated, 3);
assert.doesNotMatch(JSON.stringify(evidence), /reviewerKey/i);

const singleBundle = buildRankInsights({ items: [item], votes: rankVotes.slice(0, 1), models });
const singleEvidence = JSON.parse(buildInsightEvidenceJson({ ...rankRequest, bundle: singleBundle, votes: rankVotes.slice(0, 1) }));
assert.equal(singleEvidence.cases[0].aggregate.relationAgreement, null);
assert.equal(singleEvidence.cases[0].aggregate.kendallTauB, null);

const rankWorkbookBuffer = await buildInsightWorkbookBuffer(rankRequest);
const rankWorkbook = new ExcelJS.Workbook();
await rankWorkbook.xlsx.load(rankWorkbookBuffer);
assert.deepEqual(rankWorkbook.worksheets.map(sheet => sheet.name), ['概览', '模型排名', 'Case统计', '维度统计', '两两关系']);
assert.equal(rankWorkbook.getWorksheet('Case统计')?.views[0]?.state, 'frozen');
assert.equal(rankWorkbook.getWorksheet('Case统计')?.getCell('A2').value, 3);
assert.equal(rankWorkbook.getWorksheet('Case统计')?.getCell('B2').value, 'case-001');

const abVotes: VoteRecord[] = [
  { ...rankVotes[0], method: 'ab_preference', ranking: undefined, vote: 'A' },
  { ...rankVotes[1], method: 'ab_preference', ranking: undefined, vote: 'B' },
];
const abBundle = buildAbInsights({
  items: [item],
  votes: abVotes,
  modelNames: { a: models[0].name, b: models[1].name },
});
const abRequest = { ...rankRequest, bundle: abBundle, votes: abVotes, context: { ...context, evaluationMethod: 'ab_preference' as const } };
assert.equal(buildInsightDetailCsv(abRequest).trim().split('\n').length, 3, 'A/B detail must contain one row per ballot');
const abWorkbook = new ExcelJS.Workbook();
await abWorkbook.xlsx.load(await buildInsightWorkbookBuffer(abRequest));
assert.deepEqual(abWorkbook.worksheets.map(sheet => sheet.name), ['概览', 'Case统计', '维度统计']);

const abWithoutDimensionsWorkbook = new ExcelJS.Workbook();
await abWithoutDimensionsWorkbook.xlsx.load(await buildInsightWorkbookBuffer({
  ...abRequest,
  bundle: { ...abBundle, dimensions: [] },
}));
assert.deepEqual(abWithoutDimensionsWorkbook.worksheets.map(sheet => sheet.name), ['概览', 'Case统计']);
assert(
  abWithoutDimensionsWorkbook.getWorksheet('概览')?.getColumn(2).values.includes('维度统计（无数据）'),
  'overview must explain why an optional sheet was omitted',
);

const scoreConfig: EvaluationConfig = {
  method: 'rubric_score',
  dimensions: [
    { id: 'quality', name: '整体质量', description: '', type: 'star_rating', weight: 2 },
    { id: 'reason', name: '理由', description: '', type: 'text_input', aggregationRole: 'rationale' },
  ],
};
const scoreVotes: VoteRecord[] = [{
  itemId: taskItemId,
  method: 'rubric_score',
  timestamp: rankVotes[0].timestamp,
  user: '评委甲',
  evaluatedItemSnapshot: snapshot as any,
  rubricResponses: {
    a: { modelId: 'a', modelName: models[0].name, scores: { quality: 4 }, answers: { reason: '构图稳定' }, reason: '细节好' },
    b: { modelId: 'b', modelName: models[1].name, scores: { quality: 3 }, answers: { reason: '略有抖动' } },
  },
}];
const scoreModels = models.slice(0, 2);
const scoreBundle = buildScoreInsights({ items: [item], votes: scoreVotes, models: scoreModels, config: scoreConfig });
const scoreRequest = { ...rankRequest, bundle: scoreBundle, votes: scoreVotes, context: { ...context, evaluationMethod: 'rubric_score' as const } };
assert.equal(buildInsightDetailCsv(scoreRequest).trim().split('\n').length, 3, 'score detail must contain one row per reviewer/case/model response');
const scoreWorkbook = new ExcelJS.Workbook();
await scoreWorkbook.xlsx.load(await buildInsightWorkbookBuffer(scoreRequest));
assert.deepEqual(scoreWorkbook.worksheets.map(sheet => sheet.name), ['概览', '模型评分', '维度统计', 'Case统计']);

const pairVotes: VoteRecord[] = [{
  itemId: taskItemId,
  method: 'pairwise',
  timestamp: rankVotes[0].timestamp,
  user: '评委甲',
  vote: 'A',
  evaluatedItemSnapshot: snapshot as any,
  pairContext: {
    assignmentId: 'assignment-1',
    pairId: 'a__b',
    originalItemId: 'case-001',
    modelAId: 'a',
    modelAName: models[0].name,
    modelBId: 'b',
    modelBName: models[1].name,
    leftModelId: 'b',
    rightModelId: 'a',
    samplingPhase: 'coverage',
    samplingProbability: 1,
    eligiblePairCount: 1,
    schedulerVersion: 'v1',
  },
}];
const pairBundle = buildPairwiseInsights({ items: [item], votes: pairVotes, models: scoreModels });
const pairRequest = { ...rankRequest, bundle: pairBundle, votes: pairVotes, context: { ...context, evaluationMethod: 'pairwise' as const } };
const pairCsv = buildInsightDetailCsv(pairRequest);
assert.equal(pairCsv.trim().split('\n').length, 2, 'Pairwise detail must contain one row per battle');
assert.match(pairCsv, /"AssignmentID","PairID"/);
assert.doesNotMatch(pairCsv, /ReviewerKey|reviewerKey/);
const pairWorkbook = new ExcelJS.Workbook();
await pairWorkbook.xlsx.load(await buildInsightWorkbookBuffer(pairRequest));
assert.deepEqual(pairWorkbook.worksheets.map(sheet => sheet.name), ['概览', '模型榜单', '模型对统计', 'Case统计', '维度统计']);

console.log('Insight export regression checks passed.');
