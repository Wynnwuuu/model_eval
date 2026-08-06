import type {
  DatasetColumnMappings,
  DatasetSchemaField,
  EvalDataset,
  GenerationInputMapping,
} from '../../types';
import type { GenerationImageRole } from './modelCapabilities';

const emptyMapping = (): GenerationInputMapping => ({
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
  const canonicalFieldMappings = Object.fromEntries([
    ...(promptColumn ? [['prompt', promptColumn]] : []),
    ...['image_urls', 'images', 'elements', 'audios'].flatMap(key => {
      const column = exactHeader(key);
      return column ? [[key, column]] : [];
    }),
  ]);
  return {
    ...emptyMapping(),
    promptColumn,
    canonicalFieldMappings,
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
