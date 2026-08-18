import { createAuthToken } from '../server/auth/jwt.ts';
import { fingerprintOwnerAccessHash, hashOwnerAccessKey } from '../server/auth/ownerAccessCrypto.ts';
import { closeDatabase, dbPool } from '../server/db/client.ts';

type JsonValue = Record<string, any> | Array<any> | string | number | boolean | null;

const API_BASE_URL = (process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
const RUN_ID = `smoke-${Date.now()}`;
const AUTH_HEADERS = {
  'X-User-Id': 'smoke-user',
  'X-User-Email': 'smoke@example.com',
  'X-User-Name': 'Smoke User',
  'X-Organization-Id': 'default',
};

const authHeadersFor = (id: string, email: string, displayName: string) => ({
  'X-User-Id': id,
  'X-User-Email': email,
  'X-User-Name': displayName,
  'X-Organization-Id': 'default',
});

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...AUTH_HEADERS,
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed: ${response.status} ${text}`);
  }
  return body as T;
};

const sendJson = <T>(path: string, method: string, body?: JsonValue) =>
  request<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const expectJsonFailure = async (path: string, status: number, init: RequestInit = {}) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...AUTH_HEADERS,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (response.status !== status) {
    throw new Error(`${init.method || 'GET'} ${path} expected ${status}, got ${response.status}: ${text}`);
  }
  return body;
};

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const clearSmokeOwnerBinding = async () => {
  if (!process.env.OWNER_ACCESS_SMOKE_KEY) return;
  await dbPool.query(
    'DELETE FROM owner_access_bindings WHERE id = $1 AND user_id = $2',
    ['primary', 'smoke-user'],
  );
};

const testOwnerAccess = async (projectId: string) => {
  const accessKey = process.env.OWNER_ACCESS_SMOKE_KEY || '';
  if (!accessKey) return;

  const origin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  const fingerprint = fingerprintOwnerAccessHash(hashOwnerAccessKey(accessKey));
  const ownerRequest = async (
    path: string,
    init: RequestInit = {},
  ) => {
    const response = await fetch(`${API_BASE_URL}${path}`, init);
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    return { response, body, text };
  };
  const accessBody = JSON.stringify({ fingerprint, accessKey });

  const invalid = await ownerRequest('/api/auth/owner/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ fingerprint, accessKey: `${accessKey.slice(0, -1)}B` }),
  });
  assert(invalid.response.status === 404, `wrong owner key should look missing, got ${invalid.response.status}`);

  const setupRequired = await ownerRequest('/api/auth/owner/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: accessBody,
  });
  assert(setupRequired.response.status === 401, 'unbound owner access was accepted without a bearer identity');
  assert(setupRequired.body?.error?.code === 'OWNER_SETUP_REQUIRED', 'unbound owner access returned the wrong error');

  const ownerBearer = createAuthToken({
    userId: 'smoke-user',
    email: 'smoke@example.com',
    displayName: 'Smoke User',
    organizationId: 'default',
  });
  const firstAccess = await ownerRequest('/api/auth/owner/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ownerBearer}`,
      Origin: origin,
    },
    body: accessBody,
  });
  assert(firstAccess.response.status === 200, `owner binding failed: ${firstAccess.response.status} ${firstAccess.text}`);
  assert(firstAccess.body?.user?.id === 'smoke-user', 'owner binding changed the authenticated user identity');
  const firstCookie = (firstAccess.response.headers.get('set-cookie') || '').split(';')[0];
  assert(firstCookie.includes('manueval-owner-session='), 'owner access did not issue an HttpOnly session cookie');

  const intruderBearer = createAuthToken({
    userId: 'smoke-owner-intruder',
    email: 'smoke-owner-intruder@example.com',
    displayName: 'Smoke Owner Intruder',
    organizationId: 'default',
  });
  const repeatedAccess = await ownerRequest('/api/auth/owner/access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${intruderBearer}`,
      Origin: origin,
    },
    body: accessBody,
  });
  assert(repeatedAccess.body?.user?.id === 'smoke-user', 'a repeated access request reassigned the owner binding');

  const me = await ownerRequest('/api/auth/user/me', { headers: { Cookie: firstCookie } });
  assert(me.response.status === 200 && me.body?.user?.id === 'smoke-user', 'owner cookie did not restore the bound user');

  const bearerPriority = await ownerRequest('/api/auth/user/me', {
    headers: { Cookie: firstCookie, Authorization: `Bearer ${intruderBearer}` },
  });
  assert(bearerPriority.body?.user?.id === 'smoke-owner-intruder', 'Bearer auth did not take priority over owner cookie auth');

  const missingOrigin = await ownerRequest(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: firstCookie },
    body: JSON.stringify({ patch: { analysis: 'must not be written' } }),
  });
  assert(missingOrigin.response.status === 403, 'owner cookie mutation without Origin was not rejected');

  const ownerWrite = await ownerRequest(`/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: firstCookie, Origin: origin },
    body: JSON.stringify({ patch: { analysis: 'updated by owner cookie' } }),
  });
  assert(ownerWrite.response.status === 200, `same-origin owner mutation failed: ${ownerWrite.text}`);

  const logoutResponse = await ownerRequest('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: firstCookie, Origin: origin },
  });
  assert(logoutResponse.response.status === 204, 'owner logout failed');
  const revokedMe = await ownerRequest('/api/auth/user/me', { headers: { Cookie: firstCookie } });
  assert(revokedMe.response.status === 401, 'owner logout did not revoke the old cookie version');

  const recoveredAccess = await ownerRequest('/api/auth/owner/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: accessBody,
  });
  assert(recoveredAccess.response.status === 200, 'magic link did not recover access after logout');
  assert(recoveredAccess.body?.user?.id === 'smoke-user', 'recovered magic link returned a different user');
  const recoveredCookie = (recoveredAccess.response.headers.get('set-cookie') || '').split(';')[0];
  const protectedProject = await ownerRequest(`/api/projects/${projectId}`, {
    headers: { Cookie: recoveredCookie },
  });
  assert(protectedProject.response.status === 200, 'recovered owner cookie could not access a protected API');
};

const main = async () => {
  const ids = {
    project: `project-${RUN_ID}`,
    dataset: `dataset-${RUN_ID}`,
    datasetSync: `dataset-sync-${RUN_ID}`,
    template: `template-${RUN_ID}`,
    task: `task-${RUN_ID}`,
    benchmarkTask: `benchmark-task-${RUN_ID}`,
    job: `job-${RUN_ID}`,
  };

  let clonedDatasetId = '';

  const cleanup = async () => {
    await Promise.allSettled([
      ...(clonedDatasetId ? [sendJson(`/api/datasets/${clonedDatasetId}`, 'DELETE')] : []),
      sendJson(`/api/generation/jobs/${ids.job}`, 'DELETE'),
      sendJson(`/api/tasks/${ids.task}`, 'DELETE'),
      sendJson(`/api/tasks/${ids.benchmarkTask}`, 'DELETE'),
      sendJson(`/api/datasets/${ids.dataset}`, 'DELETE'),
      sendJson(`/api/datasets/${ids.datasetSync}`, 'DELETE'),
      sendJson(`/api/templates/${ids.template}`, 'DELETE'),
      sendJson(`/api/projects/${ids.project}`, 'DELETE'),
    ]);
    await clearSmokeOwnerBinding();
  };

  await request('/api/health');
  await request('/api/db/health');
  await cleanup();

  try {
    const project = await sendJson<{ project: any }>('/api/projects', 'POST', {
      project: {
        id: ids.project,
        name: `Smoke Project ${RUN_ID}`,
        category: '产品上游模型能力评测',
        priority: 'P1',
        type: '轻度评测 (快速/专项)',
        goal: 'verify postgres api chain',
        cycle: 'smoke',
        support: ['qa'],
        progress: 0,
        steps: [
          { id: 1, name: '评测物料生产', owner: 'qa', status: 'in-progress', executionType: 'external' },
          { id: 2, name: '评测执行', owner: 'qa', status: 'pending', executionType: 'internal' },
          { id: 3, name: '评测结果分析', owner: 'qa', status: 'pending', executionType: 'internal' },
        ],
        resultSummary: '待产出',
        link: '',
        datasetIds: [],
        dimensions: [],
        generatedDataStatus: '未开始',
        analysis: '暂无',
      },
      user: { uid: 'smoke-user', displayName: 'Smoke User', email: 'smoke@example.com' },
    });
    assert(project.project.id, 'project was not created');

    await testOwnerAccess(project.project.id);

    const projectDetail = await request<{ project: any }>(`/api/projects/${ids.project}`);
    assert(projectDetail.project.id === project.project.id, 'created project was not available by id');
    assert(projectDetail.project.name === project.project.name, 'project detail did not match the create response');
    assert(Array.isArray(projectDetail.project.steps) && projectDetail.project.steps.length === 3, 'project detail steps were not returned');

    const projectList = await request<{ projects: any[] }>('/api/projects');
    assert(projectList.projects.some(item => item.id === project.project.id), 'created project was not present in the project list');

    const missingProject = await expectJsonFailure(`/api/projects/missing-${RUN_ID}`, 404);
    assert(missingProject.error?.code === 'NOT_FOUND', 'missing project did not return the NOT_FOUND contract');

    const normalizedLegacyProject = await request<{ project: any }>(`/api/projects/${ids.project}`, {
      method: 'PATCH',
      body: JSON.stringify({
        patch: {
          category: null,
          priority: null,
          type: null,
          goal: null,
          cycle: null,
          support: null,
          datasetIds: null,
          dimensions: null,
        },
      }),
    });
    assert(normalizedLegacyProject.project.category === '产品上游模型能力评测', 'null project category was not normalized');
    assert(normalizedLegacyProject.project.priority === 'P1', 'null project priority was not normalized');
    assert(normalizedLegacyProject.project.type === '轻度评测 (快速/专项)', 'null project type was not normalized');
    assert(Array.isArray(normalizedLegacyProject.project.steps), 'project steps were not returned as an array');

    const normalizedLegacyDetail = await request<{ project: any }>(`/api/projects/${ids.project}`);
    assert(normalizedLegacyDetail.project.goal === '', 'normalized legacy project was not safe after reloading by id');
    assert(Array.isArray(normalizedLegacyDetail.project.support), 'normalized legacy support was not an array after reloading by id');

    const forbidden = await expectJsonFailure(`/api/projects/${ids.project}`, 403, {
      method: 'PATCH',
      headers: {
        'X-User-Id': 'smoke-intruder',
        'X-User-Email': 'smoke-intruder@example.com',
        'X-User-Name': 'Smoke Intruder',
      },
      body: JSON.stringify({ patch: { analysis: 'should be rejected' } }),
    });
    assert(forbidden.error?.code === 'FORBIDDEN', 'non-member project update was not rejected');

    const editor = await sendJson<{ member: any }>(`/api/projects/${ids.project}/members/smoke-editor`, 'PUT', {
      member: {
        email: 'smoke-editor@example.com',
        displayName: 'Smoke Editor',
        role: 'editor',
      },
    });
    assert(editor.member.role === 'editor', 'project editor was not created');

    const members = await request<{ members: any[] }>(`/api/projects/${ids.project}/members`);
    assert(members.members.some(member => member.userId === editor.member.userId), 'project members were not listed');

    await request<{ project: any }>(`/api/projects/${ids.project}`, {
      method: 'PATCH',
      headers: {
        'X-User-Id': editor.member.userId,
        'X-User-Email': 'smoke-editor@example.com',
        'X-User-Name': 'Smoke Editor',
      },
      body: JSON.stringify({ patch: { analysis: 'updated by editor' } }),
    });

    await sendJson(`/api/datasets/${ids.dataset}`, 'PUT', {
      dataset: {
        id: ids.dataset,
        name: `Smoke Dataset ${RUN_ID}`,
        description: 'verify dataset api',
        tags: ['smoke'],
        inputSchema: [
          { key: 'case_id', label: 'Case ID', type: 'text', role: 'case_id' },
          { key: 'prompt', label: 'Prompt', type: 'text', role: 'input' },
          { key: 'model_a', label: 'Model A', type: 'video_url', role: 'output' },
          { key: 'model_b', label: 'Model B', type: 'video_url', role: 'output' },
        ],
        items: [
          { case_id: 'case-1', prompt: 'hello', model_a: 'https://example.com/a.mp4', model_b: 'https://example.com/b.mp4' },
          { case_id: 'case-2', prompt: 'world', model_a: 'https://example.com/c.mp4', model_b: 'https://example.com/d.mp4' },
        ],
        inputType: 'text',
        modality: 'video',
        categoryPath: ['Smoke'],
        columnMappings: {
          caseId: 'case_id',
          inputColumns: ['prompt'],
          outputColumns: ['model_a', 'model_b'],
          dimensionColumns: [],
          referenceColumns: [],
          standard: {},
        },
        version: 1,
        versionHistory: [{ version: 1, changedAt: Date.now(), changedBy: 'smoke', changeSummary: 'smoke', itemCountBefore: 0, itemCountAfter: 2 }],
        validationSummary: {
          status: 'ok',
          missingCaseIdCount: 0,
          duplicateCaseIdCount: 0,
          invalidUrlCount: 0,
          missingInputCount: 0,
          emptyOutputCells: 0,
          dimensionDistribution: {},
          warnings: [],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    const datasetVersionOne = await request<{ dataset: any }>(`/api/datasets/${ids.dataset}/versions/1`);
    assert(datasetVersionOne.dataset.items.length === 2, 'dataset version 1 snapshot was not readable');
    await sendJson(`/api/datasets/${ids.dataset}`, 'PUT', {
      dataset: {
        ...datasetVersionOne.dataset,
        items: datasetVersionOne.dataset.items.slice(0, 1),
        version: 2,
        versionHistory: [
          ...(datasetVersionOne.dataset.versionHistory || []),
          { version: 2, changedAt: Date.now(), changedBy: 'smoke', changeSummary: 'trim to one row', itemCountBefore: 2, itemCountAfter: 1 },
        ],
        updatedAt: Date.now(),
      },
    });
    const preservedVersionOne = await request<{ dataset: any }>(`/api/datasets/${ids.dataset}/versions/1`);
    assert(preservedVersionOne.dataset.items.length === 2, 'dataset version 1 snapshot was overwritten by version 2 save');
    const datasetRollback = await sendJson<{ dataset: any }>(`/api/datasets/${ids.dataset}/rollback`, 'POST', {
      version: 1,
      changeSummary: 'rollback smoke to version 1',
      expectedVersion: 2,
    });
    assert(datasetRollback.dataset.version === 3, 'dataset rollback did not create a new current version');
    assert(datasetRollback.dataset.items.length === 2, 'dataset rollback did not restore version 1 items');
    const sourceRows = datasetRollback.dataset.items;
    const preservedVersionTwo = await request<{ dataset: any }>(`/api/datasets/${ids.dataset}/versions/2`);
    assert(preservedVersionTwo.dataset.items.length === 1, 'dataset version 2 snapshot was not preserved after rollback');

    const cloneResponse = await sendJson<{ dataset: any }>(`/api/datasets/${ids.dataset}/clone`, 'POST', {
      sourceVersion: 1,
      name: `Smoke Dataset Copy ${RUN_ID}`,
    });
    const clonedDataset = cloneResponse.dataset;
    clonedDatasetId = clonedDataset.id;
    assert(clonedDataset.id !== ids.dataset, 'dataset clone must receive a new dataset ID');
    assert(clonedDataset.version === 1, 'dataset clone must restart at version 1');
    assert(clonedDataset.versionHistory?.length === 1, 'dataset clone must not inherit source version history');
    assert(clonedDataset.items.length === 2, 'dataset clone must copy the requested historical snapshot');
    assert(clonedDataset.copiedFrom?.datasetId === ids.dataset, 'dataset clone lineage dataset ID was not persisted');
    assert(clonedDataset.copiedFrom?.datasetVersion === 1, 'dataset clone lineage version was not persisted');
    assert(
      clonedDataset.items[0].__datasetItemId !== preservedVersionOne.dataset.items[0].__datasetItemId,
      'dataset clone must regenerate internal item identities'
    );

    const clonedStableItemId = encodeURIComponent(clonedDataset.items[0].__datasetItemId);
    const editedClone = await sendJson<{ dataset: any }>(
      `/api/datasets/${clonedDataset.id}/items/${clonedStableItemId}`,
      'PATCH',
      { fieldKey: 'prompt', value: 'changed only in clone', expectedVersion: 1 }
    );
    assert(editedClone.dataset.version === 2, 'editing a clone must create its own next version');
    assert(editedClone.dataset.items[0].prompt === 'changed only in clone', 'clone edit was not persisted');

    const sourceVersionOneAfterCloneEdit = await request<{ dataset: any }>(`/api/datasets/${ids.dataset}/versions/1`);
    const sourceCurrentAfterCloneEdit = await request<{ dataset: any }>(`/api/datasets/${ids.dataset}`);
    assert(sourceVersionOneAfterCloneEdit.dataset.items[0].prompt === 'hello', 'clone edit mutated the source historical version');
    assert(sourceCurrentAfterCloneEdit.dataset.items[0].prompt === 'hello', 'clone edit mutated the source current version');

    const emptyCloneName = await expectJsonFailure(`/api/datasets/${ids.dataset}/clone`, 400, {
      method: 'POST',
      body: JSON.stringify({ sourceVersion: 1, name: '   ' }),
    });
    assert(emptyCloneName.error?.code === 'BAD_REQUEST', 'empty clone name did not return BAD_REQUEST');
    await expectJsonFailure(`/api/datasets/${ids.dataset}/clone`, 400, {
      method: 'POST',
      body: JSON.stringify({ sourceVersion: 0, name: 'invalid version' }),
    });
    await expectJsonFailure(`/api/datasets/${ids.dataset}/clone`, 404, {
      method: 'POST',
      body: JSON.stringify({ sourceVersion: 999, name: 'missing version' }),
    });
    await expectJsonFailure('/api/datasets/missing-dataset/clone', 404, {
      method: 'POST',
      body: JSON.stringify({ sourceVersion: 1, name: 'missing dataset' }),
    });
    await sendJson(`/api/templates/${ids.template}`, 'PUT', {
      template: {
        id: ids.template,
        name: `Smoke Template ${RUN_ID}`,
        description: 'verify template api',
        paradigm: 'GSB',
        dimensions: [
          { id: 'dim-preference', name: '偏好', description: 'preference', type: 'radio_select', options: ['A 更好', 'B 更好', '平局'], required: true },
        ],
        createdAt: Date.now(),
      },
    });

    await sendJson<{ task: any }>('/api/tasks', 'POST', {
      task: {
        id: ids.task,
        name: `Smoke Task ${RUN_ID}`,
        projectId: project.project.id,
        datasetId: ids.dataset,
        datasetBinding: {
          datasetId: ids.dataset,
          datasetVersion: 3,
          inputColumns: ['prompt'],
          dimensionColumns: [],
          referenceColumns: [],
          modelColumns: { 'model-a': 'model_a', 'model-b': 'model_b' },
        },
        templateId: '',
        evaluationConfig: { method: 'ab_preference' },
        models: [{ id: 'model-a', name: 'model_a' }, { id: 'model-b', name: 'model_b' }],
        dimensionColumns: [],
        outputType: 'video',
        inputType: 'text',
        assignees: ['smoke@example.com'],
        progress: {},
        totalItems: 2,
        status: 'active',
        hasImportedData: true,
        creatorUid: 'smoke-user',
        creatorName: 'Smoke User',
        createdAt: Date.now(),
      },
      items: [
        {
          id: `${RUN_ID}-item-1`,
          prompt: 'hello',
          inputs: { prompt: 'hello' },
          modelA_Url: 'https://example.com/a.mp4',
          modelB_Url: 'https://example.com/b.mp4',
          type: 'video',
          itemOrder: 0,
          originalItemId: 'case-1',
          originalData: sourceRows[0],
          sourceDatasetItemId: sourceRows[0].__datasetItemId,
          sourceDatasetVersion: 3,
        },
        {
          id: `${RUN_ID}-item-2`,
          prompt: 'world',
          inputs: { prompt: 'world' },
          modelA_Url: 'https://example.com/c.mp4',
          modelB_Url: 'https://example.com/d.mp4',
          type: 'video',
          itemOrder: 1,
          originalItemId: 'case-2',
          originalData: sourceRows[1],
          sourceDatasetItemId: sourceRows[1].__datasetItemId,
          sourceDatasetVersion: 3,
        },
      ],
    });

    const taskItems = await request<{ items: any[] }>(`/api/tasks/${ids.task}/items`);
    assert(taskItems.items.length === 2, 'task items were not persisted');
    const [firstTaskItem, secondTaskItem] = taskItems.items;
    assert(firstTaskItem?.id && secondTaskItem?.id, 'task item ids were not returned from api');

    const sharedReviewerA = authHeadersFor('smoke-reviewer-a', 'smoke-reviewer-a@example.com', 'Shared Reviewer');
    const sharedReviewerB = authHeadersFor('smoke-reviewer-b', 'smoke-reviewer-b@example.com', 'Shared Reviewer');
    await request(`/api/tasks/${ids.task}/my-votes`, {
      method: 'PUT',
      headers: sharedReviewerA,
      body: JSON.stringify({
        progress: 1,
        votes: [
          { itemId: firstTaskItem.id, method: 'ab_preference', vote: 'A', choice: 'A', timestamp: Date.now(), user: 'Shared Reviewer' },
        ],
      }),
    });
    const reviewerAInitialVotes = await request<{ votes: any[] }>(`/api/tasks/${ids.task}/my-votes`, { headers: sharedReviewerA });
    assert(reviewerAInitialVotes.votes.length === 1, 'initial model-feedback vote write did not persist exactly one record');
    await request(`/api/tasks/${ids.task}/my-votes`, {
      method: 'PUT',
      headers: sharedReviewerA,
      body: JSON.stringify({
        progress: 1,
        votes: reviewerAInitialVotes.votes.map(vote => ({
          ...vote,
          rubricResponses: {
            'model-a': {
              modelId: 'model-a',
              modelName: 'model_a',
              scores: {},
              reason: 'revealed feedback update',
            },
          },
        })),
      }),
    });
    const reviewerAUpdatedVotes = await request<{ votes: any[] }>(`/api/tasks/${ids.task}/my-votes`, { headers: sharedReviewerA });
    assert(reviewerAUpdatedVotes.votes.length === 1, 'revealed feedback update duplicated the vote record');
    assert(
      reviewerAUpdatedVotes.votes[0]?.rubricResponses?.['model-a']?.reason === 'revealed feedback update',
      'revealed model feedback was not readable after the second save',
    );
    const taskAfterFeedbackUpdate = await request<{ task: any }>(`/api/tasks/${ids.task}`);
    assert(
      taskAfterFeedbackUpdate.task.progress?.['smoke-reviewer-a'] === 1,
      'revealed feedback update incorrectly advanced task progress',
    );
    await request(`/api/tasks/${ids.task}/votes/ignored-legacy-name`, {
      method: 'PUT',
      headers: sharedReviewerB,
      body: JSON.stringify({
        progress: 2,
        votes: [
          { itemId: firstTaskItem.id, method: 'ab_preference', vote: 'B', choice: 'B', timestamp: Date.now(), user: 'Shared Reviewer' },
          { itemId: secondTaskItem.id, method: 'ab_preference', vote: 'A', choice: 'A', timestamp: Date.now(), user: 'Shared Reviewer' },
        ],
      }),
    });
    const myVotes = await request<{ votes: any[] }>(`/api/tasks/${ids.task}/my-votes`, { headers: sharedReviewerB });
    assert(myVotes.votes.length === 2, `current reviewer votes were not loaded through my-votes: ${JSON.stringify(myVotes)}`);
    const votes = await request<{ userVotes: Array<{ user: string; userId?: string; displayName?: string; email?: string; votes: any[] }> }>(`/api/tasks/${ids.task}/votes`);
    assert(votes.userVotes.length === 2, 'shared task votes did not include both users');
    assert(new Set(votes.userVotes.map(group => group.userId)).size === 2, 'same display name reviewers were not kept separate by stable user id');
    assert(votes.userVotes.reduce((sum, group) => sum + group.votes.length, 0) === 3, 'shared task vote total was incorrect');

    const editedDataset = await sendJson<{ dataset: any; syncSummary: any }>(
      `/api/datasets/${ids.dataset}/items/${encodeURIComponent(sourceRows[0].__datasetItemId)}`,
      'PATCH',
      { fieldKey: 'prompt', value: 'hello updated', expectedVersion: 3 }
    );
    assert(editedDataset.dataset.version === 4, 'single-cell edit did not create exactly one dataset version');
    assert(editedDataset.syncSummary.tasks >= 1, 'single-cell edit did not report linked task synchronization');
    const synchronizedItems = await request<{ items: any[] }>(`/api/tasks/${ids.task}/items`);
    assert(synchronizedItems.items[0]?.prompt === 'hello updated', 'linked task item did not receive the latest dataset prompt');
    const synchronizedVotes = await request<{ userVotes: Array<{ votes: any[] }> }>(`/api/tasks/${ids.task}/votes`);
    const synchronizedFirstVote = synchronizedVotes.userVotes.flatMap(group => group.votes).find(vote => vote.itemId === firstTaskItem.id);
    assert(synchronizedFirstVote?.itemSnapshot?.prompt === 'hello updated', 'current vote snapshot did not advance to latest content');
    assert(synchronizedFirstVote?.evaluatedItemSnapshot?.prompt === 'hello', 'vote-time snapshot was not kept immutable');
    assert(synchronizedFirstVote?.contentUpdatedAfterVote === true, 'changed vote evidence was not marked as updated');

    const conflictResponse = await expectJsonFailure(
      `/api/datasets/${ids.dataset}/items/${encodeURIComponent(sourceRows[0].__datasetItemId)}`,
      409,
      {
        method: 'PATCH',
        body: JSON.stringify({ fieldKey: 'prompt', value: 'stale write', expectedVersion: 3 }),
      }
    );
    assert(conflictResponse.error?.code === 'VERSION_CONFLICT', 'stale dataset edits did not return VERSION_CONFLICT');

    const manifestEdit = await sendJson<{ dataset: any }>('/api/datasets/' + ids.dataset + '/manifest', 'PATCH', {
      patch: { description: 'edited dataset card', datasetCard: { rubricBinding: 'smoke-rubric' } },
      expectedVersion: 4,
    });
    assert(manifestEdit.dataset.version === 5, 'Dataset Card edit did not create one dataset version');
    const derivedCardNoop = await sendJson<{ dataset: any }>('/api/datasets/' + ids.dataset + '/manifest', 'PATCH', {
      patch: { datasetCard: { sampleSize: 999 } },
      expectedVersion: 5,
    });
    assert(derivedCardNoop.dataset.version === 5, 'derived Dataset Card fields unexpectedly created a version');
    assert(derivedCardNoop.dataset.datasetCard?.sampleSize === 2, 'derived Dataset Card sample size was editable');
    const synchronizedRollback = await sendJson<{ dataset: any; syncSummary: any }>(`/api/datasets/${ids.dataset}/rollback`, 'POST', {
      version: 2,
      changeSummary: 'synchronization rollback smoke',
      expectedVersion: 5,
    });
    assert(synchronizedRollback.dataset.version === 6, 'synchronized rollback did not create the next version');
    assert(synchronizedRollback.syncSummary.taskItemsArchived >= 1, 'active-task removed case was not archived during rollback');
    assert(synchronizedRollback.syncSummary.votesArchived >= 1, 'votes for removed active-task case were not archived');
    const rollbackTaskItems = await request<{ items: any[] }>(`/api/tasks/${ids.task}/items`);
    assert(rollbackTaskItems.items.length === 1, 'archived task items were not excluded from current task content');
    const rollbackVotes = await request<{ userVotes: Array<{ votes: any[]; archivedVotes?: any[] }> }>(`/api/tasks/${ids.task}/votes`);
    assert(rollbackVotes.userVotes.reduce((sum, group) => sum + group.votes.length, 0) === 2, 'archived votes were not excluded from current results');
    const archivedVoteEvidence = rollbackVotes.userVotes.flatMap(group => group.archivedVotes || []);
    assert(archivedVoteEvidence.length === 1, 'archived vote evidence was not exposed separately for audit export');
    assert(archivedVoteEvidence[0].datasetVersionCurrent === 6, 'archived vote evidence did not record the removal version');
    assert(archivedVoteEvidence[0].evaluatedItemSnapshot?.prompt === 'world', 'archived vote-time snapshot was not preserved');
    const staleVoteResponse = await expectJsonFailure(`/api/tasks/${ids.task}/my-votes`, 409, {
      method: 'PUT',
      headers: sharedReviewerB,
      body: JSON.stringify({
        progress: 2,
        votes: [
          { itemId: firstTaskItem.id, method: 'ab_preference', vote: 'B', choice: 'B', timestamp: Date.now() },
          { itemId: secondTaskItem.id, method: 'ab_preference', vote: 'A', choice: 'A', timestamp: Date.now() },
        ],
      }),
    });
    assert(staleVoteResponse.error?.code === 'VERSION_CONFLICT', 'stale votes for archived task items were not rejected');

    const restoredDataset = await sendJson<{ dataset: any }>(`/api/datasets/${ids.dataset}/rollback`, 'POST', {
      version: 1,
      changeSummary: 'restore archived case for revote smoke',
      expectedVersion: 6,
    });
    assert(restoredDataset.dataset.version === 7, 'restoring an archived case did not create the next version');
    const restoredTaskItems = await request<{ items: any[] }>(`/api/tasks/${ids.task}/items`);
    assert(restoredTaskItems.items.length === 2, 'rollback did not restore the archived active-task case');
    await request(`/api/tasks/${ids.task}/my-votes`, {
      method: 'PUT',
      headers: sharedReviewerB,
      body: JSON.stringify({
        progress: 2,
        votes: restoredTaskItems.items.map((item, index) => ({
          itemId: item.id,
          method: 'ab_preference',
          vote: index === 0 ? 'B' : 'A',
          choice: index === 0 ? 'B' : 'A',
          timestamp: Date.now(),
          user: 'Shared Reviewer',
        })),
      }),
    });
    const revotedResults = await request<{ userVotes: Array<{ votes: any[] }> }>(`/api/tasks/${ids.task}/votes`);
    assert(revotedResults.userVotes.reduce((sum, group) => sum + group.votes.length, 0) === 3, 'restored case could not receive a new active vote alongside archived evidence');

    await sendJson<{ task: any }>('/api/tasks', 'POST', {
      task: {
        id: ids.benchmarkTask,
        name: `Benchmark Preview Smoke ${RUN_ID}`,
        projectId: project.project.id,
        datasetId: ids.dataset,
        templateId: ids.template,
        evaluationConfig: { method: 'benchmark_preview' },
        paradigm: 'BenchmarkPreview',
        models: [{ id: 'model-0', name: 'output_text' }],
        dimensionColumns: [],
        outputType: 'text',
        inputType: 'text',
        assignees: ['smoke@example.com'],
        progress: {},
        totalItems: 1,
        status: 'active',
        hasImportedData: true,
        creatorUid: 'smoke-user',
        creatorName: 'Smoke User',
        createdAt: Date.now(),
      },
      items: [
        {
          id: `${RUN_ID}-preview-item-1`,
          prompt: 'preview prompt',
          inputs: { prompt: 'preview prompt' },
          modelA_Url: 'preview output',
          modelB_Url: '',
          modelOutputs: [{ modelId: 'model-0', modelName: 'output_text', url: 'preview output' }],
          type: 'text',
          itemOrder: 0,
        },
      ],
    });

    const benchmarkItems = await request<{ items: any[] }>(`/api/tasks/${ids.benchmarkTask}/items`);
    assert(benchmarkItems.items.length === 1, 'benchmark task items were not persisted');
    const previewItemId = benchmarkItems.items[0]?.id;
    assert(previewItemId, 'benchmark task item id was not returned from api');

    await sendJson(`/api/tasks/${ids.benchmarkTask}/votes/smoke%40example.com`, 'PUT', {
      progress: 1,
      votes: [
        { itemId: previewItemId, method: 'benchmark_preview', choice: 'previewed', reason: 'looks ok', timestamp: Date.now(), user: 'smoke@example.com' },
      ],
    });
    const benchmarkVotes = await request<{ userVotes: Array<{ user: string; votes: any[] }> }>(`/api/tasks/${ids.benchmarkTask}/votes`);
    assert(benchmarkVotes.userVotes[0]?.votes[0]?.method === 'benchmark_preview', 'benchmark preview votes were not persisted');

    await sendJson(`/api/datasets/${ids.datasetSync}`, 'PUT', {
      dataset: {
        id: ids.datasetSync,
        name: `Sync Dataset ${RUN_ID}`,
        description: 'verify versioned sync api',
        tags: [],
        inputSchema: [
          { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id' },
          { key: 'variant_label', label: 'variant_label', type: 'text', role: 'metadata' },
          { key: 'prompt', label: 'prompt', type: 'text', role: 'input' },
          { key: 'sync_result', label: 'sync_result', type: 'video_url', role: 'output', previewType: 'video' },
        ],
        items: [{ case_id: 'sync-1', variant_label: '', prompt: 'before', sync_result: 'https://example.com/sync.mp4' }],
        columnMappings: {
          caseId: 'case_id',
          inputColumns: ['prompt'],
          outputColumns: ['sync_result'],
          dimensionColumns: [],
          referenceColumns: [],
          standard: { case_id: 'case_id', prompt: 'prompt' },
        },
        version: 1,
        versionHistory: [{ version: 1, changedAt: Date.now(), changedBy: 'smoke', changeSummary: 'create', itemCountBefore: 0, itemCountAfter: 1 }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    const reservedSyncColumn = await expectJsonFailure(`/api/datasets/${ids.datasetSync}/sync-previews`, 400, {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: 1,
        source: {
          kind: 'manual',
          headers: ['case_id', '__generationResultMeta'],
          rows: [{ case_id: 'sync-1', __generationResultMeta: {} }],
        },
      }),
    });
    assert(reservedSyncColumn.error?.code === 'BAD_REQUEST', 'sync source accepted a reserved internal column');
    const missingIdentityPreview = await sendJson<{ preview: any }>(`/api/datasets/${ids.datasetSync}/sync-previews`, 'POST', {
      expectedVersion: 1,
      source: {
        kind: 'manual',
        headers: [' case_id ', 'prompt'],
        rows: [],
      },
    });
    assert(
      missingIdentityPreview.preview.validationIssues[0]?.code === 'MISSING_CASE_ID_COLUMN',
      'sync source silently normalized a non-exact case_id header',
    );
    const syncPreview = await sendJson<{ preview: any }>(`/api/datasets/${ids.datasetSync}/sync-previews`, 'POST', {
      expectedVersion: 1,
      source: {
        kind: 'manual',
        headers: ['case_id', 'variant_label', 'prompt', 'sync_result'],
        rows: [
          { case_id: 'sync-1', variant_label: '', prompt: 'after', sync_result: '' },
          { case_id: 'sync-2', variant_label: '', prompt: 'new', sync_result: '' },
        ],
      },
    });
    assert(syncPreview.preview.summary.updated === 1, 'sync preview did not detect the updated case');
    assert(syncPreview.preview.summary.added === 1, 'sync preview did not detect the added case');
    const synchronized = await sendJson<{ dataset: any }>(`/api/datasets/sync-previews/${syncPreview.preview.id}/apply`, 'POST', {});
    assert(synchronized.dataset.version === 2, 'sync apply did not create one new version');
    assert(synchronized.dataset.items[0].sync_result === 'https://example.com/sync.mp4', 'sync apply did not preserve the platform result');
    assert(synchronized.dataset.items[0].__generationResultMeta.sync_result.stale === true, 'sync apply did not mark the retained result stale');

    await sendJson(`/api/generation/jobs/${ids.job}`, 'PUT', {
      job: {
        id: ids.job,
        datasetId: ids.dataset,
        datasetName: `Smoke Dataset ${RUN_ID}`,
        datasetVersion: 1,
        modelConfig: { id: 'mock', displayName: 'Mock', provider: 'mock', outputModality: 'video', previewType: 'video', capabilities: [], controls: [] },
        targetColumn: 'generated_video',
        inputMapping: { referenceImageColumns: [], referenceAudioColumns: [], extraInputColumns: [] },
        defaultControls: {},
        perCaseControlColumns: {},
        seedMode: 'derive_from_case',
        status: 'completed',
        total: 1,
        succeeded: 1,
        failed: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    await sendJson(`/api/generation/jobs/${ids.job}/items/case-1`, 'PUT', {
      item: {
        id: 'case-1',
        jobId: ids.job,
        datasetId: ids.dataset,
        rowIndex: 0,
        caseId: 'case-1',
        status: 'completed',
        resolvedInputs: { prompt: 'hello' },
        resolvedControls: {},
        seed: 1,
        resultUrl: 'https://example.com/generated.mp4',
        mediaType: 'video',
        startedAt: Date.now(),
        finishedAt: Date.now(),
      },
    });
    const jobs = await request<{ jobs: any[] }>(`/api/generation/jobs?datasetId=${ids.dataset}`);
    assert(jobs.jobs.some(job => job.id === ids.job), 'generation job was not persisted');

    await cleanup();
    console.log(`Smoke test passed against ${API_BASE_URL}`);
  } catch (error) {
    await cleanup();
    throw error;
  }
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
