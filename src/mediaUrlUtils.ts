import { normalizeUrl } from './utils';

const stripTrailingUrlJunk = (value: string): string =>
  value.trim().replace(/[)\],;，；。]+$/g, '').trim();

/** Extract one or more media URLs from plain text, JSON arrays, or JSON objects. */
export const extractMediaUrls = (value: unknown): string[] => {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => extractMediaUrls(item));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(item => extractMediaUrls(item));
  }
  if (typeof value !== 'string') return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.flatMap(item => extractMediaUrls(item));
      }
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        if (typeof record.url === 'string') return extractMediaUrls(record.url);
        if (typeof record.src === 'string') return extractMediaUrls(record.src);
      }
    } catch {
      // Fall through to regex extraction.
    }
  }

  const matches = trimmed.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return matches.map(stripTrailingUrlJunk).filter(Boolean);
};

/** Pick the first playable URL from a CSV cell or payload field. */
export const resolvePlaybackUrl = (value: unknown): string => {
  const urls = extractMediaUrls(value);
  if (urls.length > 0) return normalizeUrl(urls[0]);
  return typeof value === 'string' ? value.trim() : '';
};
