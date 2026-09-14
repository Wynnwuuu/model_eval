import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import dataset from '../src/data/evaluation.json' with { type: 'json' };

const storageKey = `model_eval_reviews_v1:${dataset.id}`;
const firstCase = dataset.cases[0];
const caseCount = dataset.cases.length;
const variantCount = dataset.variants.length;
const labels = dataset.variants.map((_, index) => String.fromCharCode(65 + index));
const swappedLabels = [labels[1], labels[0], ...labels.slice(2)];
const caseHeading = (page: Page, index: number) => page.getByRole('heading', { name: `音频 ${index} / ${caseCount}`, exact: true });
const progress = (page: Page, ranked: number, skipped: number) => page.getByText(`已评 ${ranked} · 已跳过 ${skipped} · 共 ${caseCount} 条`);
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

test('every bundled case retains each complete original response and playable matching audio bytes', async ({ page, request }) => {
  test.setTimeout(150_000);
  expect(caseCount).toBeGreaterThan(0);
  expect(variantCount).toBeGreaterThanOrEqual(2);
  expect(variantCount).toBeLessThanOrEqual(5);
  expect(new Set(dataset.cases.map(item => item.id)).size).toBe(caseCount);
  const variantIds = dataset.variants.map(variant => variant.id);
  expect(new Set(variantIds).size).toBe(variantCount);
  await page.goto('/?view=blind');
  for (let index = 0; index < dataset.cases.length; index++) {
    const item = dataset.cases[index];
    expect(Object.keys(item.outputs).sort(), item.id).toEqual([...variantIds].sort());
    expect(Object.values(item.outputs).every(text => text.trim().length > 0), item.id).toBeTruthy();
    await expect(caseHeading(page, index + 1)).toBeVisible();
    await expect(page.getByText(`分析 A–${labels.at(-1)} 的位置固定。`, { exact: false })).toBeVisible();
    const response = await request.get(item.audioUrl.replace(/^\//, ''));
    expect(response.ok(), item.audioUrl).toBeTruthy();
    const bytes = await response.body();
    expect(createHash('sha256').update(bytes).digest('hex'), item.id).toBe(item.audioSha256);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    await expect.poll(() => page.locator('audio').evaluate(element => element.duration)).toBeCloseTo(item.durationSeconds, 1);
    await playAudio(page);
    await expect(page.getByText(`请确认从第 1 名到第 ${variantCount} 名的顺序`, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '完整原文' }).click();
    const displayed = await page.locator('[data-testid^="analysis-card-"] pre').allTextContents();
    expect(displayed.sort(), item.id).toEqual(Object.values(item.outputs).sort());
    await expect(page.locator('[data-testid^="analysis-card-"] h3')).toHaveText(labels.map(label => `${label}分析 ${label}`));
    expect(await orderLabels(page)).toEqual(labels);
    await expect(page.getByRole('button', { name: `将分析 ${labels[0]} 上移` })).toBeDisabled();
    await expect(page.getByRole('button', { name: `将分析 ${labels.at(-1)} 下移` })).toBeDisabled();
    if (index < dataset.cases.length - 1) await page.getByRole('button', { name: '下一条', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存评价', exact: true })).toBeDisabled();
  expect(Object.keys((await readSession(page)).reviews)).toHaveLength(0);
});

test('real playback, drag ranking, refresh, and CSV preserve anonymous labels and exact model mapping', async ({ page }) => {
  await page.goto('/?view=blind');
  await expect(page.getByTestId('simple-audio-evaluation')).toBeVisible();
  await expect(confirmation(page)).toBeDisabled();
  await expect(saveButton(page)).toBeDisabled();
  await page.getByRole('tab', { name: '完整原文' }).click();
  const originals = await page.locator('[data-testid^="analysis-card-"] pre').allTextContents();
  const optionOrder = originals.map(text => dataset.variants.find(variant => firstCase.outputs[variant.id as keyof typeof firstCase.outputs] === text)!.id);
  expect(new Set(optionOrder).size).toBe(variantCount);
  await page.getByTestId('rank-row-B').dragTo(page.getByTestId('rank-row-A'));
  expect(await orderLabels(page)).toEqual(swappedLabels);
  expect(await page.locator('[data-testid^="analysis-card-"] pre').allTextContents()).toEqual(originals);
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeDisabled();
  await playAudio(page);
  await confirmation(page).check();
  await saveButton(page).click();
  await expect(caseHeading(page, 2)).toBeVisible();
  const session = await readSession(page);
  const expectedOrder = [optionOrder[1], optionOrder[0], ...optionOrder.slice(2)];
  expect(session.reviews[firstCase.id].order).toEqual(expectedOrder);
  expect(session.reviews[firstCase.id].optionOrder).toEqual(optionOrder);
  await page.reload();
  await expect(progress(page, 1, 0)).toBeVisible();
  await page.getByRole('button', { name: '上一条', exact: true }).click();
  expect(await orderLabels(page)).toEqual(swappedLabels);
  await page.getByRole('tab', { name: '完整原文' }).click();
  expect(await page.locator('[data-testid^="analysis-card-"] pre').allTextContents()).toEqual(originals);
  const [headers, ...rows] = await exportRows(page);
  expect(rows).toHaveLength(variantCount);
  const records = rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
  records.forEach((record, index) => {
    const variant = dataset.variants.find(candidate => candidate.id === expectedOrder[index])!;
    expect(record).toMatchObject({ DatasetID: dataset.id, ReviewerID: session.reviewerId, SourceID: firstCase.id, AudioFile: firstCase.audioUrl, Status: 'ranked', VariantID: variant.id, ModelName: variant.modelName, PromptName: variant.promptName || '', IsBaseline: String(variant.isBaseline), Rank: String(index + 1), BlindLabel: swappedLabels[index] });
  });
});

test('skip remains distinct from a ranked answer and can be replaced after listening', async ({ page }) => {
  await page.goto('/?view=blind');
  await page.getByRole('button', { name: '跳过本条' }).click();
  await expect(progress(page, 0, 1)).toBeVisible();
  const [headers, ...rows] = await exportRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0][headers.indexOf('Status')]).toBe('skipped');
  expect(rows[0][headers.indexOf('Rank')]).toBe('');
  expect(rows[0][headers.indexOf('VariantID')]).toBe('');
  await page.getByRole('button', { name: '上一条', exact: true }).click();
  await playAudio(page);
  await confirmation(page).check();
  await saveButton(page).click();
  await expect(progress(page, 1, 0)).toBeVisible();
  expect((await readSession(page)).reviews[firstCase.id].status).toBe('ranked');
  const [rankedHeaders, ...rankedRows] = await exportRows(page);
  expect(rankedRows).toHaveLength(variantCount);
  expect(rankedRows.map(row => row[rankedHeaders.indexOf('Rank')])).toEqual(labels.map((_, index) => String(index + 1)));
  expect(rankedRows.every(row => row[rankedHeaders.indexOf('Status')] === 'ranked')).toBeTruthy();
});

test('storage write failure keeps draft retryable without falsely advancing or replacing durable data', async ({ page }) => {
  await page.goto('/?view=blind');
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
  await expect(caseHeading(page, 1)).toBeVisible();
  expect(await orderLabels(page)).toEqual(swappedLabels);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(before);
  await page.evaluate(() => (window as typeof window & { restoreStorage: () => void }).restoreStorage());
  await saveButton(page).click();
  await expect(caseHeading(page, 2)).toBeVisible();
  await page.reload();
  await expect(progress(page, 1, 0)).toBeVisible();
});

test('malformed saved progress is not overwritten or silently treated as an empty assessment', async ({ page }) => {
  const damaged = '{"version":1,"reviews":{"saved-important-data":true}}';
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: damaged });
  await page.goto('/?view=blind');
  await expect(page.getByRole('alert')).toContainText('未覆盖已有记录');
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(damaged);
});

test('another tab updating progress blocks stale writes and export until explicit reload', async ({ page, context }) => {
  await page.goto('/?view=blind');
  await playAudio(page);
  await confirmation(page).check();
  await saveButton(page).click();
  const otherTab = await context.newPage();
  await otherTab.goto('/');
  await expect(caseHeading(otherTab, 2)).toBeVisible();
  await page.getByRole('button', { name: '将分析 B 上移' }).click();
  await otherTab.getByRole('button', { name: '跳过本条' }).click();
  await expect(caseHeading(otherTab, 3)).toBeVisible();
  const durable = await otherTab.evaluate(key => localStorage.getItem(key), storageKey);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '导出评价 CSV' })).toBeDisabled();
  expect(await orderLabels(page)).toEqual(swappedLabels);
  await page.getByRole('button', { name: '重新读取本地进度' }).click();
  await expect(caseHeading(page, 3)).toBeVisible();
  await expect(progress(page, 1, 1)).toBeVisible();
  await expect(page.getByRole('button', { name: '导出评价 CSV' })).toBeEnabled();
  await expect(confirmation(page)).toBeDisabled();
  expect(await orderLabels(page)).toEqual(labels);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(durable);
  await otherTab.close();
});

test('mobile reading and accessible ranking controls fit without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=blind');
  await expect(page.locator('[data-testid^="analysis-card-"]')).toHaveCount(variantCount);
  await expect(page.locator('[data-testid^="rank-row-"]')).toHaveCount(variantCount);
  for (const name of ['整体描述', '环境与声源', '时间变化', '完整原文']) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.getByRole('button', { name: '将分析 B 上移' }).click();
  expect(await orderLabels(page)).toEqual(swappedLabels);
  await expect(page.getByRole('button', { name: '将分析 B 上移' })).toBeDisabled();
  await page.getByRole('button', { name: '恢复原顺序' }).click();
  expect(await orderLabels(page)).toEqual(labels);
  await expect(page.getByRole('button', { name: '下一条', exact: true })).toBeEnabled();
});
