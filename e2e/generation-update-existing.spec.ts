import { expect, test } from '@playwright/test';

const pixel = (color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`)}`;

const model = {
  id: 'test/image-model',
  modelName: 'test/image-model',
  displayName: 'Test image model',
  provider: 'test',
  outputModality: 'image',
  previewType: 'image',
  capabilities: ['text_to_image'],
  supportsSeed: false,
  controls: [],
  advancedParameters: [],
  invalidParameters: [],
  inputSchema: {},
  options: {},
  configFingerprint: 'test-image-model-fingerprint',
};

const dataset = {
  id: 'update-existing-e2e',
  name: 'Update existing E2E',
  description: '',
  tags: [],
  version: 3,
  createdAt: 1,
  updatedAt: 1,
  modality: 'image',
  inputType: 'text',
  inputSchema: [
    { key: 'case_id', label: 'case_id', type: 'text', role: 'metadata', previewType: 'text' },
    { key: 'prompt', label: 'prompt', type: 'text', role: 'input', previewType: 'text' },
    { key: 'generated_image', label: 'generated_image', type: 'image_url', role: 'output', previewType: 'image' },
    { key: 'generated_image_params_json', label: 'generated_image_params_json', type: 'text', role: 'system', previewType: 'text' },
  ],
  items: [
    { __datasetItemId: 'blank-item', case_id: 'blank-case', prompt: 'Create a blank case', generated_image: '' },
    {
      __datasetItemId: 'filled-item',
      case_id: 'filled-case',
      prompt: 'Replace only after explicit selection',
      generated_image: pixel('#0f172a'),
      generated_image_params_json: JSON.stringify({
        modelName: model.modelName,
        configFingerprint: model.configFingerprint,
      }),
    },
  ],
  columnMappings: {
    inputColumns: ['prompt'],
    outputColumns: ['generated_image'],
    dimensionColumns: [],
    referenceColumns: [],
    standard: { caseId: 'case_id', prompt: 'prompt' },
    caseId: 'case_id',
  },
};

test('update-existing defaults to blanks, requires row replacement selection and double confirmation', async ({ page }) => {
  let preflightRequest: Record<string, any> | undefined;
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/datasets') {
      await route.fulfill({ json: { datasets: [dataset] } });
      return;
    }
    if (url.pathname === '/api/tasks') {
      await route.fulfill({ json: { tasks: [] } });
      return;
    }
    if (url.pathname === '/api/generation/models') {
      await route.fulfill({ json: { models: [model] } });
      return;
    }
    if (url.pathname === '/api/generation/health') {
      await route.fulfill({ json: {
        configured: true,
        aionConfigured: true,
        ossConfigured: false,
        assetMode: 'temporary_url',
        executionTransport: 'model_api',
        durableAssets: false,
        localUploadsEnabled: false,
        workerEnabled: true,
        executionEnabled: true,
        workerAvailable: true,
        activeWorkerCount: 1,
        workerHeartbeatAgeMs: 100,
        workerVersions: ['e2e'],
        maxBatchSize: 500,
        imageConcurrency: 4,
        videoConcurrency: 2,
        taskTimeoutMs: 60_000,
      } });
      return;
    }
    if (url.pathname === '/api/generation/preflights' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      preflightRequest = payload.preflight;
      const selectedIds = preflightRequest?.selectedDatasetItemIds || [];
      const replacementIds = new Set(preflightRequest?.replacementDatasetItemIds || []);
      await route.fulfill({ json: { preflight: {
        id: 'preflight-update-existing',
        model,
        configFingerprint: model.configFingerprint,
        validCount: selectedIds.length,
        invalidCount: 0,
        total: selectedIds.length,
        selectionSummary: {
          datasetTotal: dataset.items.length,
          selected: selectedIds.length,
          valid: selectedIds.length,
          invalid: 0,
          unselected: dataset.items.length - selectedIds.length,
          fillSelected: selectedIds.filter((id: string) => !replacementIds.has(id)).length,
          replaceSelected: replacementIds.size,
        },
        batchWarnings: [],
        costEstimate: { known: true, totalCredits: 0, unitCredits: 0, unitLabel: 'case' },
        cases: selectedIds.map((id: string, index: number) => ({
          valid: true,
          generationType: 'text_to_image',
          errors: [],
          warnings: [],
          resolvedCase: {
            datasetItemId: id,
            caseId: id === 'blank-item' ? 'blank-case' : 'filled-case',
            rowIndex: index,
            prompt: id === 'blank-item' ? 'Create a blank case' : 'Replace only after explicit selection',
            targetWriteIntent: { action: replacementIds.has(id) ? 'replace' : 'fill', expectedSnapshotFingerprint: `server-${id}` },
          },
        })),
        requestHash: 'update-existing-request-hash',
        expiresAt: Date.now() + 60_000,
      } } });
      return;
    }
    if (url.pathname === '/api/generation/jobs') {
      await route.fulfill({ json: { jobs: [], total: 0, page: 1, limit: 50 } });
      return;
    }
    if (url.pathname === '/api/generation/queue') {
      await route.fulfill({ json: { queue: { items: [] } } });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });

  await page.goto('/datasets/update-existing-e2e/generation?view=new');
  await page.waitForFunction(() => document.body.innerText.includes('配置生成')
    || document.body.innerText.includes('页面加载失败'));
  if (await page.getByRole('heading', { name: '页面加载失败' }).count()) {
    throw new Error(pageErrors.join('\n') || 'Generation workspace entered its error boundary.');
  }
  await page.getByRole('button', { name: '配置生成' }).click();
  await page.getByRole('button', { name: '更新已有列' }).click();
  await page.getByLabel('选择待更新的模型输出列').selectOption('generated_image');
  await page.getByRole('button', { name: '下一步' }).click();

  const blank = page.getByRole('checkbox', { name: '选择 blank-case' });
  const filled = page.getByRole('checkbox', { name: '选择 filled-case' });
  await expect(blank).toBeChecked();
  await expect(filled).not.toBeChecked();

  await filled.check();
  await expect(page.getByText('将替换')).toBeVisible();
  await page.getByRole('button', { name: '清空选择' }).click();
  await page.getByRole('button', { name: '选择当前范围全部空白项' }).click();
  await expect(blank).toBeChecked();
  await expect(filled).not.toBeChecked();

  await filled.check();
  await page.getByRole('button', { name: '执行预检' }).click();
  await expect.poll(() => preflightRequest?.replacementDatasetItemIds).toEqual(['filled-item']);
  await expect(page.getByText('新增', { exact: true }).locator('..')).toContainText('1');
  await expect(page.getByText('替换', { exact: true }).locator('..')).toContainText('1');

  const submit = page.getByRole('button', { name: '确认并提交生成' });
  await page.getByText('我已核对有效/无效 case、模型配置快照和费用信息。').click();
  await expect(submit).toBeDisabled();
  await page.getByText(/我确认用本批次新结果替换 1 个已有结果/).click();
  await expect(submit).toBeEnabled();
});
