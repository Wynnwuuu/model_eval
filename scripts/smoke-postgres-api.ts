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

const main = async () => {
  const ids = {
    project: `project-${RUN_ID}`,
    dataset: `dataset-${RUN_ID}`,
    template: `template-${RUN_ID}`,
    task: `task-${RUN_ID}`,
    benchmarkTask: `benchmark-task-${RUN_ID}`,
    job: `job-${RUN_ID}`,
  };

  const cleanup = async () => {
    await Promise.allSettled([
      sendJson(`/api/generation/jobs/${ids.job}`, 'DELETE'),
      sendJson(`/api/tasks/${ids.task}`, 'DELETE'),
      sendJson(`/api/tasks/${ids.benchmarkTask}`, 'DELETE'),
      sendJson(`/api/datasets/${ids.dataset}`, 'DELETE'),
      sendJson(`/api/templates/${ids.template}`, 'DELETE'),
      sendJson(`/api/projects/${ids.project}`, 'DELETE'),
    ]);
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
        templateId: '',
        evaluationConfig: { method: 'ab_preference' },
        models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
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
        { id: `${RUN_ID}-item-1`, prompt: 'hello', modelA_Url: 'https://example.com/a.mp4', modelB_Url: 'https://example.com/b.mp4', type: 'video', itemOrder: 0 },
        { id: `${RUN_ID}-item-2`, prompt: 'world', modelA_Url: 'https://example.com/c.mp4', modelB_Url: 'https://example.com/d.mp4', type: 'video', itemOrder: 1 },
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
