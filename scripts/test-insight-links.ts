import assert from 'node:assert/strict';
import {
  buildInsightPath,
  parseInsightSearchParams,
} from '../src/insightDeepLink';

const projectPath = buildInsightPath({ projectId: 'project 1' });
assert.equal(projectPath, '/projects/project%201/insights');

const legacyGroupPath = buildInsightPath({
  projectId: 'project-1',
  scope: 'group:ab_preference::video::model-a:Model A|model-b:Model B',
});
assert.equal(legacyGroupPath, '/projects/project-1/insights');
assert.deepEqual(
  parseInsightSearchParams(new URLSearchParams('status=active&scope=group%3Alegacy&reviewer=all')),
  { reviewerScope: 'all' },
);

const taskPath = buildInsightPath({
  projectId: 'project-1',
  scope: 'material:task-9',
  reviewerScope: 'mine',
});
assert.equal(taskPath, '/projects/project-1/insights?scope=material%3Atask-9&reviewer=mine');
assert.deepEqual(
  parseInsightSearchParams(new URL(taskPath, 'https://eval.example.com').searchParams),
  { reviewerScope: 'mine', scope: 'material:task-9' },
);

assert.deepEqual(
  parseInsightSearchParams(new URLSearchParams('scope=not-valid&reviewer=unknown')),
  { reviewerScope: 'all' },
);

console.log('Insight deep-link regression checks passed.');
