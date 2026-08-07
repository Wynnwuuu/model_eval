import {
  flattenGenerationReferences,
  parseStructuredGenerationValue,
} from '../../src/features/generation/mediaReferences.ts';
import { isForceableRelativeGenerationAsset } from '../../src/features/generation/vidmuseInputContract.ts';
import type {
  GenerationAudioBinding,
  GenerationContentMappingV2,
  GenerationElementBinding,
} from '../../src/types.ts';
import {
  matchUploadedAsset,
  type PreflightIssue,
  type UploadedAssetCandidate,
} from './generationPlanning.ts';

type ContentMappingCompileArgs = {
  row: Record<string, unknown>;
  mapping: GenerationContentMappingV2;
  outputModality: 'image' | 'video';
  assets: UploadedAssetCandidate[];
};

export type GenerationContentIntentAudit = {
  mappingVersion: 2;
  prompt: {
    column: string;
    format: GenerationContentMappingV2['prompt']['format'];
    rawValue?: unknown;
  };
  keyframes: {
    source: GenerationContentMappingV2['keyframes']['source'];
    fields: Array<{ role: 'first_frame' | 'last_frame'; column?: string; url: string }>;
  };
  elements: {
    source: GenerationContentMappingV2['elements']['source'];
    fields: Array<{ index: number; bindingId?: string; mode: string; value: unknown }>;
  };
  audios: {
    source: GenerationContentMappingV2['audios']['source'];
    fields: Array<{ index: number; bindingId?: string; value: unknown }>;
  };
};

const text = (value: unknown) => String(value ?? '').trim();

const resolveReferences = (
  values: unknown[],
  assets: UploadedAssetCandidate[],
  field: string,
): { urls: string[]; issues: PreflightIssue[] } => {
  const urls: string[] = [];
  const issues: PreflightIssue[] = [];
  for (const reference of values.flatMap(flattenGenerationReferences)) {
    if (/^(https?:\/\/|asset:\/\/)/i.test(reference)) {
      urls.push(reference);
      continue;
    }
    if (isForceableRelativeGenerationAsset(reference)) {
      urls.push(reference);
      continue;
    }
    const matched = matchUploadedAsset(reference, assets);
    if (matched.assetId) {
      urls.push(`asset://${matched.assetId}`);
    } else {
      issues.push({
        code: matched.errorCode || 'MISSING_ASSET',
        field,
        message: matched.message || `Uploaded asset was not found: ${reference}`,
      });
    }
  }
  return { urls, issues };
};

const MEDIA_FILE_PATTERN = /\.(?:jpe?g|png|webp|gif|avif|mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm)(?:[?#].*)?$/i;
const MEDIA_FIELD_PATTERN = /(?:url|uri|path|file|image|audio|video|asset|element|reference)/i;

const resolveStructuredAssets = (
  value: unknown,
  assets: UploadedAssetCandidate[],
  fieldPath: string,
): { value: unknown; issues: PreflightIssue[] } => {
  const parsed = parseStructuredGenerationValue(value);
  if (parsed !== value) return resolveStructuredAssets(parsed, assets, fieldPath);
  if (Array.isArray(value)) {
    const resolved = value.map((entry, index) =>
      resolveStructuredAssets(entry, assets, `${fieldPath}[${index}]`));
    return {
      value: resolved.map(entry => entry.value),
      issues: resolved.flatMap(entry => entry.issues),
    };
  }
  if (value && typeof value === 'object') {
    const resolved = Object.entries(value).map(([key, entry]) => ({
      key,
      ...resolveStructuredAssets(entry, assets, `${fieldPath}.${key}`),
    }));
    return {
      value: Object.fromEntries(resolved.map(entry => [entry.key, entry.value])),
      issues: resolved.flatMap(entry => entry.issues),
    };
  }
  if (typeof value !== 'string') return { value, issues: [] };
  const reference = value.trim();
  if (!reference
    || /^(https?:\/\/|asset:\/\/)/i.test(reference)
    || isForceableRelativeGenerationAsset(reference)) return { value, issues: [] };
  if (!MEDIA_FILE_PATTERN.test(reference) && !MEDIA_FIELD_PATTERN.test(fieldPath)) {
    return { value, issues: [] };
  }
  const matched = matchUploadedAsset(reference, assets);
  if (matched.assetId) return { value: `asset://${matched.assetId}`, issues: [] };
  return {
    value,
    issues: [{
      code: matched.errorCode || 'MISSING_ASSET',
      field: fieldPath,
      message: matched.message || `Uploaded asset was not found: ${reference}`,
    }],
  };
};

const resolveSingleReference = (
  value: unknown,
  assets: UploadedAssetCandidate[],
  field: string,
): { url?: string; issues: PreflightIssue[] } => {
  const resolved = resolveReferences([value], assets, field);
  if (resolved.urls.length <= 1) return { url: resolved.urls[0], issues: resolved.issues };
  return {
    url: resolved.urls[0],
    issues: [
      ...resolved.issues,
      {
        code: 'MULTIPLE_VALUES_FOR_SINGLE_INPUT',
        field,
        message: `${field} must resolve to at most one asset per case.`,
      },
    ],
  };
};

const finiteRange = (
  values: unknown[],
  field: string,
): { range?: [number, number]; issues: PreflightIssue[] } => {
  if (values.length !== 2 || values.some(value => text(value) === '')) {
    return {
      issues: [{
        code: 'INVALID_AUDIO_RANGE',
        field,
        message: 'Audio range requires both a start and end value.',
      }],
    };
  }
  const range = values.map(Number);
  if (!range.every(Number.isFinite) || range[0] < 0 || range[1] <= range[0]) {
    return {
      issues: [{
        code: 'INVALID_AUDIO_RANGE',
        field,
        message: 'Audio range must be [start, end] with 0 <= start < end.',
      }],
    };
  }
  return { range: [range[0], range[1]], issues: [] };
};

const resolveAudioRange = (
  row: Record<string, unknown>,
  binding: GenerationAudioBinding,
): { range?: [number, number]; issues: PreflightIssue[] } => {
  if (binding.rangeSource === 'none') return { issues: [] };
  if (binding.rangeSource === 'fixed') {
    return finiteRange(binding.fixedRange || [], `audios.${binding.id}.range`);
  }
  if (binding.rangeSource === 'column') {
    const rawValue = binding.rangeColumn ? row[binding.rangeColumn] : undefined;
    if (rawValue == null || text(rawValue) === '') {
      return finiteRange([], `audios.${binding.id}.range`);
    }
    const parsed = parseStructuredGenerationValue(rawValue);
    return finiteRange(Array.isArray(parsed) ? parsed : [], `audios.${binding.id}.range`);
  }
  return finiteRange([
    binding.rangeStartColumn ? row[binding.rangeStartColumn] : undefined,
    binding.rangeEndColumn ? row[binding.rangeEndColumn] : undefined,
  ], `audios.${binding.id}.range`);
};

const hasCaseAudioRangeValue = (
  row: Record<string, unknown>,
  binding: GenerationAudioBinding,
) => {
  if (binding.rangeSource === 'column') {
    return Boolean(binding.rangeColumn && text(row[binding.rangeColumn]) !== '');
  }
  if (binding.rangeSource === 'columns') {
    return Boolean(
      (binding.rangeStartColumn && text(row[binding.rangeStartColumn]) !== '')
      || (binding.rangeEndColumn && text(row[binding.rangeEndColumn]) !== ''),
    );
  }
  return false;
};


const compileElement = (
  row: Record<string, unknown>,
  binding: GenerationElementBinding,
  assets: UploadedAssetCandidate[],
): { value?: Record<string, unknown>; issues: PreflightIssue[] } => {
  const issues: PreflightIssue[] = [];
  if (binding.mode === 'video') {
    const video = resolveSingleReference(
      binding.videoColumn ? row[binding.videoColumn] : undefined,
      assets,
      `elements.${binding.id}.video_url`,
    );
    issues.push(...video.issues);
    return { value: video.url ? { video_url: video.url } : undefined, issues };
  }
  if (binding.mode === 'element_id') {
    const rawValue = binding.elementIdColumn ? row[binding.elementIdColumn] : undefined;
    if (rawValue == null || text(rawValue) === '') return { issues };
    const elementId = Number(rawValue);
    if (!Number.isInteger(elementId) || elementId < 0) {
      issues.push({
        code: 'INVALID_ELEMENT_ID',
        field: `elements.${binding.id}.element_id`,
        message: 'element_id must be a non-negative integer.',
      });
      return { issues };
    }
    return { value: { element_id: elementId }, issues };
  }

  const frontal = resolveSingleReference(
    binding.frontalImageColumn ? row[binding.frontalImageColumn] : undefined,
    assets,
    `elements.${binding.id}.frontal_image_url`,
  );
  const references = resolveReferences(
    [
      ...(binding.referenceImageColumns || []).map(column => row[column]),
      ...(binding.referenceImageArrayColumn ? [row[binding.referenceImageArrayColumn]] : []),
    ],
    assets,
    `elements.${binding.id}.reference_image_urls`,
  );
  issues.push(...frontal.issues, ...references.issues);
  if (!frontal.url && !references.urls.length) return { issues };
  return {
    value: {
      ...(frontal.url ? { frontal_image_url: frontal.url } : {}),
      ...(references.urls.length ? { reference_image_urls: references.urls } : {}),
    },
    issues,
  };
};

export const compileGenerationContentMappingV2 = ({
  row,
  mapping,
  outputModality,
  assets,
}: ContentMappingCompileArgs): {
  input: Record<string, unknown>;
  intent: GenerationContentIntentAudit;
  issues: PreflightIssue[];
} => {
  const issues: PreflightIssue[] = [];
  const input: Record<string, unknown> = {};
  const promptValue = mapping.prompt.column ? row[mapping.prompt.column] : undefined;
  if (promptValue !== undefined && promptValue !== null && text(promptValue) !== '') {
    input.prompt = promptValue;
  }

  const keyframeFields: GenerationContentIntentAudit['keyframes']['fields'] = [];
  let keyframeUrls: string[] = [];
  if (mapping.keyframes.source === 'columns') {
    const first = resolveSingleReference(
      mapping.keyframes.firstColumn ? row[mapping.keyframes.firstColumn] : undefined,
      assets,
      'image_urls.first_frame',
    );
    const last = resolveSingleReference(
      mapping.keyframes.lastColumn ? row[mapping.keyframes.lastColumn] : undefined,
      assets,
      'image_urls.last_frame',
    );
    issues.push(...first.issues, ...last.issues);
    if (last.url && !first.url) {
      issues.push({
        code: 'MISSING_FIRST_FRAME',
        field: 'image_urls',
        message: 'A last frame requires a first frame in the same case.',
      });
    }
    keyframeUrls = [...(first.url ? [first.url] : []), ...(last.url ? [last.url] : [])];
    if (first.url) keyframeFields.push({ role: 'first_frame', column: mapping.keyframes.firstColumn, url: first.url });
    if (last.url) keyframeFields.push({ role: 'last_frame', column: mapping.keyframes.lastColumn, url: last.url });
  } else if (mapping.keyframes.source === 'array_column') {
    const resolved = resolveReferences([row[mapping.keyframes.column]], assets, 'image_urls');
    issues.push(...resolved.issues);
    keyframeUrls = resolved.urls;
    resolved.urls.forEach((url, index) => keyframeFields.push({
      role: index === 0 ? 'first_frame' : 'last_frame',
      column: mapping.keyframes.source === 'array_column' ? mapping.keyframes.column : undefined,
      url,
    }));
  }
  if (keyframeUrls.length) input[outputModality === 'image' ? 'images' : 'image_urls'] = keyframeUrls;

  const elementFields: GenerationContentIntentAudit['elements']['fields'] = [];
  if (mapping.elements.source === 'array_column') {
    const resolved = resolveStructuredAssets(row[mapping.elements.column], assets, 'elements');
    issues.push(...resolved.issues);
    if (Array.isArray(resolved.value) && resolved.value.length) {
      input.elements = resolved.value;
      resolved.value.forEach((value, index) => elementFields.push({
        index: index + 1,
        mode: 'json',
        value,
      }));
    } else if (resolved.value != null && text(resolved.value) !== '') {
      input.elements = resolved.value;
    }
  } else if (mapping.elements.source === 'builder') {
    const elements: Record<string, unknown>[] = [];
    for (const binding of mapping.elements.items) {
      const compiled = compileElement(row, binding, assets);
      issues.push(...compiled.issues);
      if (!compiled.value) continue;
      elements.push(compiled.value);
      elementFields.push({
        index: elements.length,
        bindingId: binding.id,
        mode: binding.mode,
        value: compiled.value,
      });
    }
    if (elements.length) input.elements = elements;
  }

  const audioFields: GenerationContentIntentAudit['audios']['fields'] = [];
  if (mapping.audios.source === 'array_column') {
    const resolved = resolveStructuredAssets(row[mapping.audios.column], assets, 'audios');
    issues.push(...resolved.issues);
    if (Array.isArray(resolved.value) && resolved.value.length) {
      input.audios = resolved.value;
      resolved.value.forEach((value, index) => audioFields.push({ index: index + 1, value }));
    } else if (resolved.value != null && text(resolved.value) !== '') {
      input.audios = resolved.value;
    }
  } else if (mapping.audios.source === 'builder') {
    const audios: Array<Record<string, unknown>> = [];
    for (const binding of mapping.audios.items) {
      const audio = resolveSingleReference(
        binding.urlColumn ? row[binding.urlColumn] : undefined,
        assets,
        `audios.${binding.id}.url`,
      );
      const range = resolveAudioRange(row, binding);
      issues.push(...audio.issues);
      if (!audio.url) {
        if (hasCaseAudioRangeValue(row, binding)) {
          issues.push({
            code: 'AUDIO_RANGE_WITHOUT_URL',
            field: `audios.${binding.id}`,
            message: 'An audio range cannot be submitted without an audio URL.',
          });
        }
        continue;
      }
      issues.push(...range.issues);
      const value = { url: audio.url, ...(range.range ? { range: range.range } : {}) };
      audios.push(value);
      audioFields.push({ index: audios.length, bindingId: binding.id, value });
    }
    if (audios.length) input.audios = audios;
  }

  return {
    input,
    intent: {
      mappingVersion: 2,
      prompt: {
        column: mapping.prompt.column,
        format: mapping.prompt.format,
        ...(promptValue !== undefined ? { rawValue: promptValue } : {}),
      },
      keyframes: { source: mapping.keyframes.source, fields: keyframeFields },
      elements: { source: mapping.elements.source, fields: elementFields },
      audios: { source: mapping.audios.source, fields: audioFields },
    },
    issues,
  };
};

export const generationContentMappingColumns = (mapping: GenerationContentMappingV2) => {
  const columns = new Set<string>();
  const add = (column?: string) => {
    if (column?.trim()) columns.add(column.trim());
  };
  add(mapping.prompt.column);
  if (mapping.keyframes.source === 'columns') {
    add(mapping.keyframes.firstColumn);
    add(mapping.keyframes.lastColumn);
  } else if (mapping.keyframes.source === 'array_column') {
    add(mapping.keyframes.column);
  }
  if (mapping.elements.source === 'array_column') {
    add(mapping.elements.column);
  } else if (mapping.elements.source === 'builder') {
    mapping.elements.items.forEach(item => {
      add(item.frontalImageColumn);
      item.referenceImageColumns?.forEach(add);
      add(item.referenceImageArrayColumn);
      add(item.videoColumn);
      add(item.elementIdColumn);
    });
  }
  if (mapping.audios.source === 'array_column') {
    add(mapping.audios.column);
  } else if (mapping.audios.source === 'builder') {
    mapping.audios.items.forEach(item => {
      add(item.urlColumn);
      add(item.rangeColumn);
      add(item.rangeStartColumn);
      add(item.rangeEndColumn);
    });
  }
  return Array.from(columns);
};

