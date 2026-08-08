import { normalizeGenerationReference } from './mediaReferences.js';

export type GenerationMediaKind = 'image' | 'video' | 'audio';
export type DetectedGenerationMediaKind = GenerationMediaKind | 'unknown';

export type GenerationMediaAsset = {
  id: string;
  relativePath: string;
  fileName: string;
  contentType?: string;
};

export type GenerationMediaReferenceAudit = {
  field: string;
  originalUrl: string;
  normalizedUrl: string;
  expectedKind: GenerationMediaKind;
  detectedKind: DetectedGenerationMediaKind;
  detectionSource: 'extension' | 'mime' | 'unknown';
  nonPublicReason?: 'localhost' | 'private_ip' | 'single_label_host';
};

export type GenerationMediaInspectionIssue = {
  code: 'MEDIA_TYPE_MISMATCH' | 'MEDIA_TYPE_UNVERIFIED' | 'NON_PUBLIC_ASSET_URL';
  field: string;
  message: string;
};

export const GENERATION_MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

const kindFromMime = (value?: string): DetectedGenerationMediaKind => {
  const prefix = String(value || '').split(';')[0].trim().toLowerCase().split('/')[0];
  return ['image', 'video', 'audio'].includes(prefix)
    ? prefix as GenerationMediaKind
    : 'unknown';
};

const extensionFrom = (value: string) => {
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {
    pathname = value.split(/[?#]/)[0];
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep the encoded pathname when it contains malformed escape sequences.
  }
  const match = pathname.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || '';
};

const kindFromExtension = (value: string): DetectedGenerationMediaKind =>
  kindFromMime(GENERATION_MEDIA_MIME_BY_EXTENSION[extensionFrom(value)]);

const ipv4Parts = (hostname: string) => {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return undefined;
  const values = parts.map(Number);
  return values.every(value => value >= 0 && value <= 255) ? values : undefined;
};

const mappedIpv4Parts = (hostname: string) => {
  const match = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!match) return undefined;
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255];
};

const ipv4IsPrivate = ([first, second]: number[]) => first === 0
  || first === 10
  || first === 127
  || (first === 169 && second === 254)
  || (first === 172 && second >= 16 && second <= 31)
  || (first === 192 && second === 168);

const privateHostReason = (value: string): GenerationMediaReferenceAudit['nonPublicReason'] => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return undefined;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'host.docker.internal') {
    return 'localhost';
  }
  const ipv4 = ipv4Parts(hostname) || mappedIpv4Parts(hostname);
  if (ipv4) {
    if (ipv4IsPrivate(ipv4)) return 'private_ip';
    return undefined;
  }
  if (hostname === '::' || hostname === '::1'
    || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')) {
    return 'private_ip';
  }
  if (!hostname.includes('.')) return 'single_label_host';
  return undefined;
};

const referenceEntries = (input: Record<string, unknown>) => {
  const entries: Array<{ field: string; value: unknown; expectedKind: GenerationMediaKind }> = [];
  const images = Array.isArray(input.image_urls)
    ? input.image_urls
    : Array.isArray(input.images) ? input.images : [];
  images.forEach((value, index) => entries.push({
    field: `${Array.isArray(input.images) ? 'images' : 'image_urls'}[${index}]`,
    value,
    expectedKind: 'image',
  }));
  if (Array.isArray(input.elements)) {
    input.elements.forEach((rawElement, index) => {
      if (!rawElement || typeof rawElement !== 'object' || Array.isArray(rawElement)) return;
      const element = rawElement as Record<string, unknown>;
      if (element.frontal_image_url != null) entries.push({
        field: `elements[${index}].frontal_image_url`,
        value: element.frontal_image_url,
        expectedKind: 'image',
      });
      if (Array.isArray(element.reference_image_urls)) {
        element.reference_image_urls.forEach((value, referenceIndex) => entries.push({
          field: `elements[${index}].reference_image_urls[${referenceIndex}]`,
          value,
          expectedKind: 'image',
        }));
      }
      if (element.video_url != null) entries.push({
        field: `elements[${index}].video_url`,
        value: element.video_url,
        expectedKind: 'video',
      });
    });
  }
  if (Array.isArray(input.audios)) {
    input.audios.forEach((rawAudio, index) => {
      if (!rawAudio || typeof rawAudio !== 'object' || Array.isArray(rawAudio)) return;
      const audio = rawAudio as Record<string, unknown>;
      if (audio.url != null) entries.push({
        field: `audios[${index}].url`,
        value: audio.url,
        expectedKind: 'audio',
      });
    });
  }
  return entries;
};

export const inspectGenerationMediaInput = (
  input: Record<string, unknown>,
  assets: GenerationMediaAsset[] = [],
  originalInput?: Record<string, unknown>,
) => {
  const assetsById = new Map(assets.map(asset => [asset.id, asset]));
  const originalByField = new Map(
    referenceEntries(originalInput || {}).map(entry => [entry.field, entry.value]),
  );
  const references = referenceEntries(input).map(entry => {
    const normalizedUrl = normalizeGenerationReference(entry.value);
    const originalUrl = String(originalByField.get(entry.field) ?? entry.value ?? '').trim();
    const assetId = normalizedUrl.toLowerCase().startsWith('asset://')
      ? normalizedUrl.slice('asset://'.length).replace(/\/$/, '')
      : '';
    const asset = assetsById.get(assetId);
    const mimeKind = kindFromMime(asset?.contentType);
    const extensionKind = kindFromExtension(asset?.fileName || normalizedUrl);
    const detectedKind = mimeKind !== 'unknown' ? mimeKind : extensionKind;
    const detectionSource = mimeKind !== 'unknown'
      ? 'mime' as const
      : extensionKind !== 'unknown' ? 'extension' as const : 'unknown' as const;
    const nonPublicReason = privateHostReason(normalizedUrl);
    return {
      field: entry.field,
      originalUrl,
      normalizedUrl,
      expectedKind: entry.expectedKind,
      detectedKind,
      detectionSource,
      ...(nonPublicReason ? { nonPublicReason } : {}),
    } satisfies GenerationMediaReferenceAudit;
  });
  const errors: GenerationMediaInspectionIssue[] = [];
  const warnings: GenerationMediaInspectionIssue[] = [];
  references.forEach(reference => {
    if (reference.detectedKind !== 'unknown' && reference.detectedKind !== reference.expectedKind) {
      errors.push({
        code: 'MEDIA_TYPE_MISMATCH',
        field: reference.field,
        message: `${reference.field} expects ${reference.expectedKind} media, but the deterministic extension or MIME check detected ${reference.detectedKind}.`,
      });
    } else if (reference.detectedKind === 'unknown') {
      warnings.push({
        code: 'MEDIA_TYPE_UNVERIFIED',
        field: reference.field,
        message: `${reference.field} has no recognized media extension or uploaded MIME type; its media kind was not verified.`,
      });
    }
    if (reference.nonPublicReason) {
      errors.push({
        code: 'NON_PUBLIC_ASSET_URL',
        field: reference.field,
        message: `${reference.field} uses a deterministic non-public host (${reference.nonPublicReason}) that an external model provider may not be able to access.`,
      });
    }
  });
  return { references, errors, warnings };
};
