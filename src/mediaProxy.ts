import { normalizeUrl } from './utils';
import { API_BASE_URL } from './runtimeConfig';

export const MEDIA_PROXY_HOSTS = ['vidmuse.sandcdn.com', 'vidmuse-dev.sandcdn.com', 'vidmuse-video.sandcdn.com'];
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

const createProxyUrl = (normalizedUrl: string): string | null => {
  try {
    const parsed = new URL(normalizedUrl);
    if (!MEDIA_PROXY_HOSTS.includes(parsed.hostname)) return null;
  } catch {
    return null;
  }

  const encoded = encodeURIComponent(normalizedUrl);
  if (API_BASE_URL) {
    return `${API_BASE_URL}/api/media-proxy?url=${encoded}`;
  }

  // Vite dev server forwards /api to the local API (see vite.config.ts).
  return `/api/media-proxy?url=${encoded}`;
};

const isAudioUrl = (url: string): boolean =>
  /\.(mp3|wav|ogg|m4a|aac|flac)(?:$|[?#])/i.test(url) ||
  /\/audios?\//i.test(url) ||
  /vidmuse-video\.sandcdn\.com/i.test(url);

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

    const proxyUrl = createProxyUrl(normalized);
    const directCandidate: MediaPlaybackCandidate = { url: normalized, kind: 'direct', label: 'Direct' };
    if (!proxyUrl || proxyUrl === normalized) {
      return [directCandidate];
    }

    const proxyCandidate: MediaPlaybackCandidate = { url: proxyUrl, kind: 'proxy', label: 'Proxy' };
    // Audio on sandcdn often fails direct playback (CORS); try proxy first.
    if (isAudioUrl(normalized)) {
      return [proxyCandidate, directCandidate];
    }

    return [directCandidate, proxyCandidate];
  } catch {
    return [{ url: normalized, kind: 'direct', label: 'Direct' }];
  }
};

export const resolveMediaPlaybackUrl = (url: string): string => {
  const [firstCandidate] = resolveMediaPlaybackCandidates(url);
  return firstCandidate?.url || '';
};
