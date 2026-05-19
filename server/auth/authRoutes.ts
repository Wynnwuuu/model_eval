import crypto from 'node:crypto';

import { Router } from 'express';

import { dbPool } from '../db/client.ts';
import { ApiError, badRequest } from '../http/errors.ts';
import { ensureUserMembership, type RequestUser } from './context.ts';
import { authenticateFeishuCode, getFeishuAuthorizationUrl, type FeishuUserInfo } from './feishuOAuth.ts';
import { createAuthToken, verifyAuthToken } from './jwt.ts';

export const authRoutes = Router();

const fallbackEmail = (feishuUser: FeishuUserInfo) => `${feishuUser.openId}@feishu.local`;

const upsertFeishuUser = async (feishuUser: FeishuUserInfo): Promise<RequestUser> => {
  const externalAuthId = `feishu:${feishuUser.openId}`;
  const email = feishuUser.email || fallbackEmail(feishuUser);
  const displayName = feishuUser.name || email;
  const existing = await dbPool.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE external_auth_id = $1 OR email = $2
      ORDER BY (external_auth_id = $1) DESC
      LIMIT 1
    `,
    [externalAuthId, email]
  );
  const user: RequestUser = {
    id: existing.rows[0]?.id || crypto.randomUUID(),
    email,
    displayName,
    organizationId: 'default',
  };

  await dbPool.query(
    `
      INSERT INTO users (id, email, display_name, avatar_url, external_auth_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        external_auth_id = EXCLUDED.external_auth_id,
        updated_at = now()
    `,
    [user.id, user.email, user.displayName, feishuUser.avatarUrl || null, externalAuthId]
  );

  return ensureUserMembership(user);
};

const publicUser = (user: RequestUser) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  organizationId: user.organizationId,
});

authRoutes.get('/feishu/login-url', (_req, res, next) => {
  try {
    res.json({ authorizationUrl: getFeishuAuthorizationUrl() });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/feishu/callback', async (req, res, next) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) throw badRequest('code is required');

    const feishuUser = await authenticateFeishuCode(code);
    const user = await upsertFeishuUser(feishuUser);
    const accessToken = createAuthToken({
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      organizationId: user.organizationId,
    });
    res.json({
      accessToken,
      tokenType: 'Bearer',
      user: publicUser(user),
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.get('/user/me', async (req, res, next) => {
  try {
    const authorization = req.header('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Authorization token required');
    const payload = verifyAuthToken(token);
    const user = await ensureUserMembership({
      id: payload.userId,
      email: payload.email,
      displayName: payload.displayName,
      organizationId: payload.organizationId || 'default',
    });
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});
