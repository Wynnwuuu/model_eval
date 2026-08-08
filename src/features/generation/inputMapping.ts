import type {
  DatasetColumnMappings,
  DatasetSchemaField,
  EvalDataset,
  GenerationInputMapping,
} from '../../types.js';
import type { GenerationImageRole } from './modelCapabilities.js';

export const VIDMUSE_EVALUATION_PRESET_COLUMNS = [
  'case_id',
  'modality',
  'prompt',
  'duration',
  'aspect_ratio',
  'resolution',
  'generate_audio',
  'audio_url',
  'image_urls',
  'elements',
] as const;

const exactHeaderMap = (headers: string[]) => new Map(
  headers.map(header => [header.trim().toLowerCase(), header] as const),
);

export const resolveVidMuseEvaluationPresetColumns = (
  headers: string[],
  fields: DatasetSchemaField[] = [],
) => {
  const exact = exactHeaderMap(headers);
  const resolved = new Map<string, string>();
  VIDMUSE_EVALUATION_PRESET_COLUMNS.forEach(column => {
    const direct = exact.get(column);
    if (direct) {
      resolved.set(column, direct);
      return;
    }
    const field = fields.find(candidate =>
      [candidate.sourceKey, candidate.key]
        .filter(Boolean)
        .some(value => String(value).trim().toLowerCase() === column));
    if (field && headers.includes(field.key)) resolved.set(column, field.key);
  });
  return Object.fromEntries(resolved) as Partial<Record<typeof VIDMUSE_EVALUATION_PRESET_COLUMNS[number], string>>;
};

export const hasVidMuseEvaluationPreset = (
  headers: string[],
  fields: DatasetSchemaField[] = [],
) => {
  const resolved = resolveVidMuseEvaluationPresetColumns(headers, fields);
  return VIDMUSE_EVALUATION_PRESET_COLUMNS.every(column => Boolean(resolved[column]));
};

export const defaultVidMuseEvaluationParameterColumns = (
  headers: string[],
  supportedKeys: string[],
  fields: DatasetSchemaField[] = [],
) => {
  const resolved = resolveVidMuseEvaluationPresetColumns(headers, fields);
  if (!VIDMUSE_EVALUATION_PRESET_COLUMNS.every(column => Boolean(resolved[column]))) return {};
  const supported = new Set(supportedKeys);
  return Object.fromEntries(
    ['aspect_ratio', 'resolution', 'generate_audio']
      .filter(key => supported.has(key) && Boolean(resolved[key as keyof typeof resolved]))
      .map(key => [key, {
        source: 'column' as const,
        column: resolved[key as keyof typeof resolved] as string,
      }]),
  );
};

export const generationRowMatchesModality = (
  row: Record<string, unknown>,
  outputModality: 'image' | 'video',
) => {
  const original = row._originalData && typeof row._originalData === 'object' && !Array.isArray(row._originalData)
    ? row._originalData as Record<string, unknown>
    : undefined;
  const value = String(row.modality ?? original?.modality ?? '').trim().toLowerCase();
  return !value || value === outputModality;
};

const emptyMapping = (): GenerationInputMapping => ({
  contentMappingVersion: 2,
  contentMapping: {
    version: 2,
    prompt: { column: '', format: 'text' },
    keyframes: { source: 'unused' },
    elements: { source: 'unused' },
    audios: { source: 'unused' },
  },
  mappingMode: 'mcp',
  compatibilityMode: 'strict',
  canonicalFieldMappings: {},
  promptColumn: '',
  referenceImageColumns: [],
  referenceAudioColumns: [],
  referenceVideoColumns: [],
  startImageColumn: '',
  endImageColumn: '',
  lyricsOrDialogueColumn: '',
  extraInputColumns: [],
  extraInputMappings: {},
});

const fieldMatches = (field: DatasetSchemaField, candidates: string[]) => {
  const haystack = [field.key, field.label, field.sourceKey, field.canonicalKey]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return candidates.some(candidate => haystack.includes(candidate));
};

export const defaultGenerationInputMapping = (
  dataset: EvalDataset,
  headers: string[],
  mappings: DatasetColumnMappings,
  outputModality?: 'image' | 'video',
): GenerationInputMapping => {
  const fields = dataset.inputSchema || [];
  const fieldKey = (predicate: (field: DatasetSchemaField) => boolean) =>
    fields.find(predicate)?.key;
  const exactHeader = (key: string) =>
    headers.find(header => header.trim().toLowerCase() === key.toLowerCase());
  const promptColumn =
    exactHeader('prompt')
    || mappings.standard.full_prompt
    || fieldKey(field => field.canonicalKey === 'full_prompt')
    || fieldKey(field => field.canonicalKey === 'zh_prompt')
    || mappings.inputColumns.find(column => headers.includes(column))
    || headers.find(header => /prompt|input/i.test(header))
    || '';
  const canonicalFieldMappings = Object.fromEntries(promptColumn ? [['prompt', promptColumn]] : []);
  const presetColumns = resolveVidMuseEvaluationPresetColumns(headers, fields);
  if (outputModality && VIDMUSE_EVALUATION_PRESET_COLUMNS.every(column => Boolean(presetColumns[column]))) {
    const presetPrompt = presetColumns.prompt || '';
    return {
      ...emptyMapping(),
      presetId: 'vidmuse_evaluation_v1',
      promptColumn: presetPrompt,
      canonicalFieldMappings: presetPrompt ? { prompt: presetPrompt } : {},
      contentMapping: {
        version: 2,
        prompt: { column: presetPrompt, format: 'text' },
        keyframes: { source: 'array_column', column: presetColumns.image_urls || '' },
        elements: outputModality === 'video'
          ? { source: 'array_column', column: presetColumns.elements || '' }
          : { source: 'unused' },
        audios: outputModality === 'video'
          ? {
              source: 'builder',
              items: [{
                id: 'preset-audio-1',
                urlColumn: presetColumns.audio_url || '',
                rangeSource: 'none',
              }],
            }
          : { source: 'unused' },
      },
    };
  }
  return {
    ...emptyMapping(),
    promptColumn,
    canonicalFieldMappings,
    contentMapping: {
      version: 2,
      prompt: { column: promptColumn, format: 'text' },
      keyframes: { source: 'unused' },
      elements: { source: 'unused' },
      audios: { source: 'unused' },
    },
  };
};

export const inferGenerationImageRole = (
  column: string,
  fields: DatasetSchemaField[],
): GenerationImageRole => {
  const field = fields.find(candidate => candidate.key === column);
  if (!field) {
    const normalized = column.toLowerCase();
    if (/first.?frame|start.?image|\u9996\u5e27/.test(normalized)) return 'start';
    if (/last.?frame|end.?image|\u5c3e\u5e27/.test(normalized)) return 'end';
    return 'reference';
  }
  if (field.canonicalKey === 'start_image_url' || fieldMatches(field, ['first frame', 'start image', '\u9996\u5e27'])) {
    return 'start';
  }
  if (field.canonicalKey === 'end_image_url' || fieldMatches(field, ['last frame', 'end image', '\u5c3e\u5e27'])) {
    return 'end';
  }
  return 'reference';
};

export const getGenerationImageRole = (
  mapping: GenerationInputMapping,
  column: string,
): GenerationImageRole | undefined => {
  if (mapping.startImageColumn === column) return 'start';
  if (mapping.endImageColumn === column) return 'end';
  if (mapping.referenceImageColumns.includes(column)) return 'reference';
  return undefined;
};

export const setGenerationImageRole = (
  mapping: GenerationInputMapping,
  column: string,
  role?: GenerationImageRole,
): GenerationInputMapping => {
  const next: GenerationInputMapping = {
    ...mapping,
    referenceImageColumns: mapping.referenceImageColumns.filter(value => value !== column),
    startImageColumn: mapping.startImageColumn === column ? '' : mapping.startImageColumn,
    endImageColumn: mapping.endImageColumn === column ? '' : mapping.endImageColumn,
  };

  if (role === 'reference') next.referenceImageColumns = [...next.referenceImageColumns, column];
  if (role === 'start') next.startImageColumn = column;
  if (role === 'end') next.endImageColumn = column;
  return next;
};
