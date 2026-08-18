import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.OWNER_ACCESS_ENABLED = 'false';

const main = async () => {
  const [{ createApp }, { closeDatabase }] = await Promise.all([
    import('../server/app.ts'),
    import('../server/db/client.ts'),
  ]);
  const app = createApp({ staticDistPath: '__owner_access_disabled_no_static__' });
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/access/${'a'.repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/auth/owner/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ fingerprint: 'a'.repeat(32), accessKey: 'A'.repeat(43) }),
    })).status, 404);
    console.log('Owner access disabled-state tests passed');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closeDatabase();
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
