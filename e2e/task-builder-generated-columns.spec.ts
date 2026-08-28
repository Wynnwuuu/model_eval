import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8787';
const runId = `task-builder-generated-columns-${Date.now()}`;
const datasetId = `${runId}-dataset`;
const datasetName = `Sparse generated output ${runId}`;
const GENERATED_RESULT = 'generated_result';
const OLD_IMAGE_RESULT = 'old_image_result';
const LATE_RESULT = 'late_result';
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

const outputPanel = (page: Page) => page
  .getByText('模型结果列 (可多选)', { exact: true })
  .locator('..')
  .locator('..');

const inputPanel = (page: Page) => page
  .getByText('输入列 (可多选，如提示词、图片、音频等)', { exact: true })
  .locator('..')
  .locator('..');

const baseSchema = [
  { key: 'case_id', label: 'case_id', type: 'text', role: 'case_id' },
  { key: 'prompt', label: 'prompt', type: 'text', role: 'input' },
  { key: OLD_IMAGE_RESULT, label: OLD_IMAGE_RESULT, type: 'image_url', role: 'output', previewType: 'image' },
  { key: GENERATED_RESULT, label: GENERATED_RESULT, type: 'video_url', role: 'output', previewType: 'video' },
  { key: `${GENERATED_RESULT}_status`, label: `${GENERATED_RESULT}_status`, type: 'text', role: 'metadata' },
  { key: `${GENERATED_RESULT}_seed`, label: `${GENERATED_RESULT}_seed`, type: 'text', role: 'metadata' },
  { key: `${GENERATED_RESULT}_request_id`, label: `${GENERATED_RESULT}_request_id`, type: 'text', role: 'metadata' },
  { key: `${GENERATED_RESULT}_error`, label: `${GENERATED_RESULT}_error`, type: 'text', role: 'metadata' },
  { key: `${GENERATED_RESULT}_params_json`, label: `${GENERATED_RESULT}_params_json`, type: 'text', role: 'system' },
  { key: `${GENERATED_RESULT}_status_note`, label: `${GENERATED_RESULT}_status_note`, type: 'text', role: 'metadata' },
] as const;

const baseItems = [
  {
    case_id: 'case-first-failed',
    prompt: 'The first generation failed.',
    [OLD_IMAGE_RESULT]: 'https://example.com/old-first.png',
    [`${GENERATED_RESULT}_status`]: 'failed',
    [`${GENERATED_RESULT}_error`]: 'Expected fixture failure',
  },
  {
    case_id: 'case-later-succeeded',
    prompt: 'The later generation succeeded.',
    [OLD_IMAGE_RESULT]: 'https://example.com/old-second.png',
    [GENERATED_RESULT]: 'https://example.com/generated-second.mp4',
    [`${GENERATED_RESULT}_status`]: 'succeeded',
    [`${GENERATED_RESULT}_seed`]: 42,
    [`${GENERATED_RESULT}_request_id`]: 'fixture-request',
    [`${GENERATED_RESULT}_params_json`]: '{"fixture":true}',
    [`${GENERATED_RESULT}_status_note`]: 'ordinary business note',
    late_business_column: 'present only after row zero',
  },
];

test.describe.serial('task builder generated result columns', () => {
  let api: APIRequestContext;
  let currentDataset: any;

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: API_BASE_URL, extraHTTPHeaders: authHeaders });
    const response = await jsonRequest<{ dataset: any }>(api, `/api/datasets/${datasetId}`, 'PUT', {
      dataset: {
        id: datasetId,
        name: datasetName,
        description: 'Sparse generated output browser regression',
        tags: ['e2e'],
        inputSchema: baseSchema,
        items: baseItems,
        inputType: 'text',
        modality: 'multimodal',
        columnMappings: {
          caseId: 'case_id',
          inputColumns: ['prompt'],
          outputColumns: [OLD_IMAGE_RESULT, GENERATED_RESULT],
          dimensionColumns: [],
          referenceColumns: [],
          standard: { case_id: 'case_id', full_prompt: 'prompt' },
        },
        version: 1,
        versionHistory: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    currentDataset = response.dataset;
  });

  test.afterAll(async () => {
    await api?.delete(`/api/datasets/${datasetId}`, { headers: authHeaders }).catch(() => undefined);
    await api?.dispose();
  });

  test('ordinary dataset selection exposes sparse results and hides generation audit columns', async ({ page }) => {
    await page.goto('/tasks/new');
    await expect(page.getByRole('heading', { name: '评测物料构建器' })).toBeVisible();
    await page.getByRole('combobox').filter({ has: page.locator(`option[value="${datasetId}"]`) }).selectOption(datasetId);

    await expect(outputPanel(page).getByRole('checkbox', { name: GENERATED_RESULT, exact: true })).toBeVisible();
    await expect(page.getByText('late_business_column', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`${GENERATED_RESULT}_status_note`, { exact: true }).first()).toBeVisible();
    for (const companion of ['status', 'seed', 'request_id', 'error', 'params_json']) {
      await expect(page.getByText(`${GENERATED_RESULT}_${companion}`, { exact: true })).toHaveCount(0);
    }
  });

  test('generation shortcut renders a checked target and uses its video modality', async ({ page }) => {
    await page.goto(`/tasks/new?datasetId=${encodeURIComponent(datasetId)}&modelColumn=${encodeURIComponent(GENERATED_RESULT)}`);
    await expect(page.getByRole('heading', { name: '评测物料构建器' })).toBeVisible();
    await expect(outputPanel(page).getByRole('checkbox', { name: GENERATED_RESULT, exact: true })).toBeChecked();
    await expect(page.getByText(`A · ${GENERATED_RESULT}`, { exact: true })).toBeVisible();
    await expect(page.getByText('输出结果类型', { exact: true }).locator('..').locator('select')).toHaveValue('video');
  });

  test('generation shortcut never creates a hidden audit-column selection', async ({ page }) => {
    const auditColumn = `${GENERATED_RESULT}_status`;
    await page.goto(`/tasks/new?datasetId=${encodeURIComponent(datasetId)}&modelColumn=${encodeURIComponent(auditColumn)}`);
    await expect(page.getByRole('heading', { name: '评测物料构建器' })).toBeVisible();
    await expect(page.getByText(`A · ${auditColumn}`, { exact: true })).toHaveCount(0);
    await expect(page.getByText(auditColumn, { exact: true })).toHaveCount(0);
  });

  test('dataset refresh adds columns without clearing valid mapping selections', async ({ page }) => {
    await page.goto('/tasks/new');
    await page.getByRole('combobox').filter({ has: page.locator(`option[value="${datasetId}"]`) }).selectOption(datasetId);
    await inputPanel(page).getByRole('checkbox', { name: 'prompt', exact: true }).check();
    await outputPanel(page).getByRole('checkbox', { name: GENERATED_RESULT, exact: true }).check();

    const response = await jsonRequest<{ dataset: any }>(api, `/api/datasets/${datasetId}`, 'PUT', {
      dataset: {
        ...currentDataset,
        inputSchema: [
          ...currentDataset.inputSchema,
          { key: LATE_RESULT, label: LATE_RESULT, type: 'video_url', role: 'output', previewType: 'video' },
        ],
        items: currentDataset.items.map((row: Record<string, unknown>, index: number) => (
          index === 1 ? { ...row, [LATE_RESULT]: 'https://example.com/late-second.mp4' } : row
        )),
        columnMappings: {
          ...currentDataset.columnMappings,
          outputColumns: [...currentDataset.columnMappings.outputColumns, LATE_RESULT],
        },
        version: 2,
        updatedAt: Date.now(),
      },
      expectedVersion: currentDataset.version,
    });
    currentDataset = response.dataset;

    await expect(outputPanel(page).getByRole('checkbox', { name: LATE_RESULT, exact: true })).toBeVisible({ timeout: 12_000 });
    await expect(inputPanel(page).getByRole('checkbox', { name: 'prompt', exact: true })).toBeChecked();
    await expect(outputPanel(page).getByRole('checkbox', { name: GENERATED_RESULT, exact: true })).toBeChecked();

    const removedColumns = new Set([
      GENERATED_RESULT,
      `${GENERATED_RESULT}_status`,
      `${GENERATED_RESULT}_seed`,
      `${GENERATED_RESULT}_request_id`,
      `${GENERATED_RESULT}_error`,
      `${GENERATED_RESULT}_params_json`,
    ]);
    const deletionResponse = await jsonRequest<{ dataset: any }>(api, `/api/datasets/${datasetId}`, 'PUT', {
      dataset: {
        ...currentDataset,
        inputSchema: currentDataset.inputSchema.filter((field: { key: string }) => !removedColumns.has(field.key)),
        items: currentDataset.items.map((row: Record<string, unknown>) => Object.fromEntries(
          Object.entries(row).filter(([key]) => !removedColumns.has(key)),
        )),
        columnMappings: {
          ...currentDataset.columnMappings,
          outputColumns: currentDataset.columnMappings.outputColumns.filter((column: string) => column !== GENERATED_RESULT),
        },
        version: 3,
        updatedAt: Date.now(),
      },
      expectedVersion: currentDataset.version,
    });
    currentDataset = deletionResponse.dataset;

    await expect(page.getByText(GENERATED_RESULT, { exact: true })).toHaveCount(0, { timeout: 12_000 });
    await expect(page.getByText(`A · ${GENERATED_RESULT}`, { exact: true })).toHaveCount(0);
    await expect(inputPanel(page).getByRole('checkbox', { name: 'prompt', exact: true })).toBeChecked();
  });
});
