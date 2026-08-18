import assert from 'node:assert/strict';

import {
  fingerprintOwnerAccessHash,
  generateOwnerAccessCredentials,
  hashOwnerAccessKey,
  verifyOwnerAccessCredentials,
  verifyOwnerAccessFingerprint,
} from '../server/auth/ownerAccessCrypto.ts';
import {
  createOwnerSessionToken,
  verifyOwnerSessionToken,
} from '../server/auth/ownerSession.ts';
import {
  OWNER_ACCESS_COOKIE_MAX_AGE_SECONDS,
  setOwnerAccessCookie,
} from '../server/auth/ownerAccessCookie.ts';

const generated = generateOwnerAccessCredentials(
  'https://eval.example.com/',
  Buffer.alloc(32, 7),
);
const wrongFingerprint = `${generated.fingerprint.startsWith('0') ? '1' : '0'}${generated.fingerprint.slice(1)}`;

assert.match(generated.accessKey, /^[A-Za-z0-9_-]{43}$/);
assert.match(generated.keySha256, /^[a-f0-9]{64}$/);
assert.equal(generated.fingerprint, fingerprintOwnerAccessHash(generated.keySha256));
assert.equal(
  generated.magicLink,
  `https://eval.example.com/access/${generated.fingerprint}#${generated.accessKey}`,
);
assert.equal(hashOwnerAccessKey(generated.accessKey), generated.keySha256);
assert.equal(verifyOwnerAccessFingerprint(generated.fingerprint, generated.keySha256), true);
assert.equal(verifyOwnerAccessFingerprint(wrongFingerprint, generated.keySha256), false);
assert.equal(
  verifyOwnerAccessCredentials(generated.fingerprint, generated.accessKey, generated.keySha256),
  true,
);
assert.equal(
  verifyOwnerAccessCredentials(generated.fingerprint, `${generated.accessKey.slice(0, -1)}A`, generated.keySha256),
  false,
);
assert.equal(
  verifyOwnerAccessCredentials(wrongFingerprint, generated.accessKey, generated.keySha256),
  false,
);

const sessionPayload = {
  bindingId: 'primary',
  userId: 'owner-user',
  sessionVersion: 4,
  keySha256: generated.keySha256,
};
const token = createOwnerSessionToken(sessionPayload, 'test-owner-session-secret');
assert.deepEqual(
  verifyOwnerSessionToken(token, 'test-owner-session-secret', generated.keySha256),
  { ...sessionPayload, kind: 'owner-access', version: 1 },
);

assert.throws(
  () => verifyOwnerSessionToken(`${token.slice(0, -1)}x`, 'test-owner-session-secret', generated.keySha256),
  (error: any) => error?.code === 'INVALID_OWNER_SESSION',
);
assert.throws(
  () => verifyOwnerSessionToken(token, 'different-secret', generated.keySha256),
  (error: any) => error?.code === 'INVALID_OWNER_SESSION',
);
assert.throws(
  () => verifyOwnerSessionToken(token, 'test-owner-session-secret', hashOwnerAccessKey('rotated-owner-key')),
  (error: any) => error?.code === 'INVALID_OWNER_SESSION',
);

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
let productionCookie = '';
setOwnerAccessCookie({
  append: (_name: string, value: string) => {
    productionCookie = value;
    return undefined as any;
  },
} as any, token);
if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousNodeEnv;
assert.match(productionCookie, /^__Secure-manueval-owner-session=/);
assert.match(productionCookie, /; HttpOnly;/);
assert.match(productionCookie, /; Secure;/);
assert.match(productionCookie, /; SameSite=Strict;/);
assert.match(productionCookie, /; Path=\/api;/);
assert.match(productionCookie, new RegExp(`; Max-Age=${OWNER_ACCESS_COOKIE_MAX_AGE_SECONDS};`));

console.log('Owner access security tests passed');
