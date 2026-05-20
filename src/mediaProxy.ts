import { normalizeUrl } from './utils';

export const MEDIA_PROXY_HOSTS = ['vidmuse.sandcdn.com', 'vidmuse-dev.sandcdn.com'];
export const CDN_PROXY_PREFIX = '/media-proxy';
export const CDN_DEV_PROXY_PREFIX = '/media-dev-proxy';

export const isProxiedMediaUrl = (url: string): boolean =>
  url.startsWith(CDN_PROXY_PREFIX) || url.startsWith(CDN_DEV_PROXY_PREFIX) || url.includes('/api/media-proxy?url=');

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

    const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
    if (apiBaseUrl) {
      return `${apiBaseUrl}/api/media-proxy?url=${encodeURIComponent(normalized)}`;
    }

    if (!import.meta.env.DEV) {
      return `/api/media-proxy?url=${encodeURIComponent(normalized)}`;
    }

    if (parsed.hostname === 'vidmuse.sandcdn.com') {
      return `${CDN_PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    if (parsed.hostname === 'vidmuse-dev.sandcdn.com') {
      return `${CDN_DEV_PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return normalized;
  }

  return normalized;
};
