import crypto from 'node:crypto';

import { Router } from 'express';

import { dbPool } from '../db/client.ts';
import { serverConfig } from '../config.ts';
import { ApiError, badRequest } from '../http/errors.ts';
import {
  ensureUserMembership,
  getBearerToken,
  resolveBearerRequestUser,
  resolveOwnerCookieIdentity,
  resolveRequestIdentity,
  type RequestUser,
} from './context.ts';
import { authenticateFeishuCode, getFeishuAuthorizationUrl, type FeishuUserInfo } from './feishuOAuth.ts';
import { createAuthToken } from './jwt.ts';
import {
  OWNER_ACCESS_BINDING_ID,
  normalizeOwnerAccessKeySha256,
  verifyOwnerAccessCredentials,
} from './ownerAccessCrypto.ts';
import { clearOwnerAccessCookie, setOwnerAccessCookie } from './ownerAccessCookie.ts';
import { assertSameOriginRequest } from './ownerAccessHttp.ts';
import {
  bindOwnerAccessToUser,
  getOwnerAccessBinding,
  revokeOwnerAccessSessions,
} from './ownerAccessRepository.ts';
import { createOwnerSessionToken } from './ownerSession.ts';

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

const ownerAccessNotFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');

const configuredOwnerAccessKeySha256 = () => {
  const keySha256 = normalizeOwnerAccessKeySha256(serverConfig.ownerAccessKeySha256);
  if (!serverConfig.ownerAccessEnabled || !keySha256) throw ownerAccessNotFound();
  return keySha256;
};

const issueOwnerSession = (
  res: Parameters<typeof setOwnerAccessCookie>[0],
  binding: NonNullable<Awaited<ReturnType<typeof getOwnerAccessBinding>>>,
  keySha256: string,
) => {
  const token = createOwnerSessionToken({
    bindingId: binding.id,
    userId: binding.userId,
    sessionVersion: binding.sessionVersion,
    keySha256,
  }, serverConfig.jwtSecret);
  setOwnerAccessCookie(res, token);
};

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

authRoutes.post('/owner/access', async (req, res, next) => {
  try {
    const keySha256 = configuredOwnerAccessKeySha256();
    const fingerprint = typeof req.body?.fingerprint === 'string' ? req.body.fingerprint.trim() : '';
    const accessKey = typeof req.body?.accessKey === 'string' ? req.body.accessKey.trim() : '';
    if (!verifyOwnerAccessCredentials(fingerprint, accessKey, keySha256)) {
      throw ownerAccessNotFound();
    }
    assertSameOriginRequest(req);

    let binding = await getOwnerAccessBinding(OWNER_ACCESS_BINDING_ID);
    if (!binding) {
      if (!getBearerToken(req)) {
        throw new ApiError(
          401,
          'OWNER_SETUP_REQUIRED',
          'Owner access must first be bound from an existing Feishu session',
        );
      }
      const feishuUser = await resolveBearerRequestUser(req);
      binding = await bindOwnerAccessToUser(OWNER_ACCESS_BINDING_ID, feishuUser.id);
    }

    issueOwnerSession(res, binding, keySha256);
    res.set('Cache-Control', 'no-store');
    res.json({ user: publicUser(binding.user) });
  } catch (error) {
    next(error);
  }
});

authRoutes.get('/user/me', async (req, res, next) => {
  try {
    const identity = await resolveRequestIdentity(req);
    if (identity.source === 'owner-cookie' && identity.ownerSession) {
      const keySha256 = configuredOwnerAccessKeySha256();
      const binding = await getOwnerAccessBinding(identity.ownerSession.bindingId);
      if (!binding) throw new ApiError(401, 'INVALID_OWNER_SESSION', 'Invalid owner session');
      issueOwnerSession(res, binding, keySha256);
    }
    res.set('Cache-Control', 'no-store');
    res.json({ user: publicUser(identity.user) });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/logout', async (req, res, next) => {
  try {
    let identity = null;
    try {
      identity = await resolveOwnerCookieIdentity(req);
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
    }

    if (identity?.ownerSession) {
      assertSameOriginRequest(req);
      await revokeOwnerAccessSessions(
        identity.ownerSession.bindingId,
        identity.ownerSession.sessionVersion,
      );
    }
    clearOwnerAccessCookie(res);
    res.set('Cache-Control', 'no-store');
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
