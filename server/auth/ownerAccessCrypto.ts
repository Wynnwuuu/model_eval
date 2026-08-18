import crypto from 'node:crypto';

export const OWNER_ACCESS_KEY_BYTES = 32;
export const OWNER_ACCESS_FINGERPRINT_HEX_LENGTH = 32;
export const OWNER_ACCESS_BINDING_ID = 'primary';

const toBase64url = (value: Buffer) => value
  .toString('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const constantTimeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const normalizeOwnerAccessKeySha256 = (value: string | undefined) => {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : '';
};

export const hashOwnerAccessKey = (accessKey: string) => crypto
  .createHash('sha256')
  .update(accessKey, 'utf8')
  .digest('hex');

export const fingerprintOwnerAccessHash = (keySha256: string) =>
  normalizeOwnerAccessKeySha256(keySha256).slice(0, OWNER_ACCESS_FINGERPRINT_HEX_LENGTH);

export const verifyOwnerAccessFingerprint = (fingerprint: string, configuredKeySha256: string) => {
  const expectedFingerprint = fingerprintOwnerAccessHash(configuredKeySha256);
  return Boolean(expectedFingerprint) && constantTimeEqual(fingerprint, expectedFingerprint);
};

export const verifyOwnerAccessCredentials = (
  fingerprint: string,
  accessKey: string,
  configuredKeySha256: string,
) => {
  const keySha256 = normalizeOwnerAccessKeySha256(configuredKeySha256);
  if (!keySha256 || !/^[A-Za-z0-9_-]{43}$/.test(accessKey)) return false;

  const fingerprintMatches = verifyOwnerAccessFingerprint(fingerprint, keySha256);
  const keyMatches = constantTimeEqual(hashOwnerAccessKey(accessKey), keySha256);
  return fingerprintMatches && keyMatches;
};

export interface OwnerAccessCredentials {
  accessKey: string;
  keySha256: string;
  fingerprint: string;
  magicLink: string;
}

export const generateOwnerAccessCredentials = (
  baseUrl: string,
  randomValue = crypto.randomBytes(OWNER_ACCESS_KEY_BYTES),
): OwnerAccessCredentials => {
  if (randomValue.length !== OWNER_ACCESS_KEY_BYTES) {
    throw new Error(`Owner access key material must be exactly ${OWNER_ACCESS_KEY_BYTES} bytes`);
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error('base-url must be an absolute http or https URL');
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol) || parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error('base-url must be an absolute http or https URL without credentials');
  }
  parsedBaseUrl.search = '';
  parsedBaseUrl.hash = '';
  parsedBaseUrl.pathname = parsedBaseUrl.pathname.replace(/\/+$/, '');

  const accessKey = toBase64url(randomValue);
  const keySha256 = hashOwnerAccessKey(accessKey);
  const fingerprint = fingerprintOwnerAccessHash(keySha256);
  const base = parsedBaseUrl.toString().replace(/\/+$/, '');
  return {
    accessKey,
    keySha256,
    fingerprint,
    magicLink: `${base}/access/${fingerprint}#${accessKey}`,
  };
};
