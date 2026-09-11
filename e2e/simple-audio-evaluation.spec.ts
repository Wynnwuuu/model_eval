import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import dataset from '../src/data/evaluation.json' with { type: 'json' };

const storageKey = `model_eval_reviews_v1:${dataset.id}`;
const firstCase = dataset.cases[0];
const labels = ['A', 'B', 'C', 'D', 'E'];
const saveButton = (page: Page) => page.getByRole('button', { name: '保存并下一条', exact: true });
const confirmation = (page: Page) => page.getByRole('checkbox', { name: '我已试听并确认此排序' });
const orderLabels = (page: Page) => page.locator('[data-testid^="rank-row-"]').evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')!.replace('rank-row-', '')));
const readSession = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);

async function playAudio(page: Page) {
  const audio = page.locator('audio');
  await expect.poll(() => audio.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
  await audio.evaluate(async element => { element.muted = true; await element.play(); });
  await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0);
  await expect(confirmation(page)).toBeEnabled();
  await audio.evaluate(element => element.pause());
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function exportRows(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出评价 CSV' }).click();
  const download = await pending;
  return parseCsv(await readFile((await download.path())!, 'utf8'));
}

test('bundled 30 cases retain all 150 original responses, balanced categories, and playable audio bytes', async ({ page, request }) => {
  test.setTimeout(150_000);
  expect(dataset.cases).toHaveLength(30);
  expect(dataset.variants).toHaveLength(5);
  const categoryCounts = Object.fromEntries([...new Set(dataset.cases.map(item => item.category))].map(category => [category, dataset.cases.filter(item => item.category === category).length]));
  expect(Object.values(categoryCounts)).toEqual([5, 5, 5, 5, 5, 5]);
  for (let index = 0; index < 30; index += 6) expect(new Set(dataset.cases.slice(index, index + 6).map(item => item.category)).size).toBe(6);
  await page.goto('/');
  for (let index = 0; index < dataset.cases.length; index++) {
    const item = dataset.cases[index];
    await expect(page.getByRole('heading', { name: `音频 ${index + 1} / 30`, exact: true })).toBeVisible();
    const response = await request.get(item.audioUrl.replace(/^\//, ''));
    expect(response.ok(), item.audioUrl).toBeTruthy();
    const bytes = await response.body();
    expect(createHash('sha256').update(bytes).digest('hex'), item.id).toBe(item.audioSha256);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    await expect.poll(() => page.locator('audio').evaluate(element => element.duration)).toBeCloseTo(item.durationSeconds, 1);
    await page.getByRole('tab', { name: '完整原文' }).click();
    const displayed = await page.locator('[data-testid^="analysis-card-"] pre').allTextContents();
    expect(displayed.sort(), item.id).toEqual(Object.values(item.outputs).sort());
    await expect(page.locator('[data-testid^="analysis-card-"] h3')).toHaveText(labels.map(label => `${label}分析 ${label}`));
    if (index < dataset.cases.length - 1) await page.getByRole('button', { name: '下一条', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存评价', exact: true })).toBeDisabled();
  expect(Object.keys((await readSession(page)).reviews)).toHaveLength(0);
});

test('real playback, drag ranking, refresh, and CSV preserve anonymous labels and exact model mapping', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('simple-audio-evaluation')).toBeVisible();
  await expect(confirmation(page)).toBeDisabled();
  await expect(saveButton(page)).toBeDisabled();
  await page.getByRole('tab', { name: '完整原文' }).click();
  const originals = await page.locator('[data-testid^="analysis-card-"] pre').allTextContents();
  const optionOrder = originals.map(text => dataset.variants.find(variant => firstCase.outputs[variant.id as keyof typeof firstCase.outputs] === text)!.id);
  expect(new Set(optionOrder).size).toBe(5);
  await page.getByTestId('rank-row-E').dragTo(page.getByTestId('rank-row-A'));
  expect(await orderLabels(page)).toEqual(['E', 'A', 'B', 'C', 'D']);
  expect(await page.locator('[data-testid^="analysis-card-"] pre').allTextContents()).toEqual(originals);
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeDisabled();
  await playAudio(page);
  await confirmation(page).check();
  await saveButton(page).click();
  await expect(page.getByRole('heading', { name: '音频 2 / 30', exact: true })).toBeVisible();
  const session = await readSession(page);
  const expectedOrder = [optionOrder[4], ...optionOrder.slice(0, 4)];
  expect(session.reviews[firstCase.id].order).toEqual(expectedOrder);
  expect(session.reviews[firstCase.id].optionOrder).toEqual(optionOrder);
  await page.reload();
  await expect(page.getByText('已评 1 · 已跳过 0 · 共 30 条')).toBeVisible();
  await page.getByRole('button', { name: '上一条', exact: true }).click();
  expect(await orderLabels(page)).toEqual(['E', 'A', 'B', 'C', 'D']);
  await page.getByRole('tab', { name: '完整原文' }).click();
  expect(await page.locator('[data-testid^="analysis-card-"] pre').allTextContents()).toEqual(originals);
  const [headers, ...rows] = await exportRows(page);
  expect(rows).toHaveLength(5);
  const records = rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
  records.forEach((record, index) => {
    const variant = dataset.variants.find(candidate => candidate.id === expectedOrder[index])!;
    expect(record).toMatchObject({ DatasetID: dataset.id, SourceID: firstCase.id, Status: 'ranked', VariantID: variant.id, ModelName: variant.modelName, PromptName: variant.promptName || '', Rank: String(index + 1), BlindLabel: ['E', 'A', 'B', 'C', 'D'][index] });
  });
});

test('skip remains distinct from a ranked answer and can be replaced after listening', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '跳过本条' }).click();
  await expect(page.getByText('已评 0 · 已跳过 1 · 共 30 条')).toBeVisible();
  const [headers, ...rows] = await exportRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0][headers.indexOf('Status')]).toBe('skipped');
  expect(rows[0][headers.indexOf('Rank')]).toBe('');
  expect(rows[0][headers.indexOf('VariantID')]).toBe('');
  await page.getByRole('button', { name: '上一条', exact: true }).click();
  await playAudio(page);
  await confirmation(page).check();
  await saveButton(page).click();
  await expect(page.getByText('已评 1 · 已跳过 0 · 共 30 条')).toBeVisible();
  expect((await readSession(page)).reviews[firstCase.id].status).toBe('ranked');
});

test('storage write failure keeps draft retryable without falsely advancing or replacing durable data', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(key => localStorage.getItem(key), storageKey);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    (window as typeof window & { restoreStorage: () => void }).restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('simulated quota failure', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, storageKey);
  await page.getByRole('button', { name: '将分析 B 上移' }).click();
  await playAudio(page);
  await confirmation(page).check();
  await saveButton(page).click();
  await expect(page.getByRole('alert')).toContainText('保存失败');
  await expect(page.getByRole('heading', { name: '音频 1 / 30', exact: true })).toBeVisible();
  expect(await orderLabels(page)).toEqual(['B', 'A', 'C', 'D', 'E']);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(before);
  await page.evaluate(() => (window as typeof window & { restoreStorage: () => void }).restoreStorage());
  await saveButton(page).click();
  await expect(page.getByRole('heading', { name: '音频 2 / 30', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('已评 1 · 已跳过 0 · 共 30 条')).toBeVisible();
});

test('malformed saved progress is not overwritten or silently treated as an empty assessment', async ({ page }) => {
  const damaged = '{"version":1,"reviews":{"saved-important-data":true}}';
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: damaged });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('未覆盖已有记录');
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(damaged);
});

test('another tab updating progress blocks stale writes and export until explicit reload', async ({ page, context }) => {
  await page.goto('/');
  await playAudio(page);
  await confirmation(page).check();
  await saveButton(page).click();
  const otherTab = await context.newPage();
  await otherTab.goto('/');
  await expect(otherTab.getByRole('heading', { name: '音频 2 / 30', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '将分析 B 上移' }).click();
  await otherTab.getByRole('button', { name: '跳过本条' }).click();
  await expect(otherTab.getByRole('heading', { name: '音频 3 / 30', exact: true })).toBeVisible();
  const durable = await otherTab.evaluate(key => localStorage.getItem(key), storageKey);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '导出评价 CSV' })).toBeDisabled();
  expect(await orderLabels(page)).toEqual(['B', 'A', 'C', 'D', 'E']);
  await page.getByRole('button', { name: '重新读取本地进度' }).click();
  await expect(page.getByRole('heading', { name: '音频 3 / 30', exact: true })).toBeVisible();
  await expect(page.getByText('已评 1 · 已跳过 1 · 共 30 条')).toBeVisible();
  await expect(page.getByRole('button', { name: '导出评价 CSV' })).toBeEnabled();
  await expect(confirmation(page)).toBeDisabled();
  expect(await orderLabels(page)).toEqual(labels);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(durable);
  await otherTab.close();
});

test('mobile reading and accessible ranking controls fit without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const name of ['整体描述', '环境与声源', '时间变化', '完整原文']) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.getByRole('button', { name: '将分析 B 上移' }).click();
  expect(await orderLabels(page)).toEqual(['B', 'A', 'C', 'D', 'E']);
  await expect(page.getByRole('button', { name: '将分析 B 上移' })).toBeDisabled();
  await page.getByRole('button', { name: '恢复原顺序' }).click();
  expect(await orderLabels(page)).toEqual(labels);
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeEnabled();
});
