import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const runId = `evaluation-storage-${Date.now()}`;
const projectId = `${runId}-project`;
const datasetId = `${runId}-dataset`;
const taskId = `${runId}-task`;
const arenaTaskId = `${runId}-arena`;
const modeTaskIds = {
  mos: `${runId}-mos`,
  rubric: `${runId}-rubric`,
  rank: `${runId}-rank`,
  preview: `${runId}-preview`,
};
const authHeaders = {
  'X-User-Id': 'local-user',
  'X-User-Email': 'local@eval.test',
  'X-User-Name': 'Local Tester',
  'X-Organization-Id': 'default',
};

const jsonRequest = async <T>(api: APIRequestContext, path: string, method = 'GET', data?: unknown): Promise<T> => {
  const response = await api.fetch(path, { method, data, headers: authHeaders });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
};

const buildItem = (index: number) => ({
  id: `${runId}-item-${index}`,
  prompt: `Browser quota regression case ${index} ${'rich input '.repeat(80)}`,
  inputs: { prompt: `Browser quota regression case ${index}`, metadata: 'm'.repeat(512) },
  modelA_Url: `https://example.com/e2e/${index}/a.mp4`,
  modelB_Url: `https://example.com/e2e/${index}/b.mp4`,
  modelOutputs: [
    { modelId: 'model-a', modelName: 'Model A', url: `https://example.com/e2e/${index}/a.mp4` },
    { modelId: 'model-b', modelName: 'Model B', url: `https://example.com/e2e/${index}/b.mp4` },
    { modelId: 'model-c', modelName: 'Model C', url: `https://example.com/e2e/${index}/c.mp4` },
  ],
  type: 'video',
  itemOrder: index,
  originalItemId: `case-${index}`,
  originalData: { case_id: `case-${index}`, note: 'source'.repeat(80) },
});

const taskItems = Array.from({ length: 188 }, (_, index) => buildItem(index));

const seedLegacyNearQuota = async (page: Page) => {
  await page.addInitScript(({ legacyTaskId }) => {
    if (window.name === 'manueval-quota-seeded') return;
    window.name = 'manueval-quota-seeded';
    const legacyItems = Array.from({ length: 188 }, (_, index) => ({
      id: `legacy-${index}`,
      modelA_Url: `https://example.com/legacy/${index}/a.mp4`,
      modelB_Url: `https://example.com/legacy/${index}/b.mp4`,
      prompt: `Legacy ${index} ${'payload '.repeat(350)}`,
      type: 'video',
    }));
    const legacyVotes = [{ itemId: 'legacy-0', vote: 'A', choice: 'A', timestamp: 1, user: 'Local Tester' }];
    localStorage.setItem('modeleval_session', JSON.stringify({
      items: legacyItems,
      votes: legacyVotes,
      currentIndex: 1,
      userName: 'Local Tester',
      modelNames: { a: 'Legacy A', b: 'Legacy B' },
      taskModels: [{ id: 'model-a', name: 'Legacy A' }, { id: 'model-b', name: 'Legacy B' }],
      taskParadigm: 'Arena',
      activeTaskId: legacyTaskId,
      timestamp: 1,
      sessionId: 'legacy-online-session',
    }));
    localStorage.setItem('modeleval_history', JSON.stringify([{
      id: 'legacy-history',
      timestamp: 1,
      userName: 'Local Tester',
      modelNames: { a: 'Legacy A', b: 'Legacy B' },
      paradigm: 'Arena',
      items: legacyItems,
      votes: legacyVotes,
    }]));
    for (let index = 0; index < 64; index += 1) {
      try {
        localStorage.setItem(`quota-fill-${index}`, 'q'.repeat(128 * 1024));
      } catch {
        localStorage.removeItem(`quota-fill-${Math.max(0, index - 1)}`);
        break;
      }
    }
  }, { legacyTaskId: taskId });
};

const fillRemainingLocalStorageQuota = async (page: Page) => page.evaluate(() => {
  for (let index = 100; index < 200; index += 1) {
    try {
      localStorage.setItem(`runtime-fill-${index}`, 'r'.repeat(128 * 1024));
    } catch {
      localStorage.removeItem(`runtime-fill-${Math.max(100, index - 1)}`);
      return index;
    }
  }
  return 200;
});

const readIndexedDbRecord = async (page: Page, storeName: string, key: string) => page.evaluate(
  ({ storeName, key }) => new Promise<any>((resolve, reject) => {
    const open = indexedDB.open('manueval-client-state', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    };
  }),
  { storeName, key },
);

test.describe.serial('evaluation client storage', () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: API_BASE_URL, extraHTTPHeaders: authHeaders });
    await jsonRequest(api, '/api/projects', 'POST', {
      project: {
        id: projectId,
        name: `Evaluation storage browser project ${runId}`,
        category: '工程团队专项',
        priority: 'P1',
        type: '轻度评测 (快速/专项)',
        goal: 'Browser storage regression',
        cycle: 'e2e',
        support: ['qa'],
        progress: 0,
        steps: [],
        resultSummary: '',
        link: '',
        datasetIds: [],
        dimensions: [],
        generatedDataStatus: '未开始',
        analysis: '',
      },
      user: { uid: 'local-user', displayName: 'Local Tester', email: 'local@eval.test' },
    });
    await jsonRequest(api, `/api/datasets/${datasetId}`, 'PUT', {
      dataset: {
        id: datasetId,
        name: `Evaluation storage browser dataset ${runId}`,
        description: 'Browser storage regression fixture',
        tags: ['e2e'],
        inputSchema: [
          { key: 'case_id', label: 'Case ID', type: 'text', role: 'case_id' },
          { key: 'prompt', label: 'Prompt', type: 'text', role: 'input' },
          { key: 'model_a', label: 'Model A', type: 'video_url', role: 'output' },
          { key: 'model_b', label: 'Model B', type: 'video_url', role: 'output' },
        ],
        items: [{ case_id: 'fixture', prompt: 'fixture', model_a: 'https://example.com/a.mp4', model_b: 'https://example.com/b.mp4' }],
        createdAt: Date.now(),
      },
    });
    await jsonRequest(api, '/api/tasks', 'POST', {
      task: {
        id: taskId,
        name: `188 case quota task ${runId}`,
        projectId,
        datasetId,
        templateId: '',
        evaluationConfig: { method: 'ab_preference' },
        models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
        dimensionColumns: [],
        outputType: 'video',
        inputType: 'text',
        assignees: ['local@eval.test'],
        progress: {},
        totalItems: taskItems.length,
        status: 'active',
        hasImportedData: true,
        creatorUid: 'local-user',
        creatorName: 'Local Tester',
        createdAt: Date.now(),
      },
      items: taskItems,
    });
    await jsonRequest(api, '/api/tasks', 'POST', {
      task: {
        id: arenaTaskId,
        name: `Arena checkpoint task ${runId}`,
        projectId,
        datasetId,
        templateId: '',
        evaluationConfig: {
          method: 'pairwise',
          pairwiseMode: 'arena_sampled',
          arenaSampling: { schedulerVersion: 'arena_v1', seed: 'e2e-arena', suggestedBattlesPerReviewer: 4 },
        },
        models: [
          { id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }, { id: 'model-c', name: 'Model C' },
        ],
        dimensionColumns: [],
        outputType: 'video',
        inputType: 'text',
        assignees: ['local@eval.test'],
        progress: {},
        totalItems: 8,
        status: 'active',
        hasImportedData: true,
        creatorUid: 'local-user',
        creatorName: 'Local Tester',
        createdAt: Date.now(),
      },
      items: taskItems.slice(0, 8),
    });
    const modeConfigs = [
      { id: modeTaskIds.mos, evaluationConfig: { method: 'direct_score' }, models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }] },
      { id: modeTaskIds.rubric, evaluationConfig: { method: 'rubric_score' }, models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }] },
      { id: modeTaskIds.rank, evaluationConfig: { method: 'rank_order' }, models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }, { id: 'model-c', name: 'Model C' }] },
      { id: modeTaskIds.preview, evaluationConfig: { method: 'benchmark_preview' }, models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }] },
    ];
    for (const mode of modeConfigs) {
      await jsonRequest(api, '/api/tasks', 'POST', {
        task: {
          id: mode.id,
          name: `Mode refresh task ${mode.id}`,
          projectId,
          datasetId,
          templateId: '',
          evaluationConfig: mode.evaluationConfig,
          models: mode.models,
          dimensionColumns: [],
          outputType: 'video',
          inputType: 'text',
          assignees: ['local@eval.test'],
          progress: {},
          totalItems: 2,
          status: 'active',
          hasImportedData: true,
          creatorUid: 'local-user',
          creatorName: 'Local Tester',
          createdAt: Date.now(),
        },
        items: taskItems.slice(20, 22).map((item, index) => ({ ...item, id: `${mode.id}-item-${index}` })),
      });
    }
  });

  test.afterAll(async () => {
    await api?.delete(`/api/tasks/${taskId}`, { headers: authHeaders }).catch(() => undefined);
    await api?.delete(`/api/tasks/${arenaTaskId}`, { headers: authHeaders }).catch(() => undefined);
    for (const modeTaskId of Object.values(modeTaskIds)) {
      await api?.delete(`/api/tasks/${modeTaskId}`, { headers: authHeaders }).catch(() => undefined);
    }
    await api?.delete(`/api/datasets/${datasetId}`, { headers: authHeaders }).catch(() => undefined);
    await api?.delete(`/api/projects/${projectId}`, { headers: authHeaders }).catch(() => undefined);
    await api?.dispose();
  });

  test('near-quota legacy data migrates and a 188-case task survives vote and reload', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(`${error.name}: ${error.message}`));
    await seedLegacyNearQuota(page);
    await page.goto(`/tasks/${taskId}/evaluate`);
    await expect(page.getByText('MANUEVAL', { exact: true })).toBeVisible();
    await expect(page.getByText('批量评测', { exact: true })).toBeVisible();
    await expect(page.getByText('1 / 188', { exact: true })).toBeVisible();

    await expect.poll(() => page.evaluate(() => localStorage.getItem('modeleval_session'))).toBeNull();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('modeleval_history'))).toBeNull();
    const sessionBackup = await readIndexedDbRecord(page, 'migrationBackups', 'modeleval_session');
    const historyBackup = await readIndexedDbRecord(page, 'migrationBackups', 'modeleval_history');
    expect(sessionBackup?.state).toBe('cleaned');
    expect(historyBackup?.state).toBe('cleaned');
    expect(sessionBackup?.raw).toContain('legacy-online-session');
    expect(historyBackup?.raw).toContain('legacy-history');

    await fillRemainingLocalStorageQuota(page);
    await page.getByRole('button', { name: '跳过本题' }).click();
    await expect(page.getByText('2 / 188', { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const payload = await jsonRequest<{ votes: unknown[] }>(api, `/api/tasks/${taskId}/my-votes`);
      return payload.votes.length;
    }).toBe(1);
    await page.reload();
    await expect(page.getByText('MANUEVAL', { exact: true })).toBeVisible();
    await expect(page.getByText('2 / 188', { exact: true })).toBeVisible();
    expect(pageErrors.filter(message => message.includes('QuotaExceededError'))).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('missing task keeps the application shell and shows an explicit state', async ({ page }) => {
    await page.goto(`/tasks/${runId}-missing/evaluate`);
    await expect(page.getByText('MANUEVAL', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '评测物料不存在或已删除' })).toBeVisible();
    await expect(page.getByRole('button', { name: '返回评测物料' })).toBeVisible();
  });

  test('a transient task-load failure remains inside the shell and can be retried', async ({ page }) => {
    const taskRoute = `**/api/tasks/${taskId}`;
    await page.route(taskRoute, route => route.abort('failed'));
    await page.goto(`/tasks/${taskId}/evaluate`);
    await expect(page.getByText('MANUEVAL', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '评测物料加载失败' })).toBeVisible();
    await page.unroute(taskRoute);
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.getByText('2 / 188', { exact: true })).toBeVisible();
  });

  test('a slow previous task cannot overwrite a newer task route', async ({ page }) => {
    await page.route(`**/api/tasks/${taskId}`, async route => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await route.continue();
    });
    await page.goto(`/tasks/${taskId}/evaluate`);
    await page.goto(`/tasks/${modeTaskIds.mos}/evaluate`);
    await expect(page.getByText('直接评分 / MOS', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('1 / 2', { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.getByText('1 / 2', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('2 / 188', { exact: true })).toHaveCount(0);
  });

  test('IndexedDB failure is non-fatal for a server-backed task', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
    });
    await page.goto(`/tasks/${taskId}/evaluate`);
    await expect(page.getByText('MANUEVAL', { exact: true })).toBeVisible();
    await expect(page.getByText('批量评测', { exact: true })).toBeVisible();
    await expect(page.getByText('2 / 188', { exact: true })).toBeVisible();
    await expect(page.getByRole('paragraph').filter({ hasText: '本地恢复存储暂不可用；线上任务仍会从服务端正常读取和保存。' })).toBeVisible();
  });

  test('offline legacy session resumes from IndexedDB after migration', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('modeleval_session', JSON.stringify({
        items: [
          { id: 'offline-1', modelA_Url: 'https://example.com/a.mp4', modelB_Url: 'https://example.com/b.mp4', prompt: 'Offline one', type: 'video' },
          { id: 'offline-2', modelA_Url: 'https://example.com/c.mp4', modelB_Url: 'https://example.com/d.mp4', prompt: 'Offline two', type: 'video' },
        ],
        votes: [{ itemId: 'offline-1', vote: 'A', choice: 'A', timestamp: 1, user: 'Local Tester' }],
        currentIndex: 1,
        userName: 'Local Tester',
        modelNames: { a: 'A', b: 'B' },
        taskParadigm: 'Arena',
        activeTaskId: null,
        timestamp: 1,
        sessionId: 'offline-resume-session',
      }));
    });
    await page.goto('/evaluation');
    await expect(page.getByRole('button', { name: '继续评测' })).toBeVisible();
    await page.getByRole('button', { name: '继续评测' }).click();
    await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  });

  test('history migration loads summaries and lazily downloads the original detail', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('modeleval_history', JSON.stringify([{
        id: 'download-history',
        timestamp: 1,
        userName: 'History Reviewer',
        modelNames: { a: 'History A', b: 'History B' },
        paradigm: 'Arena',
        items: [{ id: 'history-case', modelA_Url: 'https://example.com/a.mp4', modelB_Url: 'https://example.com/b.mp4', type: 'video' }],
        votes: [{ itemId: 'history-case', vote: 'A', choice: 'A', timestamp: 1, user: 'History Reviewer' }],
      }]));
    });
    await page.goto('/history');
    await expect(page.getByText('History A vs History B')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let content = '';
    for await (const chunk of stream) content += chunk.toString();
    expect(content).toContain('history-case');
    expect(content).toContain('History Reviewer');
  });

  test('sampled Arena restores the exact pending assignment after refresh', async ({ page }) => {
    await page.goto(`/tasks/${arenaTaskId}/evaluate`);
    await expect(page.getByText('批量评测', { exact: true })).toBeVisible();
    const checkpointKey = `${arenaTaskId}::local-user`;
    await expect.poll(async () => Boolean(await readIndexedDbRecord(page, 'taskCheckpoints', checkpointKey))).toBe(true);
    const before = await readIndexedDbRecord(page, 'taskCheckpoints', checkpointKey);
    await page.reload();
    await expect(page.getByText('批量评测', { exact: true })).toBeVisible();
    const after = await readIndexedDbRecord(page, 'taskCheckpoints', checkpointKey);
    expect(after.assignment.assignmentId).toBe(before.assignment.assignmentId);
    expect(after.assignment.leftModelId).toBe(before.assignment.leftModelId);
    expect(after.assignment.rightModelId).toBe(before.assignment.rightModelId);
    expect(after.assignment.modelAUrl).toBe(before.assignment.modelAUrl);
    expect(after.assignment.modelBUrl).toBe(before.assignment.modelBUrl);
  });

  test('MOS, Rubric, Arena-rank and Preview restore server progress after refresh', async ({ page }) => {
    const scenarios = [
      { taskId: modeTaskIds.mos, heading: '直接评分 / MOS', skip: '跳过本题', progress: '2 / 2' },
      { taskId: modeTaskIds.rubric, heading: 'Rubric 多维评分', skip: '跳过本题', progress: '2 / 2' },
      { taskId: modeTaskIds.rank, heading: 'Arena-rank', skip: '跳过本题', progress: '2 / 2' },
      { taskId: modeTaskIds.preview, heading: 'Benchmark 数据预览', skip: '跳过', progress: 'Case 2 / 2' },
    ];
    for (const scenario of scenarios) {
      await page.goto(`/tasks/${scenario.taskId}/evaluate`);
      await expect(page.getByText(scenario.heading, { exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: scenario.skip, exact: true }).click();
      await expect(page.getByText(scenario.progress, { exact: true }).first()).toBeVisible();
      await page.reload();
      await expect(page.getByText(scenario.progress, { exact: true }).first()).toBeVisible();
      const saved = await jsonRequest<{ votes: unknown[] }>(api, `/api/tasks/${scenario.taskId}/my-votes`);
      expect(saved.votes).toHaveLength(1);
    }
  });
});
