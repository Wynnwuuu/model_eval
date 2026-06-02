import { VIDEO_EXTENSIONS } from './constants';
import { extractMediaUrls, resolvePlaybackUrl } from './mediaUrlUtils';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];

export type PreviewMediaType = 'text' | 'markdown' | 'image' | 'video' | 'audio' | 'unknown';

export const looksLikeUrl = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) || extractMediaUrls(trimmed).length > 0;
};

const looksLikeAudioColumn = (label?: string) =>
  !!label && /(audio|music|song|sound|voice|bgm|音频|音乐|歌曲|配乐|声音|语音)/i.test(label);

const getExtension = (value: string) => {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.toLowerCase();
    return path.includes('.') ? path.split('.').pop() || '' : '';
  } catch {
    const clean = value.trim().split('?')[0].split('#')[0].toLowerCase();
    return clean.includes('.') ? clean.split('.').pop() || '' : '';
  }
};

export const inferPreviewMediaType = (value: unknown, fallback: PreviewMediaType = 'text', label?: string): PreviewMediaType => {
  if (value === null || value === undefined || value === '') return 'unknown';
  if (typeof value !== 'string') return 'text';

  const trimmed = value.trim();
  if (!trimmed) return 'unknown';

  const resolvedUrl = resolvePlaybackUrl(trimmed);
  const hasMediaUrl = Boolean(resolvedUrl && /^https?:\/\//i.test(resolvedUrl));

  if (looksLikeAudioColumn(label) && hasMediaUrl) return 'audio';

  if (!hasMediaUrl) {
    if (/^#{1,6}\s|\n[-*]\s|\n\d+\.\s|```/.test(trimmed)) return 'markdown';
    return 'text';
  }

  const extension = getExtension(resolvedUrl);
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  return fallback === 'image' || fallback === 'video' || fallback === 'audio' ? fallback : 'unknown';
};

/** Display order for reference carousel: images first, audio last. */
const REFERENCE_DISPLAY_ORDER: PreviewMediaType[] = ['image', 'video', 'unknown', 'text', 'markdown', 'audio'];

export const inferReferenceMediaType = (url: string): PreviewMediaType =>
  inferPreviewMediaType(resolvePlaybackUrl(url), 'unknown');

export const sortReferenceUrls = (urls: string[]): string[] => {
  if (urls.length <= 1) return [...urls];

  const rank = (type: PreviewMediaType) => {
    const found = REFERENCE_DISPLAY_ORDER.indexOf(type);
    return found === -1 ? REFERENCE_DISPLAY_ORDER.length - 1 : found;
  };

  return urls
    .map((url, index) => ({ url, index, type: inferReferenceMediaType(url) }))
    .sort((a, b) => {
      const diff = rank(a.type) - rank(b.type);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(entry => entry.url);
};

export const getReferenceThumbnailUrl = (urls: string[]): string | undefined =>
  urls.find(url => inferReferenceMediaType(url) === 'image');
