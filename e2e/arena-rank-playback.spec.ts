import { test, expect } from '@playwright/test';

const models = [
  { id: 'model-a', name: 'Model A' },
  { id: 'model-b', name: 'Model B' },
  { id: 'model-c', name: 'Model C' },
];

const buildItem = (index: number) => ({
  id: `arena-rank-playback-${index}`,
  modelA_Url: `https://example.com/arena-rank/${index}/a.mp4`,
  modelB_Url: `https://example.com/arena-rank/${index}/b.mp4`,
  modelOutputs: models.map(model => ({
    modelId: model.id,
    modelName: model.name,
    url: `https://example.com/arena-rank/${index}/${model.id}.mp4`,
  })),
  prompt: `Arena-rank playback case ${index}`,
  type: 'video',
});

const expectedPausedState = Array.from({ length: models.length }, () => ({
  autoPlay: false,
  paused: true,
  controls: true,
}));

const readPlaybackState = (elements: HTMLVideoElement[]) => elements.map(video => ({
  autoPlay: video.autoplay,
  paused: video.paused,
  controls: video.controls,
}));

test('Arena-rank candidate media starts paused and keeps independent controls', async ({ page }) => {
  await page.addInitScript(({ session }) => {
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

    localStorage.setItem('modeleval_session', JSON.stringify(session));
  }, {
    session: {
      items: [buildItem(1), buildItem(2)],
      votes: [],
      currentIndex: 0,
      userName: 'Playback Tester',
      modelNames: { a: 'Model A', b: 'Model B' },
      taskModels: models,
      taskParadigm: 'Arena-rank',
      taskEvaluationConfig: { method: 'rank_order', blind: true, tiePolicy: 'allow' },
      activeTaskId: null,
      timestamp: 1,
      sessionId: 'arena-rank-playback-session',
    },
  });

  await page.goto('/evaluation');
  await expect(page.getByRole('button', { name: '继续评测' })).toBeVisible();
  await page.getByRole('button', { name: '继续评测' }).click();
  await expect(page.getByText('Arena-rank', { exact: true }).first()).toBeVisible();

  const videos = page.locator('video');
  await expect(videos).toHaveCount(models.length);
  await expect.poll(() => videos.evaluateAll(readPlaybackState)).toEqual(expectedPausedState);

  await videos.nth(0).evaluate(video => (video as HTMLVideoElement).play());
  await videos.nth(1).evaluate(video => (video as HTMLVideoElement).play());
  await expect(videos.nth(0)).toHaveAttribute('data-playwright-playing', 'true');
  await expect(videos.nth(1)).toHaveAttribute('data-playwright-playing', 'true');
  await expect(videos.nth(2)).not.toHaveAttribute('data-playwright-playing', 'true');

  await page.getByRole('button', { name: '跳过本题', exact: true }).click();
  await expect(page.getByText('2 / 2', { exact: true }).first()).toBeVisible();
  await expect(page.locator('video')).toHaveCount(models.length);
  await expect.poll(() => page.locator('video').evaluateAll(readPlaybackState)).toEqual(expectedPausedState);
});
