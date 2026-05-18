import { VIDEO_EXTENSIONS } from './constants';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'svg'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];

export type PreviewMediaType = 'text' | 'markdown' | 'image' | 'video' | 'audio' | 'unknown';

export const looksLikeUrl = (value: unknown) =>
  typeof value === 'string' && /^https?:\/\//i.test(value.trim());

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

  if (looksLikeAudioColumn(label) && looksLikeUrl(trimmed)) return 'audio';

  if (!looksLikeUrl(trimmed)) {
    if (/^#{1,6}\s|\n[-*]\s|\n\d+\.\s|```/.test(trimmed)) return 'markdown';
    return 'text';
  }

  const extension = getExtension(trimmed);
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
  return fallback === 'image' || fallback === 'video' || fallback === 'audio' ? fallback : 'unknown';
};
