import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const runId = `overview-material-${Date.now()}`;
const projectId = `${runId}-project`;
const datasetId = `${runId}-dataset`;
const taskIds = {
  assigned: `${runId}-assigned`,
  unassigned: `${runId}-unassigned`,
  empty: `${runId}-empty`,
  failed: `${runId}-failed`,
  slow: `${runId}-slow`,
  current: `${runId}-current`,
};
const names = {
  project: `Overview target project ${runId}`,
  assigned: `Assigned homepage material ${runId}`,
  unassigned: `Unassigned homepage material ${runId}`,
  empty: `Empty detail material ${runId}`,
  failed: `Failed detail material ${runId}`,
  slow: `Slow detail material ${runId}`,
  current: `Current detail material ${runId}`,
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

const buildTask = (
  id: string,
  name: string,
  createdAt: number,
  options: { projectId?: string; outputType?: 'text' | 'video'; totalItems?: number } = {},
) => ({
  id,
  name,
  projectId: options.projectId,
  datasetId,
  templateId: '',
  evaluationConfig: { method: 'pairwise' },
  models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }],
  dimensionColumns: [],
  outputType: options.outputType || 'text',
  inputType: 'text',
  assignees: ['local@eval.test'],
  progress: {},
  totalItems: options.totalItems || 0,
  status: 'active',
  hasImportedData: true,
  creatorUid: 'local-user',
  creatorName: 'Local Tester',
  createdAt,
});

const mediaItem = {
  id: `${runId}-media-item`,
  prompt: `Media detail prompt ${runId}`,
  inputs: { prompt: `Media detail prompt ${runId}` },
  referenceUrls: [
    `https://example.com/detail/${runId}/reference.mp4`,
    `https://example.com/detail/${runId}/reference.mp3`,
  ],
  modelA_Url: `https://example.com/detail/${runId}/a.mp4`,
  modelB_Url: `https://example.com/detail/${runId}/b.mp4`,
  modelOutputs: [
    { modelId: 'model-a', modelName: 'Model A', url: `https://example.com/detail/${runId}/a.mp4` },
    { modelId: 'model-b', modelName: 'Model B', url: `https://example.com/detail/${runId}/b.mp4` },
  ],
  type: 'video',
};

const currentItem = {
  id: `${runId}-current-item`,
  prompt: `Current task prompt ${runId}`,
  modelA_Url: 'Current A',
  modelB_Url: 'Current B',
  modelOutputs: [
    { modelId: 'model-a', modelName: 'Model A', url: 'Current A' },
    { modelId: 'model-b', modelName: 'Model B', url: 'Current B' },
  ],
  type: 'text',
};

const slowItem = {
  ...currentItem,
  id: `${runId}-slow-item`,
  prompt: `Stale slow task prompt ${runId}`,
  modelA_Url: 'Stale A',
  modelB_Url: 'Stale B',
};

const openOverview = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '运营总览' })).toBeVisible();
  await expect(page.getByText(names.assigned, { exact: true })).toBeVisible();
};

const rowFor = (page: Page, name: string) => page
  .locator('tbody tr')
  .filter({ has: page.getByText(name, { exact: true }) });

const taskCardFor = (page: Page, name: string) => page
  .locator('div.rounded-2xl')
  .filter({ has: page.getByRole('heading', { name, exact: true }) })
  .filter({ has: page.getByRole('button', { name: '查看 / 编辑', exact: true }) })
  .first();

test.describe.serial('overview material project navigation and task detail', () => {
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: API_BASE_URL, extraHTTPHeaders: authHeaders });
    await jsonRequest(api, '/api/projects', 'POST', {
      project: {
        id: projectId,
        name: names.project,
        category: '工程团队专项',
        priority: 'P1',
        type: '轻度评测 (快速/专项)',
        goal: 'Homepage project navigation regression',
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
        name: `Overview navigation dataset ${runId}`,
        description: 'Browser navigation regression fixture',
        tags: ['e2e'],
        inputSchema: [
          { key: 'case_id', label: 'Case ID', type: 'text', role: 'case_id' },
          { key: 'prompt', label: 'Prompt', type: 'text', role: 'input' },
        ],
        items: [{ case_id: 'fixture', prompt: 'fixture' }],
        createdAt: Date.now(),
      },
    });

    const now = Date.now();
    const fixtures = [
      { id: taskIds.assigned, name: names.assigned, options: { projectId, outputType: 'video' as const, totalItems: 1 }, items: [mediaItem] },
      { id: taskIds.unassigned, name: names.unassigned, options: {}, items: [] },
      { id: taskIds.empty, name: names.empty, options: { projectId }, items: [] },
      { id: taskIds.failed, name: names.failed, options: { projectId }, items: [] },
      { id: taskIds.slow, name: names.slow, options: { projectId, totalItems: 1 }, items: [slowItem] },
      { id: taskIds.current, name: names.current, options: { projectId, totalItems: 1 }, items: [currentItem] },
    ];
    for (const [index, fixture] of fixtures.entries()) {
      await jsonRequest(api, '/api/tasks', 'POST', {
        task: buildTask(fixture.id, fixture.name, now + index, fixture.options),
        items: fixture.items,
      });
    }
  });

  test.afterAll(async () => {
    for (const taskId of Object.values(taskIds)) {
      await api?.delete(`/api/tasks/${taskId}`, { headers: authHeaders }).catch(() => undefined);
    }
    await api?.delete(`/api/datasets/${datasetId}`, { headers: authHeaders }).catch(() => undefined);
    await api?.delete(`/api/projects/${projectId}`, { headers: authHeaders }).catch(() => undefined);
    await api?.dispose();
  });

  test('assigned material name, row, and action all open its project without a material dialog', async ({ page }) => {
    const assertProjectDetail = async () => {
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
      await expect(page.getByRole('heading', { name: names.project, exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: /物料详情/ })).toHaveCount(0);
    };

    await openOverview(page);
    await rowFor(page, names.assigned).getByRole('button', { name: names.assigned, exact: true }).click();
    await assertProjectDetail();

    await openOverview(page);
    await rowFor(page, names.assigned).getByText('进行中', { exact: true }).click();
    await assertProjectDetail();

    await openOverview(page);
    await rowFor(page, names.assigned).getByRole('button', { name: '查看项目', exact: true }).click();
    await assertProjectDetail();
  });

  test('unassigned material has no row, name, or keyboard interaction', async ({ page }) => {
    await openOverview(page);
    const row = rowFor(page, names.unassigned);
    await expect(row).not.toHaveAttribute('role', 'button');
    await expect(row).not.toHaveAttribute('tabindex', '0');
    await expect(row.getByRole('button', { name: names.unassigned, exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '未归属项目', exact: true })).toBeDisabled();

    await row.getByText(names.unassigned, { exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await row.press('Enter');
    await expect(page).toHaveURL(/\/$/);
  });

  test('task detail deep link closes to /tasks and stays closed after refresh', async ({ page }) => {
    await page.goto(`/tasks/${taskIds.assigned}`);
    await expect(page.getByRole('dialog', { name: new RegExp(names.assigned) })).toBeVisible();
    await page.getByRole('button', { name: '关闭物料详情' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('dialog', { name: /物料详情/ })).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('dialog', { name: /物料详情/ })).toHaveCount(0);
  });

  test('empty and failed detail item loads each request only once', async ({ page }) => {
    let emptyRequests = 0;
    await page.route(`**/api/tasks/${taskIds.empty}/items`, async route => {
      emptyRequests += 1;
      await route.continue();
    });
    await page.goto(`/tasks/${taskIds.empty}`);
    await expect(page.getByRole('dialog', { name: new RegExp(names.empty) })).toBeVisible();
    await expect(page.getByText('没有找到评测数据', { exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    expect(emptyRequests).toBe(1);

    await page.getByRole('button', { name: '关闭物料详情' }).click();
    let failedRequests = 0;
    await page.route(`**/api/tasks/${taskIds.failed}/items`, async route => {
      failedRequests += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'expected e2e failure' }) });
    });
    await page.goto(`/tasks/${taskIds.failed}`);
    await expect(page.getByRole('dialog', { name: new RegExp(names.failed) })).toBeVisible();
    await page.waitForTimeout(600);
    expect(failedRequests).toBe(1);
  });

  test('closing a slow detail before opening another task prevents stale item replacement', async ({ page }) => {
    await page.route(`**/api/tasks/${taskIds.slow}/items`, async route => {
      await new Promise(resolve => setTimeout(resolve, 700));
      await route.continue().catch(() => undefined);
    });
    await page.goto(`/tasks/${taskIds.slow}`);
    await expect(page.getByRole('dialog', { name: new RegExp(names.slow) })).toBeVisible();
    await page.getByRole('button', { name: '关闭物料详情' }).click();

    const currentCard = taskCardFor(page, names.current);
    await expect(currentCard).toBeVisible();
    await currentCard.getByRole('button', { name: '查看 / 编辑', exact: true }).click();
    await expect(page.getByRole('dialog', { name: new RegExp(names.current) })).toBeVisible();
    await expect(page.getByText(currentItem.prompt, { exact: true })).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.getByText(slowItem.prompt, { exact: true })).toHaveCount(0);
    await expect(page.getByText(currentItem.prompt, { exact: true })).toBeVisible();
  });

  test('detail video and audio start paused with controls and remain independently playable', async ({ page }) => {
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function play() {
        this.dataset.playwrightPlaying = 'true';
        this.dispatchEvent(new Event('play'));
        this.dispatchEvent(new Event('playing'));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function pause() {
        delete this.dataset.playwrightPlaying;
        this.dispatchEvent(new Event('pause'));
      };
    });
    await page.goto(`/tasks/${taskIds.assigned}`);
    const dialog = page.getByRole('dialog', { name: new RegExp(names.assigned) });
    await expect(dialog).toBeVisible();
    const media = dialog.locator('video, audio');
    await expect(media).toHaveCount(4);
    await expect.poll(() => media.evaluateAll(elements => elements.map(element => {
      const item = element as HTMLMediaElement;
      return { autoPlay: item.autoplay, paused: item.paused, controls: item.controls, preload: item.preload };
    }))).toEqual(Array.from({ length: 4 }, () => ({ autoPlay: false, paused: true, controls: true, preload: 'metadata' })));

    const videos = dialog.locator('video');
    const audio = dialog.locator('audio');
    await videos.first().evaluate(element => (element as HTMLVideoElement).play());
    await audio.first().evaluate(element => (element as HTMLAudioElement).play());
    await expect(videos.first()).toHaveAttribute('data-playwright-playing', 'true');
    await expect(audio.first()).toHaveAttribute('data-playwright-playing', 'true');
    await expect(videos.nth(1)).not.toHaveAttribute('data-playwright-playing', 'true');

    await page.reload();
    const refreshedMedia = page.getByRole('dialog', { name: new RegExp(names.assigned) }).locator('video, audio');
    await expect(refreshedMedia).toHaveCount(4);
    await expect.poll(() => refreshedMedia.evaluateAll(elements => elements.map(element => ({
      autoPlay: (element as HTMLMediaElement).autoplay,
      paused: (element as HTMLMediaElement).paused,
      controls: (element as HTMLMediaElement).controls,
    })))).toEqual(Array.from({ length: 4 }, () => ({ autoPlay: false, paused: true, controls: true })));
  });
});
