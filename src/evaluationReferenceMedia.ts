import { inferReferenceMediaType } from './mediaTypeUtils';
import { extractMediaUrls, resolvePlaybackUrl } from './mediaUrlUtils';
import type { EvaluationItem } from './types';

export type EvaluationReferenceMediaType = 'image' | 'video' | 'audio';

export interface EvaluationReferenceMedia {
  id: string;
  url: string;
  type: EvaluationReferenceMediaType;
  sourceOrder: number;
}

interface ReferenceMediaResolution {
  media: EvaluationReferenceMedia[];
  inputKeys: Set<string>;
}

const REFERENCE_ROOT_PATTERN = /(?:^|[_\s-])(ref(?:erence)?|image(?:s|_urls?)?|video(?:s|_urls?)?|audio(?:s|_urls?)?|element(?:s)?|media|music|bgm|sound|voice|start|end|first|last|frame)(?:$|[_\s-])|参考|參考|图片|圖像|图像|视频|視頻|音频|音頻|音乐|音樂|配乐|配樂|首帧|首幀|尾帧|尾幀/i;
const REFERENCE_TEXT_FIELD_PATTERN = /(?:^|[_\s-])(prompt|description|caption|note|text)(?:$|[_\s-])|说明|說明|描述|备注|備註/i;
const AUDIO_KEY_PATTERN = /audio|audios|music|bgm|sound|voice|音频|音頻|音乐|音樂|配乐|配樂/i;
const VIDEO_KEY_PATTERN = /video|videos|视频|視頻/i;
const IMAGE_KEY_PATTERN = /image|images|frame|frontal|图片|圖像|图像|首帧|首幀|尾帧|尾幀/i;

const normalizeMediaUrl = (value: unknown) => resolvePlaybackUrl(value).trim();

const isReferenceRootKey = (key: string) =>
  !REFERENCE_TEXT_FIELD_PATTERN.test(key) && REFERENCE_ROOT_PATTERN.test(key);

const inferMediaType = (
  path: string[],
  url: string,
  fallback: EvaluationReferenceMediaType = 'image',
): EvaluationReferenceMediaType => {
  const pathLabel = path.join('.');
  if (AUDIO_KEY_PATTERN.test(pathLabel)) return 'audio';
  if (VIDEO_KEY_PATTERN.test(pathLabel)) return 'video';
  if (IMAGE_KEY_PATTERN.test(pathLabel)) return 'image';

  const inferred = inferReferenceMediaType(url);
  return inferred === 'audio' || inferred === 'video' || inferred === 'image'
    ? inferred
    : fallback;
};

const parseStructuredString = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const resolveReferenceMediaDetails = (item: EvaluationItem): ReferenceMediaResolution => {
  const storedReferences = [item.startImageUrl, ...(item.referenceUrls || [])]
    .map(normalizeMediaUrl)
    .filter(Boolean);
  const storedReferenceSet = new Set(storedReferences);
  const candidates: Array<{ url: string; type: EvaluationReferenceMediaType }> = [];
  const inputKeys = new Set<string>();

  const addCandidate = (urlValue: unknown, path: string[], fallback?: EvaluationReferenceMediaType) => {
    const url = normalizeMediaUrl(urlValue);
    if (!url) return false;
    candidates.push({ url, type: inferMediaType(path, url, fallback) });
    return true;
  };

  const visitValue = (value: unknown, path: string[]): boolean => {
    if (value === null || value === undefined || value === '') return false;

    if (Array.isArray(value)) {
      return value.reduce(
        (found, entry, index) => visitValue(entry, [...path, String(index)]) || found,
        false,
      );
    }

    if (typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce(
        (found, [key, entry]) => visitValue(entry, [...path, key]) || found,
        false,
      );
    }

    if (typeof value !== 'string') return false;
    const parsed = parseStructuredString(value);
    if (parsed !== undefined) return visitValue(parsed, path);

    const leafKey = [...path].reverse().find(segment => !/^\d+$/.test(segment)) || '';
    const leafIsReference = isReferenceRootKey(leafKey);

    let found = false;
    extractMediaUrls(value).forEach(rawUrl => {
      const url = normalizeMediaUrl(rawUrl);
      if (!url || (!leafIsReference && !storedReferenceSet.has(url))) return;
      found = addCandidate(url, path) || found;
    });
    return found;
  };

  Object.entries(item.inputs || {}).forEach(([key, value]) => {
    const found = visitValue(value, [key]);
    if (found) inputKeys.add(key);
  });

  storedReferences.forEach((url, index) => {
    if (candidates.some(candidate => candidate.url === url)) return;
    addCandidate(url, [], index === 0 && normalizeMediaUrl(item.startImageUrl) === url ? 'image' : undefined);
  });

  const seen = new Set<string>();
  const media = candidates.flatMap(candidate => {
    if (seen.has(candidate.url)) return [];
    seen.add(candidate.url);
    const sourceOrder = seen.size - 1;
    return [{
      id: `reference-media-${sourceOrder}`,
      url: candidate.url,
      type: candidate.type,
      sourceOrder,
    } satisfies EvaluationReferenceMedia];
  });

  return { media, inputKeys };
};

export const resolveEvaluationReferenceMedia = (item: EvaluationItem): EvaluationReferenceMedia[] =>
  resolveReferenceMediaDetails(item).media;

export const getEvaluationReferenceInputKeys = (item: EvaluationItem): Set<string> =>
  resolveReferenceMediaDetails(item).inputKeys;
