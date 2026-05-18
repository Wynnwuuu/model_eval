import { normalizeUrl } from './utils';

export const MEDIA_PROXY_HOSTS = ['vidmuse.sandcdn.com'];
export const CDN_PROXY_PREFIX = '/media-proxy';

export const isProxiedMediaUrl = (url: string): boolean =>
  url.startsWith(CDN_PROXY_PREFIX) || url.includes('/api/media-proxy?url=');

export const resolveMediaPlaybackUrl = (url: string): string => {
  if (!url?.trim()) return url;

  const normalized = normalizeUrl(url);
  if (!normalized || normalized.startsWith('data:') || normalized.startsWith('blob:') || isProxiedMediaUrl(normalized)) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (!MEDIA_PROXY_HOSTS.includes(parsed.hostname)) {
      return normalized;
    }

    if (import.meta.env.DEV) {
      return `${CDN_PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
    if (apiBaseUrl) {
      return `${apiBaseUrl}/api/media-proxy?url=${encodeURIComponent(normalized)}`;
    }
  } catch {
    return normalized;
  }

  return normalized;
};
