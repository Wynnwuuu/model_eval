import { expect, test, type Page } from '@playwright/test';
import dataset from '../src/data/evaluation.json' with { type: 'json' };

const rail = (page: Page) => page.getByTestId('floating-audio-player');
const audio = (page: Page) => page.locator('audio');
const confirmation = (page: Page) => page.getByRole('checkbox', { name: '我已试听并确认此排序' });
const playButton = (page: Page) => page.getByRole('button', { name: '播放音频', exact: true });
const pauseButton = (page: Page) => page.getByRole('button', { name: '暂停音频', exact: true });
const collapseButton = (page: Page) => page.getByRole('button', { name: '收起音频栏', exact: true });
const expandButton = (page: Page) => page.getByRole('button', { name: '展开音频栏', exact: true });

async function beginPlayback(page: Page) {
  await expect(audio(page)).toHaveCount(1);
  await expect.poll(() => audio(page).evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
  await audio(page).evaluate(element => { element.muted = true; });
  await playButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect.poll(() => audio(page).evaluate(element => element.currentTime)).toBeGreaterThan(0.2);
  await expect(confirmation(page)).toBeEnabled();
}

test('desktop player stays alongside long analysis and keeps one continuous audio while folded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(collapseButton(page)).toBeVisible();
  await expect(rail(page).getByText('当前音频', { exact: true })).toBeVisible();
  await expect(rail(page)).toContainText(`1 / ${dataset.cases.length}`);
  expect(await audio(page).evaluate(element => element.controls)).toBe(false);
  await page.getByRole('tab', { name: '完整原文' }).click();
  const initialBox = (await rail(page).boundingBox())!;
  const readingBox = (await page.locator('#analysis-reading-panel').boundingBox())!;
  expect(initialBox.x).toBeGreaterThanOrEqual(0);
  expect(initialBox.x + initialBox.width).toBeLessThanOrEqual(readingBox.x);
  await beginPlayback(page);
  const player = (await audio(page).elementHandle())!;
  const beforeFold = await player.evaluate(element => element.currentTime);
  await collapseButton(page).click();
  await expect(expandButton(page)).toBeVisible();
  await expect(audio(page)).toHaveCount(1);
  expect(await player.evaluate(element => element === document.querySelector('audio'))).toBe(true);
  await expect.poll(() => player.evaluate(element => element.currentTime)).toBeGreaterThan(beforeFold);
  expect(await player.evaluate(element => element.paused)).toBe(false);
  await expandButton(page).click();
  await expect(pauseButton(page)).toBeVisible();
  expect(await player.evaluate(element => element === document.querySelector('audio'))).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 1100, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  const scrolledBox = (await rail(page).boundingBox())!;
  expect(Math.abs(scrolledBox.x - initialBox.x)).toBeLessThan(2);
  expect(Math.abs(scrolledBox.y - initialBox.y)).toBeLessThan(2);
  await expect(pauseButton(page)).toBeInViewport();
  await pauseButton(page).click();
  await expect.poll(() => player.evaluate(element => element.paused)).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
});

test('seek and restart control the same audio, then changing the case stops playback and clears listening confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await beginPlayback(page);
  await pauseButton(page).click();
  const slider = page.getByRole('slider', { name: '音频播放进度' });
  await expect(slider).toBeEnabled();
  const duration = await audio(page).evaluate(element => element.duration);
  const sliderBox = (await slider.boundingBox())!;
  await page.mouse.click(sliderBox.x + sliderBox.width * 0.65, sliderBox.y + sliderBox.height / 2);
  await expect.poll(() => audio(page).evaluate(element => element.currentTime)).toBeGreaterThan(duration * 0.5);
  expect(await audio(page).evaluate(element => element.paused)).toBe(true);
  await page.getByRole('button', { name: '从头播放', exact: true }).click();
  await expect(pauseButton(page)).toBeVisible();
  await expect.poll(() => audio(page).evaluate(element => element.currentTime)).toBeLessThan(2);
  await expect.poll(() => audio(page).evaluate(element => element.currentTime)).toBeGreaterThan(0.1);
  const firstAudio = (await audio(page).elementHandle())!;
  await page.getByRole('button', { name: '下一条', exact: true }).click();
  await expect(page.getByRole('heading', { name: `音频 2 / ${dataset.cases.length}`, exact: true })).toBeVisible();
  await expect(audio(page)).toHaveCount(1);
  await expect(audio(page)).toHaveAttribute('aria-label', '音频 2');
  await expect.poll(() => firstAudio.evaluate(element => element.paused)).toBe(true);
  await expect.poll(() => audio(page).evaluate(element => element.paused)).toBe(true);
  await expect.poll(() => audio(page).evaluate(element => element.currentTime)).toBe(0);
  await expect(confirmation(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存并下一条', exact: true })).toBeDisabled();
  await expect(playButton(page)).toBeVisible();
  await expect(rail(page)).toContainText(`2 / ${dataset.cases.length}`);
});

test('mobile player starts folded and fits the viewport when expanded while reading below the page top', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(expandButton(page)).toBeVisible();
    await expect(collapseButton(page)).toHaveCount(0);
    await page.getByRole('tab', { name: '完整原文' }).click();
    await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }));
    await expect(expandButton(page)).toBeInViewport();
    await expandButton(page).click();
    await expect(collapseButton(page)).toBeInViewport();
    await expect(playButton(page)).toBeInViewport();
    const box = (await rail(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await beginPlayback(page);
    await collapseButton(page).click();
    await expect(expandButton(page)).toBeInViewport();
    expect(await audio(page).evaluate(element => element.paused)).toBe(false);
    await expandButton(page).click();
    await pauseButton(page).click();
  }
});

test('failed audio loads remain unconfirmed and can be retried from the floating player', async ({ page }) => {
  let failAudio = true;
  await page.route(`**${dataset.cases[0].audioUrl}`, route => failAudio ? route.abort('failed') : route.continue());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(rail(page).getByRole('alert')).toContainText('音频加载失败');
  await expect(confirmation(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存并下一条', exact: true })).toBeDisabled();
  failAudio = false;
  await rail(page).getByRole('button', { name: '重试加载', exact: true }).click();
  await expect.poll(() => audio(page).evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
  await expect(rail(page).getByRole('alert')).toHaveCount(0);
  await expect(confirmation(page)).toBeDisabled();
  await beginPlayback(page);
  await pauseButton(page).click();
});
