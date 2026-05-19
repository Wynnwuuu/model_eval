import crypto from 'node:crypto';

import { serverConfig } from '../config.ts';
import { ApiError } from '../http/errors.ts';

export type AuthTokenPayload = {
  userId: string;
  email: string;
  displayName: string;
  organizationId?: string;
  exp?: number;
};

const base64url = (value: Buffer | string) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const decodeBase64url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
};

const getJwtSecret = () => {
  if (!serverConfig.jwtSecret) {
    throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'JWT_SECRET is not configured');
  }
  return serverConfig.jwtSecret;
};

export const createAuthToken = (payload: Omit<AuthTokenPayload, 'exp'>) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + serverConfig.jwtExpiresDays * 24 * 60 * 60;
  const body: AuthTokenPayload = { ...payload, exp };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signingInput = `${encodedHeader}.${encodedBody}`;
  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64url(signature)}`;
};

export const verifyAuthToken = (token: string): AuthTokenPayload => {
  const [encodedHeader, encodedBody, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedBody || !encodedSignature) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Invalid auth token');
  }

  const signingInput = `${encodedHeader}.${encodedBody}`;
  const expectedSignature = base64url(
    crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest()
  );

  const expected = Buffer.from(expectedSignature);
  const actual = Buffer.from(encodedSignature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Invalid auth token');
  }

  let payload: AuthTokenPayload;
  try {
    payload = JSON.parse(decodeBase64url(encodedBody));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN', 'Invalid auth token payload');
  }

  if (!payload.userId || !payload.email || !payload.displayName) {
    throw new ApiError(401, 'INVALID_TOKEN', 'Invalid auth token payload');
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new ApiError(401, 'TOKEN_EXPIRED', 'Auth token expired');
  }
  return payload;
};
