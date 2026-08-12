import assert from 'node:assert/strict';

import {
  normalizeFeishuBaseCell,
  readFeishuBaseSnapshot,
  resolveFeishuBaseUrl,
} from '../server/datasets/feishuBaseClient.ts';

assert.deepEqual(
  resolveFeishuBaseUrl('https://j0yswlgboxz.feishu.cn/base/appABC?table=tblXYZ&view=vewIgnored'),
  { appToken: 'appABC', tableId: 'tblXYZ' },
);
assert.throws(() => resolveFeishuBaseUrl('https://example.com/base/appABC?table=tblXYZ'), /飞书 Base/);
assert.equal(normalizeFeishuBaseCell([{ text: 'hello' }, { text: ' world' }]), 'hello world');
assert.equal(normalizeFeishuBaseCell({ link: 'https://example.com/a.png', text: 'asset' }), 'https://example.com/a.png');
assert.deepEqual(normalizeFeishuBaseCell([{ link: 'https://example.com/a.png' }, { link: 'https://example.com/b.png' }]), [
  'https://example.com/a.png',
  'https://example.com/b.png',
]);

const calls: string[] = [];
const fakeFetch: typeof fetch = async (url, init) => {
  calls.push(String(url));
  assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer tenant-token');
  if (String(url).includes('/fields')) {
    return new Response(JSON.stringify({
      code: 0,
      data: {
        items: [{ field_name: 'case_id' }, { field_name: 'prompt' }, { field_name: 'result' }],
        has_more: false,
      },
    }), { status: 200 });
  }
  const secondPage = String(url).includes('page_token=next-page');
  return new Response(JSON.stringify({
    code: 0,
    data: secondPage ? {
      items: [{ record_id: 'rec2', fields: { case_id: 'case-2', prompt: 'second' } }],
      has_more: false,
    } : {
      items: [{ record_id: 'rec1', fields: { case_id: 'case-1', prompt: [{ text: 'first' }], result: { link: 'https://example.com/1.mp4' } } }],
      has_more: true,
      page_token: 'next-page',
    },
  }), { status: 200 });
};

const snapshot = await readFeishuBaseSnapshot({
  sourceUrl: 'https://j0yswlgboxz.feishu.cn/base/appABC?table=tblXYZ&view=ignored',
  tenantAccessToken: 'tenant-token',
  fetchImpl: fakeFetch,
});
assert.deepEqual(snapshot.headers, ['case_id', 'prompt', 'result']);
assert.deepEqual(snapshot.rows, [
  { case_id: 'case-1', prompt: 'first', result: 'https://example.com/1.mp4' },
  { case_id: 'case-2', prompt: 'second', result: '' },
]);
assert.ok(calls.every(url => !url.includes('view_id')), 'Base synchronization must read the full table, not the linked view filter');
assert.equal(calls.filter(url => url.includes('/records')).length, 2, 'record pagination must be exhausted');

console.log('Feishu Base client tests passed.');
