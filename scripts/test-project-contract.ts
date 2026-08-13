import { normalizeEvaluationProject } from '../src/features/projects/projectContract.ts';

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const normalized = normalizeEvaluationProject({
  id: 'legacy-project',
  name: 'Legacy project',
  category: null,
  priority: null,
  type: null,
  goal: null,
  cycle: null,
  support: null,
  progress: null,
  steps: null,
  resultSummary: null,
  link: null,
  datasetIds: null,
  dimensions: null,
  generatedDataStatus: null,
  analysis: null,
  lastUpdated: null,
});

assert(normalized.category === '产品上游模型能力评测', 'legacy category was not normalized');
assert(normalized.priority === 'P1', 'legacy priority was not normalized');
assert(normalized.type === '轻度评测 (快速/专项)', 'legacy project type was not normalized');
assert(normalized.goal === '', 'legacy goal was not normalized');
assert(normalized.cycle === '', 'legacy cycle was not normalized');
assert(Array.isArray(normalized.support) && normalized.support.length === 0, 'legacy support was not normalized');
assert(Array.isArray(normalized.steps) && normalized.steps.length === 0, 'legacy steps were not normalized');
assert(Array.isArray(normalized.datasetIds) && normalized.datasetIds.length === 0, 'legacy dataset ids were not normalized');
assert(Array.isArray(normalized.dimensions) && normalized.dimensions.length === 0, 'legacy dimensions were not normalized');

const complete = normalizeEvaluationProject({
  id: 'complete-project',
  name: 'Complete project',
  category: '工程团队专项',
  priority: 'P0',
  type: '重度评测 (周期/版本)',
  goal: 'Verify safe project rendering',
  cycle: '2026-Q3',
  support: ['QA', 7, ''],
  progress: 130,
  steps: [
    { id: 4, name: 'Review', owner: 'Owner', status: 'completed', executionType: 'internal' },
    { id: null, name: null, owner: null, status: 'unexpected', executionType: 'unexpected' },
  ],
  resultSummary: 'Done',
  link: 'https://example.com',
  datasetIds: ['dataset-1', null],
  dimensions: [{ name: 'quality', definition: 'Quality', type: '主观' }, null],
  generatedDataStatus: '已完成',
  analysis: 'Passed',
  createdAt: 123,
  lastUpdated: 456,
});

assert(complete.progress === 100, 'project progress was not clamped');
assert(complete.support.length === 1 && complete.support[0] === 'QA', 'invalid support entries were not removed');
assert(complete.datasetIds.length === 1 && complete.datasetIds[0] === 'dataset-1', 'invalid dataset ids were not removed');
assert(complete.dimensions.length === 1, 'invalid dimensions were not removed');
assert(complete.steps[0]?.status === 'completed', 'valid step status changed unexpectedly');
assert(complete.steps[1]?.id === 2, 'missing step id did not receive a deterministic fallback');
assert(complete.steps[1]?.status === 'pending', 'invalid step status was not normalized');
assert(complete.steps[1]?.executionType === undefined, 'invalid execution type was not removed');

const preserved = normalizeEvaluationProject({
  id: 'custom-project',
  name: 'Custom project',
  category: 'Legacy custom category',
  priority: 'P9',
  type: 'Legacy evaluation type',
});

assert(String(preserved.category) === 'Legacy custom category', 'non-empty legacy category was discarded');
assert(String(preserved.priority) === 'P9', 'non-empty legacy priority was discarded');
assert(String(preserved.type) === 'Legacy evaluation type', 'non-empty legacy type was discarded');

console.log('Project contract tests passed.');
