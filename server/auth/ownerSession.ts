import crypto from 'node:crypto';

import { ApiError } from '../http/errors.ts';
import { normalizeOwnerAccessKeySha256 } from './ownerAccessCrypto.ts';

export interface OwnerSessionPayload {
  kind: 'owner-access';
  version: 1;
  bindingId: string;
  userId: string;
  sessionVersion: number;
  keySha256: string;
}

type NewOwnerSessionPayload = Omit<OwnerSessionPayload, 'kind' | 'version'>;

const base64url = (value: Buffer | string) => Buffer.from(value)
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const decodeBase64url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf8');
};

const invalidOwnerSession = () => new ApiError(401, 'INVALID_OWNER_SESSION', 'Invalid owner session');

const requireSecret = (secret: string) => {
  if (!secret) throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'JWT_SECRET is not configured');
  return secret;
};

const sign = (encodedPayload: string, secret: string) => base64url(
  crypto.createHmac('sha256', requireSecret(secret)).update(encodedPayload).digest(),
);

const signaturesMatch = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const createOwnerSessionToken = (payload: NewOwnerSessionPayload, secret: string) => {
  const body: OwnerSessionPayload = {
    ...payload,
    kind: 'owner-access',
    version: 1,
  };
  const encodedPayload = base64url(JSON.stringify(body));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
};

export const verifyOwnerSessionToken = (
  token: string,
  secret: string,
  currentKeySha256: string,
): OwnerSessionPayload => {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalidOwnerSession();

  const [encodedPayload, signature] = parts;
  if (!signaturesMatch(sign(encodedPayload, secret), signature)) throw invalidOwnerSession();

  let payload: OwnerSessionPayload;
  try {
    payload = JSON.parse(decodeBase64url(encodedPayload));
  } catch {
    throw invalidOwnerSession();
  }

  const normalizedCurrentHash = normalizeOwnerAccessKeySha256(currentKeySha256);
  if (
    payload?.kind !== 'owner-access'
    || payload.version !== 1
    || typeof payload.bindingId !== 'string'
    || !payload.bindingId
    || typeof payload.userId !== 'string'
    || !payload.userId
    || !Number.isSafeInteger(payload.sessionVersion)
    || payload.sessionVersion < 1
    || !normalizeOwnerAccessKeySha256(payload.keySha256)
    || !normalizedCurrentHash
    || !signaturesMatch(payload.keySha256, normalizedCurrentHash)
  ) {
    throw invalidOwnerSession();
  }
  return payload;
};
