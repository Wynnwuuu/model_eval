import { buildAbInsights, buildRankInsights } from '../../src/analysisInsights';
import { buildPairwiseInsights, buildScoreInsights } from '../../src/scoringInsights';
import { createVoteItemSnapshot } from '../../src/taskItemSnapshot';
import type { EvaluationConfig, EvaluationItem, VoteRecord } from '../../src/types';
import type { InsightExportRequest } from '../../src/insightExports';

export const reportModels = [{ id: 'a', name: 'Model Aurora' }, { id: 'b', name: 'Model Birch' }, { id: 'c', name: 'Model Cedar' }];
export const reportItems: EvaluationItem[] = Array.from({ length: 33 }, (_, index) => ({
  id: `task:row-${index}`, originalItemId: `case-${String(index + 1).padStart(3, '0')}`,
  itemOrder: index, sourceDatasetItemId: `source-${index}`, sourceDatasetVersion: 2,
  prompt: `用例 ${index + 1}：比较产物的构图、身份一致性和细节。`,
  dimensionValues: { signal_tags: index % 2 ? 'visual_edit' : 'visual_edit, identity_consistency' },
  modelA_Url: 'https://report-media.test/a.png', modelB_Url: 'https://report-media.test/b.png', type: 'image',
  modelOutputs: reportModels.map(model => ({ modelId: model.id, modelName: model.name, url: `https://report-media.test/${model.id}.png` })),
  referenceUrls: ['https://report-media.test/reference.png'],
}));

export const reportVotes: VoteRecord[] = reportItems.flatMap((item, index) => Array.from({ length: 3 }, (_, reviewer) => ({
  itemId: item.id, method: 'ab_preference', user: `评委${reviewer + 1}`, reviewerKey: `private-key-${reviewer}`,
  timestamp: Date.parse('2026-09-07T00:00:00Z') + (index * 3 + reviewer) * 60000,
  vote: index < 24 ? 'A' : index < 29 ? 'B' : index < 32 ? 'Tie' : reviewer < 2 ? 'B' : 'Tie',
  evaluatedItemSnapshot: createVoteItemSnapshot(item),
  rubricResponses: { a: { modelId: 'a', modelName: reportModels[0].name, scores: {}, reason: '构图完整，细节清楚。' } },
} as VoteRecord)));

const context = { projectId: 'project-report', projectName: '产物质量评测', materialId: 'task-report', materialName: '视觉生成对照',
  evaluationMethod: 'ab_preference' as const, reviewerScope: 'all' as const, reviewerScopeLabel: '全员汇总', exportedAt: '2026-09-07T01:00:00Z' };

export const makeAbReportRequest = (items = reportItems, votes = reportVotes): InsightExportRequest => ({
  bundle: buildAbInsights({ items, votes, modelNames: { a: reportModels[0].name, b: reportModels[1].name } }), items, votes, context,
});

export const makeReportRequests = (): InsightExportRequest[] => {
  const items = reportItems.slice(0, 3);
  const rankingVotes: VoteRecord[] = items.flatMap(item => [0, 1].map(i => ({
    itemId: item.id, method: 'rank_order', user: `评委${i}`, reviewerKey: `private-key-${i}`, timestamp: 1000 + i,
    evaluatedItemSnapshot: createVoteItemSnapshot(item),
    ranking: reportModels.map((model, index) => ({ modelId: model.id, modelName: model.name, rank: i ? Math.max(index, 1) : index + 1 })),
  })));
  const config: EvaluationConfig = { method: 'rubric_score', dimensions: [
    { id: 'quality', name: '整体质量', description: '', type: 'star_rating', weight: 2 },
    { id: 'motion', name: '动作表现', description: '', type: 'star_rating', weight: 1 },
  ] };
  const scoreVotes: VoteRecord[] = items.flatMap(item => [0, 1].map(i => ({ itemId: item.id, method: 'rubric_score', user: `评委${i}`, timestamp: 1000 + i,
    evaluatedItemSnapshot: createVoteItemSnapshot(item), rubricResponses: Object.fromEntries(reportModels.map((model, index) => [model.id, {
      modelId: model.id, modelName: model.name, scores: { quality: 5 - index - i, motion: 3 + i }, reason: '细节与动作反馈',
    }])),
  })));
  const pairVotes: VoteRecord[] = items.flatMap(item => [0, 1].map(i => ({ itemId: item.id, method: 'pairwise', user: `评委${i}`, timestamp: 1000 + i, vote: i ? 'Tie' : 'A',
    evaluatedItemSnapshot: createVoteItemSnapshot(item), pairContext: { assignmentId: `${item.id}-${i}`, pairId: 'a__b', originalItemId: item.originalItemId,
      modelAId: 'a', modelAName: reportModels[0].name, modelBId: 'b', modelBName: reportModels[1].name, leftModelId: 'a', rightModelId: 'b' },
  })));
  return [makeAbReportRequest(),
    { bundle: buildRankInsights({ items, votes: rankingVotes, models: reportModels }), items, votes: rankingVotes, context: { ...context, evaluationMethod: 'rank_order' } },
    ...(['direct_score', 'rubric_score'] as const).map(method => ({ bundle: buildScoreInsights({ items, votes: scoreVotes, models: reportModels, config: { ...config, method } }), items, votes: scoreVotes, context: { ...context, evaluationMethod: method } })),
    { bundle: buildPairwiseInsights({ items, votes: pairVotes, models: reportModels }), items, votes: pairVotes, context: { ...context, evaluationMethod: 'pairwise' } },
  ];
};
