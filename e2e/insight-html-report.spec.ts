import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test as base, expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';
import { makeAbReportRequest, makeReportRequests, reportItems, reportVotes } from '../scripts/fixtures/insightReportFixtures';
import { buildInsightHtmlReport } from '../src/reports/insightHtmlReport';
import { createVoteItemSnapshot } from '../src/taskItemSnapshot';
import type { EvaluationItem } from '../src/types';

// Concurrent suites clean their output root. Preserve these artifacts with --output=output/playwright/insight-html-report.
type ReportRequest = Parameters<typeof buildInsightHtmlReport>[0];
const CASES = '#cases article.case-report[data-case-id]';
const MEDIA = 'figure.media-frame[data-media-state]';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
// A rectangular color chart makes letterboxing and accidental cropping visible in desktop evidence.
const LAYOUT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAACXBIWXMAAAABAAAAAQBPJcTWAAAA/0lEQVR4nO3RwQ3CQBAEwU3L0RH5AR9/HABC6q1RBTBSz8fSm38fsN/uDnxmlph5LyFwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdwnMBxAscJHCdw3CPwvGaJ69piaeBzthA4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuA4geMEjhM4TuC4R2CrTuD4vqb2h0B2XBJrAAAAAElFTkSuQmCC', 'base64');
// One second of VP8, generated once with ffmpeg. No codec tools or network fixtures are needed at test time.
const WEBM = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////EU2bdKtNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEj7AEAAAAAAABoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDBXQYxMYXZmNjEuNy4xMDBEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIj/VgHFpnc1WcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JCwgSC6gSCagQJVsIRVuYEBElTDZ9dzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYxLjcuMTAwc3OyY8CLY8WIj/VgHFpnc1VnyKFFo4dFTkNPREVSRIeUTGF2YzYxLjE5LjEwMSBsaWJ2cHgfQ7Z1QQjngQCjvoEAAIAQAwCdASogACAAAEcIhYWImYSIAgICdaoD+AP6AghZLpBw/v1u8//kb+PnRv/I4//8Sp7jieP//EaAo7CBAMgA8QEABRCsABgMUU+Q25RwQ3sA/u1N3/GmPPwPQDvf/1v5L+38l/cB/MPWoACjr4EBkADRAQAFEKwAGAAqV/QMALXMAP7tTd/xpjz8D0A73/9b+S/t/Jf3AfzD1qAAo6+BAlgA0QEABRCsABgAKlf0DAC1zAD+7U3f8aY8/A9AO9//W/kv7fyX9wH8w9agAKOvgQMgANEBAAUQrAAYACpX9AwAtcwA/u1N3/GmPPwPQDvf/1v5L+38l/cB/MPWoAA=', 'base64');

function makeWav() {
  const samples = 8_000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(samples, 24);
  wav.writeUInt32LE(samples * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / samples) * 500), 44 + i * 2);
  return wav;
}

const WAV = makeWav();

async function fulfillMedia(route: Route) {
  const pathname = new URL(route.request().url()).pathname;
  const [body, contentType] = pathname.endsWith('.webm') ? [WEBM, 'video/webm']
    : pathname.endsWith('.wav') ? [WAV, 'audio/wav'] : [PNG, 'image/png'];
  const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
  if (range) {
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
    if (start >= body.length) {
      await route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${body.length}` } });
      return;
    }
    await route.fulfill({ status: 206, contentType, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
    return;
  }
  await route.fulfill({ status: 200, contentType, headers, body });
}

const test = base.extend<{ standaloneGuard: void }>({
  standaloneGuard: [async ({ page }, use) => {
    const unexpectedRequests: string[] = [];
    const scriptErrors: string[] = [];
    page.on('pageerror', error => scriptErrors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      // Playwright also routes file navigations; only the downloaded main document may bypass the network guard.
      if (url.protocol === 'file:' && route.request().isNavigationRequest() && route.request().frame() === page.mainFrame()) {
        await route.continue();
      } else if (url.hostname === 'report-media.test') {
        await fulfillMedia(route);
      } else {
        unexpectedRequests.push(route.request().url());
        await route.abort('blockedbyclient');
      }
    });
    await use();
    expect(scriptErrors, 'The downloaded runtime must initialize without uncaught errors').toEqual([]);
    expect(unexpectedRequests, 'The standalone report must not depend on an app, API, CDN script, or stylesheet').toEqual([]);
  }, { auto: true }],
});

async function downloadReport(page: Page, info: TestInfo, request: ReportRequest) {
  const html = buildInsightHtmlReport(request);
  const encoded = Buffer.from(html, 'utf8').toString('base64');
  const downloadUrl = 'https://report-download.test/insight';
  // Base64 keeps adversarial report text out of the download harness's executable script.
  await page.route(downloadUrl, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html>
    <meta charset="utf-8"><button id="download">Download HTML</button><script>
    document.getElementById('download').addEventListener('click', () => {
      const bytes = Uint8Array.from(atob('${encoded}'), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], {type: 'text/html;charset=utf-8'}));
      const a = document.createElement('a'); a.href = url; a.download = 'insight-report.html';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });</script>` }));
  await page.goto(downloadUrl);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download HTML' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('insight-report.html');
  const path = info.outputPath('downloads', download.suggestedFilename());
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  expect(await readFile(path, 'utf8')).toBe(html);
  await page.unroute(downloadUrl);
  return pathToFileURL(path).href;
}

async function openReport(page: Page, info: TestInfo, request: ReportRequest = makeAbReportRequest()) {
  const url = await downloadReport(page, info, request);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  expect(page.url()).toBe(url);
  await expect(page.locator('#report-summary')).toBeVisible();
  return url;
}

async function expectCharts(page: Page) {
  const charts = page.locator('svg');
  expect(await charts.count()).toBeGreaterThan(0);
  const rendered = await charts.evaluateAll(elements => elements.map(svg => ({
    width: svg.getBoundingClientRect().width,
    height: svg.getBoundingClientRect().height,
    labels: [svg.getAttribute('aria-label') || '', ...Array.from(svg.querySelectorAll('text, title, desc')).map(label => label.textContent || '')].join(' ').trim(),
    marks: svg.querySelectorAll('path, rect, circle, line, polyline, polygon').length,
  })));
  expect(rendered.some(chart => chart.width > 0 && chart.height > 0 && chart.marks > 0 && chart.labels.length > 0)).toBe(true);
}

async function visibleCaseIds(page: Page) {
  return page.locator(`${CASES}:visible`).evaluateAll(elements => elements.map(element => element.getAttribute('data-case-id')));
}

async function selectOptionMatching(select: Locator, pattern: RegExp) {
  const options = await select.locator('option').evaluateAll(elements => elements.map(option => ({ value: (option as HTMLOptionElement).value, text: option.textContent || '' })));
  const option = options.find(candidate => pattern.test(candidate.text));
  expect(option, `Expected select option matching ${pattern}; got ${JSON.stringify(options)}`).toBeTruthy();
  await select.selectOption(option!.value);
}

function mediaRequest(types: Array<'image' | 'video' | 'audio'>) {
  const items: EvaluationItem[] = types.map((type, index) => {
    const extension = type === 'video' ? 'webm' : type === 'audio' ? 'wav' : 'png';
    const url = (side: string) => `https://report-media.test/case-${index}/${side}.${extension}`;
    return {
      ...structuredClone(reportItems[index % reportItems.length]),
      id: `media-task-${index}`, originalItemId: `media-${String(index + 1).padStart(3, '0')}`, itemOrder: index,
      prompt: `Standalone ${type} case ${index + 1}`, type,
      modelA_Url: url('a'), modelB_Url: url('b'), referenceUrls: [],
      modelOutputs: [{ modelId: 'a', modelName: 'Model Aurora', url: url('a') }, { modelId: 'b', modelName: 'Model Birch', url: url('b') }],
    };
  });
  const votes = items.map(item => ({ ...structuredClone(reportVotes[0]), itemId: item.id, evaluatedItemSnapshot: createVoteItemSnapshot(item) }));
  return makeAbReportRequest(items, votes);
}

test('downloaded A/B report renders the frozen 33-case result and SVG confidence interval', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await openReport(page, info, { ...makeAbReportRequest(), report: { originalItemCount: 40, skippedCount: 2, dimensionSelection: {} } });
  const summary = page.locator('#report-summary');
  await expect(page.locator(CASES)).toHaveCount(33);
  await expect(summary).toContainText(/33/);
  for (const text of [/72\s*票/, /17\s*票/, /10\s*票/, /80\.9%/, /71\.5%/, /87\.7%/]) await expect(page.locator('body')).toContainText(text);
  await expect(page.locator('body')).toContainText('全员汇总');
  await expect(page.locator('#case-count')).toContainText('33');
  await expect(page.locator('body')).not.toContainText(/private-key-|reviewerKey|NaN|Infinity/);
  expect(await page.locator(CASES).evaluateAll(elements => elements.map(element => element.getAttribute('data-case-id'))))
    .toEqual(reportItems.map(item => item.originalItemId));
  await expectCharts(page);
  await expect(page.locator('h1')).toBeInViewport();
  await expect(page.locator('#charts svg').first()).toBeInViewport();
  const screenshot = info.outputPath('report-desktop-overview.png');
  await page.screenshot({ path: screenshot });
  await info.attach('desktop-report-overview', { path: screenshot, contentType: 'image/png' });
});

for (const type of ['image', 'video'] as const) {
  test(`desktop first-case ${type} media retains two equal columns and contain sizing`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('https://report-media.test/**/*.png', route => route.fulfill({ contentType: 'image/png', body: LAYOUT_PNG }));
    await openReport(page, info, type === 'image' ? makeAbReportRequest() : mediaRequest(['video']));
    const first = page.locator(CASES).first();
    if (type === 'image') await expect(first).toHaveAttribute('data-case-id', 'case-001');
    const frames = first.locator(`.outputs ${MEDIA}`);
    await expect(frames).toHaveCount(2);
    await first.scrollIntoViewIfNeeded();
    const media = frames.locator(type === 'image' ? 'img[data-src]' : 'video[data-src]');
    await expect(media).toHaveCount(2);
    await expect.poll(() => media.evaluateAll(elements => elements.every(element => element instanceof HTMLImageElement
      ? element.complete && element.naturalWidth > 0
      : (element as HTMLVideoElement).readyState >= 4))).toBe(true);
    if (type === 'video') {
      await media.evaluateAll(elements => Promise.all(elements.map(element => {
        const video = element as HTMLVideoElement;
        video.muted = true;
        return video.play();
      })));
      await expect.poll(() => media.evaluateAll(elements => elements.every(element => (element as HTMLVideoElement).currentTime > 0.1))).toBe(true);
      await media.evaluateAll(elements => elements.forEach(element => (element as HTMLVideoElement).pause()));
    }
    const geometry = await media.evaluateAll(elements => elements.map(element => {
      const mediaRect = element.getBoundingClientRect();
      const stage = element.closest('.media-stage')!.getBoundingClientRect();
      const frame = element.closest('figure')!.getBoundingClientRect();
      const intrinsicWidth = element instanceof HTMLImageElement ? element.naturalWidth : (element as HTMLVideoElement).videoWidth;
      const intrinsicHeight = element instanceof HTMLImageElement ? element.naturalHeight : (element as HTMLVideoElement).videoHeight;
      return {
        media: { x: mediaRect.x, y: mediaRect.y, width: mediaRect.width, height: mediaRect.height },
        stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
        frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height, right: frame.right },
        intrinsicWidth, intrinsicHeight, fit: getComputedStyle(element).objectFit,
      };
    }));
    const [left, right] = geometry;
    expect(Math.abs(left.frame.y - right.frame.y), 'The two candidates must share a row').toBeLessThanOrEqual(1);
    expect(right.frame.x - left.frame.right, 'The candidate columns must not overlap').toBeGreaterThan(0);
    expect(Math.abs(left.frame.width - right.frame.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(left.frame.height - right.frame.height)).toBeLessThanOrEqual(1);
    const caseWidth = (await first.boundingBox())!.width;
    for (const candidate of geometry) {
      expect(candidate.frame.width).toBeGreaterThan(caseWidth * 0.4);
      expect(candidate.frame.width).toBeLessThan(caseWidth * 0.6);
      expect(candidate.media.width).toBeGreaterThan(250);
      expect(candidate.media.height).toBeGreaterThan(150);
      expect(candidate.intrinsicWidth).toBe(type === 'image' ? 160 : 32);
      expect(candidate.intrinsicHeight).toBe(type === 'image' ? 90 : 32);
      expect(candidate.fit).toBe('contain');
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(candidate.media[key] - candidate.stage[key])).toBeLessThanOrEqual(1);
      expect(Math.abs(candidate.media.width / candidate.media.height - candidate.intrinsicWidth / candidate.intrinsicHeight),
        'Use different media and viewport ratios so contain is exercised').toBeGreaterThan(0.1);
    }
    const screenshot = info.outputPath(`report-desktop-first-case-${type}.png`);
    await first.screenshot({ path: screenshot });
    await info.attach(`desktop-first-case-${type}`, { path: screenshot, contentType: 'image/png' });
    await info.attach(`desktop-${type}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  });
}

test('case search, outcome and dimension filters compose without changing the fixed summary', async ({ page }, info) => {
  await openReport(page, info);
  const summary = await page.locator('#report-summary').innerHTML();
  const search = page.locator('#case-search');
  const outcome = page.locator('#case-outcome');
  const dimension = page.locator('#case-dimension');
  const initialOutcome = await outcome.inputValue();
  const initialDimension = await dimension.inputValue();
  await search.fill('case-003');
  await expect(page.locator(`${CASES}:visible`)).toHaveCount(1);
  expect(await visibleCaseIds(page)).toEqual(['case-003']);
  await expect(page.locator('#case-count')).toContainText(/1\D+33/);
  expect(await page.locator('#report-summary').innerHTML()).toBe(summary);
  await search.fill('not-a-real-case');
  await expect(page.locator(`${CASES}:visible`)).toHaveCount(0);
  await expect(page.locator('#case-count')).toContainText(/0\D+33/);
  expect(await page.locator('#report-summary').innerHTML()).toBe(summary);
  await search.fill('');
  await selectOptionMatching(dimension, /identity_consistency/);
  await expect(page.locator(`${CASES}:visible`)).toHaveCount(17);
  expect(await page.locator('#report-summary').innerHTML()).toBe(summary);
  await selectOptionMatching(outcome, /Model Aurora/);
  await expect(page.locator(`${CASES}:visible`)).toHaveCount(12);
  expect(await page.locator('#report-summary').innerHTML()).toBe(summary);
  await search.fill('case-003');
  expect(await visibleCaseIds(page)).toEqual(['case-003']);
  expect(await page.locator('#report-summary').innerHTML()).toBe(summary);
  await page.locator('#reset-cases').click();
  await expect(search).toHaveValue('');
  await expect(outcome).toHaveValue(initialOutcome);
  await expect(dimension).toHaveValue(initialDimension);
  await expect(page.locator(`${CASES}:visible`)).toHaveCount(33);
  expect(await page.locator('#report-summary').innerHTML()).toBe(summary);
});

test('mine export remains reviewer-scoped after download and filtering', async ({ page }, info) => {
  const mine = makeAbReportRequest(reportItems, reportVotes.filter(vote => vote.user === '评委1'));
  await openReport(page, info, { ...mine, context: { ...mine.context, reviewerScope: 'mine', reviewerScopeLabel: '我的结果' } });
  await expect(page.locator(CASES)).toHaveCount(33);
  await expect(page.locator('body')).toContainText('我的结果');
  await expect(page.locator('#cases')).toContainText('评委1');
  await expect(page.locator('body')).not.toContainText(/评委2|评委3|private-key-/);
  const summary = await page.locator('#report-summary').innerHTML();
  await page.locator('#case-search').fill('case-001');
  await expect(page.locator(`${CASES}:visible`)).toHaveCount(1);
  expect(await page.locator('#report-summary').innerHTML()).toBe(summary);
});

for (const request of makeReportRequests()) {
  const method = request.context.evaluationMethod;
  test(`formal method ${method} has readable charts, methodology and case evidence in the downloaded file`, async ({ page }, info) => {
    await openReport(page, info, request);
    await expect(page.locator(CASES)).toHaveCount(request.items.length);
    await expectCharts(page);
    await expect(page.locator('#methodology')).toContainText(/\S/);
    const methodEvidence = {
      ab_preference: /投票分布/,
      rank_order: /Borda/,
      direct_score: /MOS/,
      rubric_score: /Rubric/,
      pairwise: /Bradley/,
    };
    expect(method).not.toBe('benchmark_preview');
    await expect(page.locator('body')).toContainText(methodEvidence[method as keyof typeof methodEvidence]);
    await expect(page.locator('#cases')).toContainText('Model Aurora');
    const first = page.locator(CASES).first();
    await expect(first).toContainText(request.items[0].prompt!);
    expect(await first.locator('details').count()).toBeGreaterThan(0);
    await first.locator('details').evaluateAll(elements => elements.forEach(element => { (element as HTMLDetailsElement).open = true; }));
    await expect(first).toContainText(/评委/);
    await expect(page.locator('body')).not.toContainText(/NaN|Infinity|private-key-|reviewerKey/);
  });
}

test('adversarial report text stays literal and never executes after reopening', async ({ page }, info) => {
  const payload = '</script><script>window.__reportXss=1;alert("report-xss")</script><img src=x onerror="window.__reportXss=2">';
  const request = structuredClone(makeAbReportRequest());
  request.context.materialName = payload;
  request.items[0].prompt = payload;
  request.bundle.cases[0].prompt = payload;
  request.votes![0].reason = payload;
  request.votes![0].evaluatedItemSnapshot!.prompt = payload;
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await openReport(page, info, request);
  await expect(page.locator('body')).toContainText(payload);
  const first = page.locator(CASES).first();
  await first.locator('details').evaluateAll(elements => elements.forEach(element => { (element as HTMLDetailsElement).open = true; }));
  await expect(first).toContainText(payload);
  await page.locator('#case-search').fill('<script>');
  await expect(first).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, '__reportXss'))).toBeUndefined();
  await expect(page.locator('img[src="x"], [onerror], [onload], a[href^="javascript:"]')).toHaveCount(0);
});

test('390px layout contains long prompts, filters, charts and expanded evidence without horizontal overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const request = structuredClone(makeAbReportRequest());
  const longText = `https://report-media.test/${'UnbrokenCaseIdentifier'.repeat(35)}`;
  request.bundle.cases[0].prompt = longText;
  request.items[0].prompt = longText;
  await openReport(page, info, request);
  await expectCharts(page);
  const first = page.locator(CASES).first();
  await first.locator('details').evaluateAll(elements => elements.forEach(element => { (element as HTMLDetailsElement).open = true; }));
  await first.scrollIntoViewIfNeeded();
  await expect(first).toContainText(longText);
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('report-390px.png') });
});

test('image zoom works with keyboard activation and Escape restores focus', async ({ page }, info) => {
  await openReport(page, info, mediaRequest(['image']));
  const frame = page.locator(MEDIA).filter({ has: page.locator('img[data-src]') }).first();
  await frame.scrollIntoViewIfNeeded();
  await expect.poll(() => frame.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const zoom = frame.locator('button[data-zoom]');
  await expect(zoom).toBeVisible();
  await zoom.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('dialog#media-dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(dialog.locator('img')).toHaveAttribute('src', await frame.locator('img').getAttribute('data-src') as string);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(zoom).toBeFocused();
});

for (const [type, tag] of [['image', 'img'], ['video', 'video'], ['audio', 'audio']] as const) {
  test(`${type} performs real requests, exposes readable failure, retries and decodes successfully`, async ({ page }, info) => {
    const attempts: string[] = [];
    let fail = true;
    await page.route('https://report-media.test/**', async route => {
      attempts.push(route.request().url());
      if (fail) await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Media temporarily unavailable', headers: { 'access-control-allow-origin': '*' } });
      else await fulfillMedia(route);
    });
    await openReport(page, info, mediaRequest([type]));
    const frame = page.locator(MEDIA).filter({ has: page.locator(`${tag}[data-src]`) }).first();
    await frame.scrollIntoViewIfNeeded();
    const media = frame.locator(`${tag}[data-src]`);
    const url = await media.getAttribute('data-src');
    await expect.poll(() => attempts.filter(attempt => attempt === url).length).toBeGreaterThan(0);
    const status = frame.locator('.media-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText(/失败|错误|无法|不可用|失效|过期|failed|unavailable|error/i);
    await expect(frame.locator('a')).toHaveAttribute('href', url as string);
    await expect(frame.locator('a')).toBeVisible();
    const retry = frame.locator('button[data-retry]');
    await expect(retry).toBeVisible();
    const previousAttempts = attempts.filter(attempt => attempt === url).length;
    fail = false;
    await retry.click();
    await expect.poll(() => attempts.filter(attempt => attempt === url).length).toBeGreaterThan(previousAttempts);
    if (tag === 'img') {
      await expect.poll(() => media.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    } else {
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.readyState)).toBeGreaterThanOrEqual(1);
      expect(await media.evaluate((element: HTMLMediaElement) => ({ controls: element.controls, autoplay: element.autoplay, paused: element.paused })))
        .toEqual({ controls: true, autoplay: false, paused: true });
      await media.evaluate(async (element: HTMLMediaElement) => { element.muted = true; await element.play(); });
      await expect.poll(() => media.evaluate((element: HTMLMediaElement) => element.currentTime)).toBeGreaterThan(0);
      await media.evaluate((element: HTMLMediaElement) => element.pause());
    }
    await expect(frame).not.toHaveAttribute('data-media-state', /error|failed/);
    await expect(status).not.toContainText(/失败|错误|无法|不可用|失效|过期|failed|unavailable|error/i);
  });
}

test('a fresh offline context still opens all cases and inline SVG charts', async ({ page, browser }, info) => {
  const url = await downloadReport(page, info, makeAbReportRequest());
  const context = await browser.newContext({ offline: true });
  try {
    const offline = await context.newPage();
    const errors: string[] = [];
    const failedMedia: string[] = [];
    offline.on('pageerror', error => errors.push(error.message));
    offline.on('requestfailed', request => { if (request.url().startsWith('https://report-media.test/')) failedMedia.push(request.url()); });
    await offline.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(offline.locator(CASES)).toHaveCount(33);
    await expect(offline.locator('#report-summary')).toContainText('80.9%');
    await expectCharts(offline);
    await offline.locator(MEDIA).first().scrollIntoViewIfNeeded();
    await expect.poll(() => failedMedia.length).toBeGreaterThan(0);
    await expect(offline.locator(`${MEDIA} .media-status`).first()).toContainText(/失败|错误|无法|不可用|失效|过期|failed|unavailable|error/i);
    await offline.locator('#case-search').fill('case-003');
    await expect(offline.locator(`${CASES}:visible`)).toHaveCount(1);
    await expectCharts(offline);
    expect(errors).toEqual([]);
    await offline.screenshot({ path: info.outputPath('offline-report.png') });
  } finally {
    await context.close();
  }
});

test('JavaScript-disabled report retains complete chart labels and readable case evidence', async ({ page, browser }, info) => {
  const url = await openReport(page, info);
  const labels = (target: Page) => target.locator('svg').evaluateAll(elements => elements.map(svg => ({
    accessible: svg.getAttribute('aria-label'),
    text: Array.from(svg.querySelectorAll('text, title, desc')).map(label => label.textContent),
  })));
  const chartLabels = await labels(page);
  const summaryText = await page.locator('#report-summary').textContent();
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const noScript = await context.newPage();
    await noScript.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(noScript.locator(`${CASES}:visible`)).toHaveCount(33);
    expect(await noScript.locator('#report-summary').textContent()).toBe(summaryText);
    expect(await labels(noScript)).toEqual(chartLabels);
    for (const text of [/72\s*票/, /17\s*票/, /10\s*票/, /80\.9%/, /71\.5%/, /87\.7%/]) await expect(noScript.locator('body')).toContainText(text);
    await expectCharts(noScript);
    const first = noScript.locator(CASES).first();
    const detail = first.locator('details').filter({ hasText: '评委1' }).first();
    if (await detail.getAttribute('open') === null) await detail.locator('summary').click();
    await expect(detail).toHaveAttribute('open', '');
    await expect(detail.getByText('评委1', { exact: true })).toBeVisible();
    await expect(detail).toContainText(/构图|细节/);
    await expect(noScript.locator('#cases')).toContainText(reportItems[32].prompt!);
    await noScript.screenshot({ path: info.outputPath('no-javascript-report.png') });
  } finally {
    await context.close();
  }
});

test('beforeprint reveals all evidence and actual PDF output restores the exact screen state', async ({ page }, info) => {
  await openReport(page, info);
  const details = page.locator('details');
  expect(await details.count()).toBeGreaterThan(1);
  await details.evaluateAll(elements => elements.forEach((element, index) => { (element as HTMLDetailsElement).open = index % 3 === 0; }));
  await page.locator('#case-search').fill('case-003');
  await selectOptionMatching(page.locator('#case-dimension'), /identity_consistency/);
  await selectOptionMatching(page.locator('#case-outcome'), /Model Aurora/);
  await expect(page.locator(`${CASES}:visible`)).toHaveCount(1);
  const snapshot = async () => ({
    visible: await visibleCaseIds(page),
    details: await details.evaluateAll(elements => elements.map(element => (element as HTMLDetailsElement).open)),
    search: await page.locator('#case-search').inputValue(),
    outcome: await page.locator('#case-outcome').inputValue(),
    dimension: await page.locator('#case-dimension').inputValue(),
    count: await page.locator('#case-count').textContent(),
    summary: await page.locator('#report-summary').innerHTML(),
  });
  const before = await snapshot();
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(page.locator(`${CASES}:visible`)).toHaveCount(33);
    await expect(page.locator('details:visible')).toHaveCount(await details.count());
    expect(await details.evaluateAll(elements => elements.every(element => (element as HTMLDetailsElement).open))).toBe(true);
    expect(await page.locator('#report-summary').innerHTML()).toBe(before.summary);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    expect(await snapshot()).toEqual(before);
  }
  // Clear the screen override so Chromium's real print-to-PDF uses the report's print stylesheet.
  await page.emulateMedia({ media: null });
  const pdfPath = info.outputPath('insight-report.pdf');
  const pdf = await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
  expect(pdf.byteLength, 'Chromium must produce a nonempty PDF document').toBeGreaterThan(1024);
  expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(pdf.subarray(-32).toString('ascii').trimEnd()).toMatch(/%%EOF$/);
  expect(await readFile(pdfPath)).toEqual(pdf);
  await expect.poll(snapshot).toEqual(before);
  await info.attach('printed-insight-report', { path: pdfPath, contentType: 'application/pdf' });
});

test('hundreds of cases initialize no more than six media loads and keep the queue bounded', async ({ page }, info) => {
  const attempts: string[] = [];
  let active = 0;
  let peak = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://report-media.test/**', async route => {
    attempts.push(route.request().url());
    peak = Math.max(peak, ++active);
    try { await pending; await fulfillMedia(route); } finally { active--; }
  });
  try {
    await openReport(page, info, mediaRequest(Array.from({ length: 240 }, () => 'image')));
    await expect(page.locator(CASES)).toHaveCount(240);
    const sources = () => page.locator(`${MEDIA} img[src], ${MEDIA} video[src], ${MEDIA} audio[src]`).count();
    await page.locator(CASES).first().scrollIntoViewIfNeeded();
    await expect.poll(() => attempts.length).toBeGreaterThan(0);
    // Keep responses pending: socket limits alone must not hide eager src assignment to all 480 images.
    await page.waitForTimeout(300);
    expect(attempts.length).toBeLessThanOrEqual(6);
    expect(await sources()).toBeLessThanOrEqual(6);
    for (const index of [1, 2, 3, 12, 120, 239]) await page.locator(CASES).nth(index).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    expect(peak).toBeLessThanOrEqual(6);
    expect(attempts.length).toBeLessThanOrEqual(6);
    expect(await sources()).toBeLessThanOrEqual(6);
  } finally {
    release();
  }
  const last = page.locator(CASES).last().locator('img[data-src]').first();
  await expect.poll(() => last.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(attempts.length).toBeGreaterThan(6);
  expect(peak).toBeLessThanOrEqual(6);
});
