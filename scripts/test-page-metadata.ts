import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  injectPageMetadata,
  getCanonicalPagePath,
  renderPageMetadataTags,
  resolvePageMetadata,
} from '../src/pageMetadata';
import {
  PageMetadataLoaders,
  renderSpaPage,
  resolveServerPageMetadata,
} from '../server/pageMetadata';
import { createApp } from '../server/app';

const metadata = (
  path: string,
  names: Parameters<typeof resolvePageMetadata>[0]['names'] = {},
) => {
  const url = new URL(path, 'https://eval.example.com');
  return resolvePageMetadata({
    pathname: url.pathname,
    searchParams: url.searchParams,
    names,
  });
};

assert.equal(metadata('/').title, 'Manueval');
assert.equal(metadata('/projects').title, '项目 · Manueval');
assert.equal(metadata('/projects/project-1', { projectName: 'Wan 对比' }).title, 'Wan 对比 · 项目 · Manueval');
assert.equal(
  metadata('/projects/project-1/insights?scope=group%3Aarena', { projectName: 'Wan 对比' }).title,
  'Wan 对比 · 结果洞察 · Manueval',
);
assert.equal(metadata('/datasets/dataset-1', { datasetName: '视频基准集' }).title, '视频基准集 · 评测集 · Manueval');
assert.equal(
  metadata('/datasets/dataset-1/generation?view=new', { datasetName: '视频基准集' }).title,
  '视频基准集 · 生产 · Manueval',
);
assert.equal(
  metadata('/generation?view=tasks&batch=batch-1', { generationTargetName: 'Seedance 输出' }).title,
  'Seedance 输出 · 生产任务 · Manueval',
);
assert.equal(metadata('/tasks/task-1', { taskName: '双模型盲测' }).title, '双模型盲测 · 评测物料 · Manueval');
assert.equal(metadata('/tasks/task-1/evaluate', { taskName: '双模型盲测' }).title, '双模型盲测 · 参与评测 · Manueval');
assert.equal(metadata('/tasks/task-1/results', { taskName: '双模型盲测' }).title, '双模型盲测 · 评测结果 · Manueval');
assert.equal(metadata('/tasks/task-1/insights', { taskName: '双模型盲测' }).title, '双模型盲测 · 评测结果 · Manueval');
assert.equal(getCanonicalPagePath('/tasks/task-1/insights', new URLSearchParams('status=completed')), '/tasks/task-1/results');
assert.equal(getCanonicalPagePath('/projects/project-1/insights', new URLSearchParams('scope=group:arena')), '/projects/project-1/insights');
assert.equal(
  getCanonicalPagePath('/projects/project-1/insights', new URLSearchParams('scope=material:task-1&reviewer=mine&status=active')),
  '/projects/project-1/insights?scope=material%3Atask-1&reviewer=mine',
);
assert.equal(metadata('/templates/template-1', { templateName: '视频质量 Rubric' }).title, '视频质量 Rubric · Rubric · Manueval');
assert.equal(metadata('/history').title, '历史 · Manueval');
assert.equal(metadata('/login').title, '登录 · Manueval');

assert.equal(metadata('/projects/missing').title, '项目 · Manueval');
assert.equal(metadata('/unknown/path').title, 'Manueval');

const escaped = renderPageMetadataTags(
  {
    title: 'A&B <测试> "标题" · 项目 · Manueval',
    description: '包含 < > & " 的说明',
  },
  {
    canonicalUrl: 'https://eval.example.com/projects/a?view="all"&x=1',
    imageUrl: 'https://eval.example.com/manueval-share.png',
  },
);
assert.match(escaped, /A&amp;B &lt;测试&gt; &quot;标题&quot;/);
assert.match(escaped, /view=&quot;all&quot;&amp;x=1/);
assert.doesNotMatch(escaped, /<测试>/);

const template = `<!doctype html><html><head>
<!-- manueval:metadata:start -->
<title>Old title</title>
<!-- manueval:metadata:end -->
</head><body></body></html>`;
const injected = injectPageMetadata(template, escaped);
assert.match(injected, /<title>A&amp;B &lt;测试&gt; &quot;标题&quot; · 项目 · Manueval<\/title>/);
assert.doesNotMatch(injected, /Old title/);

const loaders: PageMetadataLoaders = {
  getProjectName: async id => id === 'project-1' ? '项目 & 一号' : undefined,
  getDatasetName: async id => id === 'dataset-1' ? '视频集' : undefined,
  getTaskName: async id => id === 'task-1' ? '双模型盲测' : undefined,
  getTemplateName: async id => id === 'template-1' ? '质量标准' : undefined,
  getGenerationTargetName: async id => id === 'batch-1' ? '模型输出列' : undefined,
};
const serverMetadata = await resolveServerPageMetadata(
  '/projects/project-1/insights',
  new URLSearchParams('scope=group%3Aarena'),
  loaders,
);
assert.equal(serverMetadata.title, '项目 & 一号 · 结果洞察 · Manueval');
const serverHtml = renderSpaPage({
  html: template,
  metadata: serverMetadata,
  canonicalUrl: 'https://eval.example.com/projects/project-1/insights?scope=group%3Aarena',
  origin: 'https://eval.example.com',
});
assert.match(serverHtml, /<title>项目 &amp; 一号 · 结果洞察 · Manueval<\/title>/);
assert.match(serverHtml, /property="og:image" content="https:\/\/eval\.example\.com\/manueval-share\.png"/);
assert.match(serverHtml, /name="robots" content="noindex,nofollow"/);

const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'manueval-page-metadata-'));
let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
try {
  await fs.writeFile(path.join(staticDir, 'index.html'), template, 'utf8');
  // createApp reads the immutable production template at startup.
  const integrationApp = createApp({ staticDistPath: staticDir, pageMetadataLoaders: loaders });
  server = integrationApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', resolve);
    server!.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/projects/project-1/insights?scope=group%3Aarena`);
  const responseHtml = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-cache/);
  assert.match(responseHtml, /<title>项目 &amp; 一号 · 结果洞察 · Manueval<\/title>/);
  assert.match(
    responseHtml,
    new RegExp(`property="og:image" content="http:\\/\\/127\\.0\\.0\\.1:${port}\\/manueval-share\\.png"`),
  );
  const apiResponse = await fetch(
    `http://127.0.0.1:${port}/api/page-metadata?path=${encodeURIComponent('/tasks/task-1/results')}`,
  );
  const apiPayload = await apiResponse.json() as { metadata: { title: string } };
  assert.equal(apiResponse.status, 200);
  assert.equal(apiPayload.metadata.title, '双模型盲测 · 评测结果 · Manueval');
  const legacyTaskResponse = await fetch(`http://127.0.0.1:${port}/tasks/task-1/insights?status=completed`);
  const legacyTaskHtml = await legacyTaskResponse.text();
  assert.match(legacyTaskHtml, new RegExp(`<link rel="canonical" href="http:\\/\\/127\\.0\\.0\\.1:${port}\\/tasks\\/task-1\\/results"`));
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await fs.rm(staticDir, { recursive: true, force: true });
}

console.log('Page metadata regression checks passed.');
