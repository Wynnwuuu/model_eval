import assert from 'node:assert/strict';
import {
  buildInsightPath,
  parseInsightSearchParams,
} from '../src/insightDeepLink';

const groupScope = 'group:ab_preference::video::model-a:Model A|model-b:Model B';

const projectPath = buildInsightPath({ projectId: 'project 1' });
assert.equal(projectPath, '/projects/project%201/insights');

const groupPath = buildInsightPath({
  projectId: 'project-1',
  statusFilter: 'active',
  scope: groupScope,
});
assert.equal(
  groupPath,
  '/projects/project-1/insights?status=active&scope=group%3Aab_preference%3A%3Avideo%3A%3Amodel-a%3AModel+A%7Cmodel-b%3AModel+B',
);
assert.deepEqual(
  parseInsightSearchParams(new URL(groupPath, 'https://eval.example.com').searchParams),
  { statusFilter: 'active', scope: groupScope },
);

const taskPath = buildInsightPath({
  projectId: 'project-1',
  statusFilter: 'all',
  scope: 'material:task-9',
});
assert.equal(taskPath, '/projects/project-1/insights?scope=material%3Atask-9');
assert.deepEqual(
  parseInsightSearchParams(new URL(taskPath, 'https://eval.example.com').searchParams),
  { statusFilter: 'all', scope: 'material:task-9' },
);

assert.deepEqual(
  parseInsightSearchParams(new URLSearchParams('status=unknown&scope=not-valid')),
  { statusFilter: 'all' },
);

console.log('Insight deep-link regression checks passed.');
