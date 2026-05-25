import { normalizeUrl } from './utils';
import { API_BASE_URL } from './runtimeConfig';

export const MEDIA_PROXY_HOSTS = ['vidmuse.sandcdn.com', 'vidmuse-dev.sandcdn.com'];
export const CDN_PROXY_PREFIX = '/media-proxy';
export const CDN_DEV_PROXY_PREFIX = '/media-dev-proxy';

export const isProxiedMediaUrl = (url: string): boolean =>
  url.startsWith(CDN_PROXY_PREFIX) || url.startsWith(CDN_DEV_PROXY_PREFIX) || url.includes('/api/media-proxy?url=');

export type MediaPlaybackCandidateKind = 'direct' | 'proxy';

export interface MediaPlaybackCandidate {
  url: string;
  kind: MediaPlaybackCandidateKind;
  label: string;
}

const createProxyUrl = (normalizedUrl: string, hostname: string): string | null => {
  if (API_BASE_URL) {
    return `${API_BASE_URL}/api/media-proxy?url=${encodeURIComponent(normalizedUrl)}`;
  }

  if (!import.meta.env.DEV) {
    return `/api/media-proxy?url=${encodeURIComponent(normalizedUrl)}`;
  }

  try {
    const parsed = new URL(normalizedUrl);
    if (hostname === 'vidmuse.sandcdn.com') {
      return `${CDN_PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    if (hostname === 'vidmuse-dev.sandcdn.com') {
      return `${CDN_DEV_PROXY_PREFIX}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return null;
  }

  return null;
};

export const resolveMediaPlaybackCandidates = (url: string): MediaPlaybackCandidate[] => {
  const raw = url?.trim() || '';
  if (!raw) return [];

  if (raw.startsWith('data:') || raw.startsWith('blob:')) {
    return [{ url: raw, kind: 'direct', label: 'Direct' }];
  }

  if (isProxiedMediaUrl(raw)) {
    return [{ url: raw, kind: 'proxy', label: 'Proxy' }];
  }

  const normalized = normalizeUrl(url);
  if (!normalized) return [];

  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return [{ url: normalized, kind: 'direct', label: 'Direct' }];
  }

  if (isProxiedMediaUrl(normalized)) {
    return [{ url: normalized, kind: 'proxy', label: 'Proxy' }];
  }

  try {
    const parsed = new URL(normalized);
    if (!MEDIA_PROXY_HOSTS.includes(parsed.hostname)) {
      return [{ url: normalized, kind: 'direct', label: 'Direct' }];
    }

    const candidates: MediaPlaybackCandidate[] = [
      { url: normalized, kind: 'direct', label: 'Direct' }
    ];
    const proxyUrl = createProxyUrl(normalized, parsed.hostname);
    if (proxyUrl && proxyUrl !== normalized) {
      candidates.push({ url: proxyUrl, kind: 'proxy', label: 'Proxy' });
    }

    return candidates;
  } catch {
    return [{ url: normalized, kind: 'direct', label: 'Direct' }];
  }
};

export const resolveMediaPlaybackUrl = (url: string): string => {
  const [firstCandidate] = resolveMediaPlaybackCandidates(url);
  return firstCandidate?.url || '';
};
