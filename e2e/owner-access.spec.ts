import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import { createAuthToken } from '../server/auth/jwt';
import { fingerprintOwnerAccessHash, hashOwnerAccessKey } from '../server/auth/ownerAccessCrypto';

const API_BASE_URL = (process.env.API_BASE_URL || 'http://localhost:8787').replace(/\/+$/, '');
const WEB_ORIGIN = new URL(process.env.E2E_BASE_URL || 'http://localhost:3000').origin;
const ACCESS_KEY = process.env.OWNER_ACCESS_SMOKE_KEY || '';
const FINGERPRINT = ACCESS_KEY ? fingerprintOwnerAccessHash(hashOwnerAccessKey(ACCESS_KEY)) : '';

test.describe('hidden owner access', () => {
  test.skip(!ACCESS_KEY, 'OWNER_ACCESS_SMOKE_KEY is required for the owner access browser regression');

  test.afterEach(async () => {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://eval_studio:eval_studio_dev@localhost:5432/eval_studio',
    });
    try {
      await pool.query(
        'DELETE FROM owner_access_bindings WHERE id = $1 AND user_id = $2',
        ['primary', 'smoke-user'],
      );
    } finally {
      await pool.end();
    }
  });

  test('normal login stays unchanged and the saved fragment restores the same bound user', async ({ page, context }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: '登录 ManuEval' })).toBeVisible();
    await expect(page.getByText(/站长|魔法链接|安全访问/)).toHaveCount(0);

    const ownerBearer = createAuthToken({
      userId: 'smoke-user',
      email: 'smoke@example.com',
      displayName: 'Smoke User',
      organizationId: 'default',
    });
    const setupResponse = await page.request.post(`${API_BASE_URL}/api/auth/owner/access`, {
      headers: { Authorization: `Bearer ${ownerBearer}`, Origin: WEB_ORIGIN },
      data: { fingerprint: FINGERPRINT, accessKey: ACCESS_KEY },
    });
    expect(setupResponse.status()).toBe(200);
    await context.clearCookies();

    const requestUrls: string[] = [];
    const consoleMessages: string[] = [];
    page.on('request', request => requestUrls.push(request.url()));
    page.on('console', message => consoleMessages.push(message.text()));

    const magicPath = `/access/${FINGERPRINT}#${ACCESS_KEY}`;
    await page.goto(magicPath);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    await expect(page).toHaveURL(/\/$/);

    const firstIdentity = await page.evaluate(() => {
      const raw = localStorage.getItem('manueval_user');
      return {
        user: raw ? JSON.parse(raw) : null,
        bearer: localStorage.getItem('token'),
        storedValues: [
          ...Object.values({ ...localStorage }),
          ...Object.values({ ...sessionStorage }),
        ],
      };
    });
    expect(firstIdentity.user?.id).toBe('smoke-user');
    expect(firstIdentity.bearer).toBeNull();
    expect(firstIdentity.storedValues.some(value => String(value).includes(ACCESS_KEY))).toBe(false);

    const currentUser = await page.evaluate(async apiBaseUrl => {
      const response = await fetch(`${apiBaseUrl}/api/auth/user/me`, { credentials: 'include' });
      return { status: response.status, body: await response.json().catch(() => null) };
    }, API_BASE_URL);
    expect(currentUser.status).toBe(200);
    expect(currentUser.body?.user?.id).toBe('smoke-user');

    await context.clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(magicPath);
    await expect.poll(() => new URL(page.url()).hash).toBe('');
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem('manueval_user');
      return raw ? JSON.parse(raw).id : null;
    })).toBe('smoke-user');

    expect(requestUrls.some(url => url.includes(ACCESS_KEY))).toBe(false);
    expect(consoleMessages.some(message => message.includes(ACCESS_KEY))).toBe(false);
    await context.clearCookies();
  });
});
