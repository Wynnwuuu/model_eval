import type { NextFunction, Request, Response } from 'express';

import { serverConfig } from '../config.ts';
import { dbPool } from '../db/client.ts';
import { ApiError } from '../http/errors.ts';
import { normalizeOwnerAccessKeySha256 } from './ownerAccessCrypto.ts';
import { readOwnerAccessCookie } from './ownerAccessCookie.ts';
import { assertSameOriginRequest, isMutatingRequest } from './ownerAccessHttp.ts';
import { getOwnerAccessBinding } from './ownerAccessRepository.ts';
import { type OwnerSessionPayload, verifyOwnerSessionToken } from './ownerSession.ts';
import { verifyAuthToken } from './jwt.ts';

export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
  organizationId: string;
};

export type RequestAuthSource = 'bearer' | 'owner-cookie' | 'local';

export interface ResolvedRequestIdentity {
  user: RequestUser;
  source: RequestAuthSource;
  ownerSession?: OwnerSessionPayload;
}

declare global {
  namespace Express {
    interface Request {
      user: RequestUser;
      authSource: RequestAuthSource;
      ownerSession?: OwnerSessionPayload;
    }
  }
}

const readHeader = (req: Request, name: string) => {
  const value = req.header(name);
  return typeof value === 'string' ? value.trim() : '';
};

export const getBearerToken = (req: Request) => {
  const authorization = req.header('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
};

const userFromBearerToken = (bearerToken: string): RequestUser => {
  const payload = verifyAuthToken(bearerToken);
  return {
    id: payload.userId,
    email: payload.email,
    displayName: payload.displayName,
    organizationId: payload.organizationId || 'default',
  };
};

export const resolveBearerRequestUser = async (req: Request) => {
  const bearerToken = getBearerToken(req);
  if (!bearerToken) throw new ApiError(401, 'AUTH_REQUIRED', 'Authorization token required');
  return ensureUserMembership(userFromBearerToken(bearerToken));
};

export const resolveOwnerCookieIdentity = async (req: Request): Promise<ResolvedRequestIdentity | null> => {
  const configuredKeySha256 = normalizeOwnerAccessKeySha256(serverConfig.ownerAccessKeySha256);
  if (!serverConfig.ownerAccessEnabled || !configuredKeySha256) return null;

  const cookieToken = readOwnerAccessCookie(req);
  if (!cookieToken) return null;
  const ownerSession = verifyOwnerSessionToken(cookieToken, serverConfig.jwtSecret, configuredKeySha256);
  const binding = await getOwnerAccessBinding(ownerSession.bindingId);
  if (
    !binding
    || binding.userId !== ownerSession.userId
    || binding.sessionVersion !== ownerSession.sessionVersion
  ) {
    throw new ApiError(401, 'INVALID_OWNER_SESSION', 'Invalid owner session');
  }
  return { user: binding.user, source: 'owner-cookie', ownerSession };
};

const resolveLocalRequestUser = (req: Request): RequestUser => {

  if (serverConfig.authMode === 'feishu') {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Authorization token required');
  }

  const id = readHeader(req, 'x-user-id') || 'local-dev-user';
  const email = readHeader(req, 'x-user-email') || `${id}@local.eval`;
  const displayName = readHeader(req, 'x-user-name') || email;
  const organizationId = readHeader(req, 'x-organization-id') || 'default';
  return { id, email, displayName, organizationId };
};

export const ensureUserMembership = async (user: RequestUser): Promise<RequestUser> => {
  await dbPool.query(
    `
      INSERT INTO organizations (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
    `,
    [user.organizationId, user.organizationId === 'default' ? 'Default Workspace' : user.organizationId]
  );

  const existingUser = await dbPool.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE email = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [user.email]
  );
  const canonicalUser = {
    ...user,
    id: existingUser.rows[0]?.id || user.id,
  };

  await dbPool.query(
    `
      INSERT INTO users (id, email, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = now()
    `,
    [canonicalUser.id, canonicalUser.email, canonicalUser.displayName]
  );
  await dbPool.query(
    `
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES ($1, $2, 'member')
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        updated_at = now()
    `,
    [canonicalUser.organizationId, canonicalUser.id]
  );

  return canonicalUser;
};

export const attachRequestUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const identity = await resolveRequestIdentity(req);
    if (identity.source === 'owner-cookie' && isMutatingRequest(req)) {
      assertSameOriginRequest(req);
    }
    req.user = identity.user;
    req.authSource = identity.source;
    req.ownerSession = identity.ownerSession;
    next();
  } catch (error) {
    next(error);
  }
};

export const resolveRequestIdentity = async (req: Request): Promise<ResolvedRequestIdentity> => {
  const bearerToken = getBearerToken(req);
  if (bearerToken) {
    return {
      user: await ensureUserMembership(userFromBearerToken(bearerToken)),
      source: 'bearer',
    };
  }

  const ownerIdentity = await resolveOwnerCookieIdentity(req);
  if (ownerIdentity) return ownerIdentity;

  if (serverConfig.authMode === 'feishu') {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Authorization token required');
  }
  return {
    user: await ensureUserMembership(resolveLocalRequestUser(req)),
    source: 'local',
  };
};
