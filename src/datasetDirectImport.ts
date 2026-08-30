import {
  appendDatasetVersion,
  buildDatasetCard,
  inferInputTypeFromDataset,
  inferPreviewType,
  inferSchemaType,
  validateDatasetItems,
} from './datasetManifest.ts';
import { ensureStableDatasetItemIds } from './datasetSync.ts';
import { validateDatasetSyncSource } from './datasetVersionedSync.ts';
import type {
  DatasetCard,
  DatasetColumnMappings,
  DatasetFieldRole,
  DatasetModality,
  DatasetPreviewType,
  DatasetSchemaField,
  EvalDataset,
  SchemaFieldType,
} from './types.ts';

export const MAX_DIRECT_IMPORT_ROWS = 10_000;

const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key =>
    `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`
  ).join(',')}}`;
};

export const hashDirectImportSnapshot = (
  headers: string[],
  rows: Record<string, unknown>[],
) => {
  const text = stableSerialize({ headers, rows });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `local-${(hash >>> 0).toString(36)}`;
};

export type DatasetDirectImportIdentityMode = 'case_variant' | 'internal';

export type DatasetDirectImportIssueCode =
  | 'MISSING_CASE_ID'
  | 'DUPLICATE_CASE_IDENTITY';

export type DatasetDirectImportWarningCode =
  | 'MISSING_CASE_ID_COLUMN';

export interface DatasetDirectImportIssue {
  code: DatasetDirectImportIssueCode;
  message: string;
  rowIndexes: number[];
}

export interface DatasetDirectImportWarning {
  code: DatasetDirectImportWarningCode;
  message: string;
}

export interface DatasetDirectImportColumn {
  key: string;
  role: DatasetFieldRole;
  usage: 'identity' | 'content' | 'reference' | 'parameter' | 'evaluation' | 'metadata';
  type: SchemaFieldType;
  previewType: DatasetPreviewType;
  canonicalKey?: string;
  sampleValue: unknown;
  outputEligible: boolean;
}

export interface DatasetDirectImportPreview {
  snapshotHash: string;
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  columnCount: number;
  identityMode: DatasetDirectImportIdentityMode;
  columns: DatasetDirectImportColumn[];
  issues: DatasetDirectImportIssue[];
  warnings: DatasetDirectImportWarning[];
  valid: boolean;
}

export interface DatasetDirectImportMetadata {
  name: string;
  description: string;
  tags: string[];
  modality: DatasetModality;
  categoryPath: string[];
  datasetCard: Pick<DatasetCard,
    'applicableTasks' | 'applicableStages' | 'source' | 'rubricBinding' | 'coverageGaps'>;
}

interface DirectFieldContract {
  role: DatasetFieldRole;
  usage: DatasetDirectImportColumn['usage'];
  type?: SchemaFieldType;
  previewType?: DatasetPreviewType;
}

const DIRECT_FIELD_CONTRACT: Record<string, DirectFieldContract> = {
  case_id: { role: 'case_id', usage: 'identity', type: 'text', previewType: 'text' },
  cell_id: { role: 'metadata', usage: 'evaluation' },
  variant_label: { role: 'metadata', usage: 'identity' },
  prompt: { role: 'input', usage: 'content' },
  full_prompt: { role: 'input', usage: 'content' },
  zh_prompt: { role: 'input', usage: 'content' },
  image_urls: { role: 'reference', usage: 'reference', type: 'image_url', previewType: 'image' },
  images: { role: 'reference', usage: 'reference', type: 'image_url', previewType: 'image' },
  elements: { role: 'reference', usage: 'reference', type: 'text', previewType: 'text' },
  audio_url: { role: 'reference', usage: 'reference', type: 'audio_url', previewType: 'audio' },
  audios: { role: 'reference', usage: 'reference', type: 'audio_url', previewType: 'audio' },
  reference_image_urls: { role: 'reference', usage: 'reference', type: 'image_url', previewType: 'image' },
  reference_image_note: { role: 'reference', usage: 'reference' },
  start_image_url: { role: 'reference', usage: 'reference', type: 'image_url', previewType: 'image' },
  end_image_url: { role: 'reference', usage: 'reference', type: 'image_url', previewType: 'image' },
  lyrics_or_dialogue: { role: 'input', usage: 'content' },
  eval_dimension: { role: 'dimension', usage: 'evaluation' },
  observation_focus: { role: 'rubric', usage: 'evaluation' },
  constraints: { role: 'rubric', usage: 'evaluation' },
  rubric: { role: 'rubric', usage: 'evaluation' },
  evidence_plan: { role: 'rubric', usage: 'evaluation' },
  cannot_judge_rules: { role: 'rubric', usage: 'evaluation' },
  expected_failure_modes: { role: 'rubric', usage: 'evaluation' },
  purpose: { role: 'metadata', usage: 'evaluation' },
  effects: { role: 'metadata', usage: 'evaluation' },
  intent: { role: 'metadata', usage: 'evaluation' },
  source_dataset: { role: 'metadata', usage: 'metadata' },
  source_thread: { role: 'metadata', usage: 'metadata' },
  source_note: { role: 'metadata', usage: 'metadata' },
  eval_form: { role: 'metadata', usage: 'evaluation' },
  stage: { role: 'metadata', usage: 'evaluation' },
  tags: { role: 'metadata', usage: 'metadata' },
  beat_segment_map: { role: 'metadata', usage: 'evaluation' },
  test_variable: { role: 'metadata', usage: 'evaluation' },
  control_variable: { role: 'metadata', usage: 'evaluation' },
  pending_questions: { role: 'metadata', usage: 'evaluation' },
  design_rationale: { role: 'metadata', usage: 'evaluation' },
  duration: { role: 'metadata', usage: 'parameter' },
  aspect_ratio: { role: 'metadata', usage: 'parameter' },
  resolution: { role: 'metadata', usage: 'parameter' },
  generate_audio: { role: 'metadata', usage: 'parameter' },
  negative_prompt: { role: 'metadata', usage: 'parameter' },
  generation_method: { role: 'metadata', usage: 'metadata' },
  modality: { role: 'metadata', usage: 'metadata' },
};

const firstPresentValue = (rows: Record<string, unknown>[], key: string) =>
  rows.map(row => row[key]).find(value => value !== undefined && value !== null && value !== '');

const assertSnapshotShape = (headers: string[], rows: Record<string, unknown>[]) => {
  if (!headers.length) throw new Error('直接导入必须包含至少一个列名。');
  if (headers.some(header => typeof header !== 'string' || !header.trim())) {
    throw new Error('直接导入包含空列名。');
  }
  if (new Set(headers).size !== headers.length) throw new Error('直接导入包含重复列名。');
  if (headers.some(header => header.startsWith('__'))) {
    throw new Error('以 __ 开头的列名由 ManuEval 保留，不能直接导入。');
  }
  if (rows.length > MAX_DIRECT_IMPORT_ROWS) {
    throw new Error(`单次最多直接导入 ${MAX_DIRECT_IMPORT_ROWS} 条 case。`);
  }
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`第 ${index + 1} 行不是有效对象。`);
    }
  });
};

const normalizeRows = (headers: string[], rows: Record<string, unknown>[]) => rows.map(row =>
  Object.fromEntries(headers.map(header => [
    header,
    Object.prototype.hasOwnProperty.call(row, header) ? row[header] : '',
  ]))
);

const describeIdentityIssue = (
  issue: ReturnType<typeof validateDatasetSyncSource>['issues'][number],
): DatasetDirectImportIssue => ({
  code: issue.code === 'MISSING_CASE_ID' ? 'MISSING_CASE_ID' : 'DUPLICATE_CASE_IDENTITY',
  rowIndexes: issue.rowIndexes,
  message: issue.code === 'MISSING_CASE_ID'
    ? `第 ${issue.rowIndexes.map(index => index + 1).join('、')} 行缺少 case_id。`
    : `case_id + variant_label 重复：${issue.identity}（第 ${issue.rowIndexes.map(index => index + 1).join('、')} 行）。`,
});

const inferDirectColumn = (
  key: string,
  rows: Record<string, unknown>[],
): DatasetDirectImportColumn => {
  const contract = DIRECT_FIELD_CONTRACT[key];
  const samples = rows.slice(0, 5).map(row => row[key]);
  const previewType = contract?.previewType || inferPreviewType(key, samples);
  return {
    key,
    role: contract?.role || 'metadata',
    usage: contract?.usage || 'metadata',
    type: contract?.type || inferSchemaType(previewType),
    previewType,
    ...(contract ? { canonicalKey: key } : {}),
    sampleValue: firstPresentValue(rows.slice(0, 5), key) ?? '',
    outputEligible: contract?.usage !== 'identity' && !key.startsWith('__'),
  };
};

export const buildDatasetDirectImportPreview = (input: {
  headers: string[];
  rows: Record<string, unknown>[];
  snapshotHash: string;
}): DatasetDirectImportPreview => {
  assertSnapshotShape(input.headers, input.rows);
  const rows = normalizeRows(input.headers, input.rows);
  const hasCaseId = input.headers.includes('case_id');
  const issues = hasCaseId
    ? validateDatasetSyncSource(rows).issues.map(describeIdentityIssue)
    : [];
  const warnings: DatasetDirectImportWarning[] = hasCaseId ? [] : [{
    code: 'MISSING_CASE_ID_COLUMN',
    message: '源表没有精确 case_id 列。平台会生成隐藏稳定 ID，但不能保证后续按源表增量同步和继承历史结果。',
  }];
  return {
    snapshotHash: input.snapshotHash,
    headers: [...input.headers],
    rows,
    rowCount: rows.length,
    columnCount: input.headers.length,
    identityMode: hasCaseId ? 'case_variant' : 'internal',
    columns: input.headers.map(key => inferDirectColumn(key, rows)),
    issues,
    warnings,
    valid: issues.length === 0,
  };
};

const fallbackPreviewForModality = (modality: DatasetModality): DatasetPreviewType => {
  if (modality === 'image') return 'image';
  if (modality === 'video') return 'video';
  if (modality === 'audio') return 'audio';
  return 'text';
};

const outputPreviewType = (
  column: DatasetDirectImportColumn,
  rows: Record<string, unknown>[],
  modality: DatasetModality,
) => {
  const inferred = inferPreviewType(column.key, rows.slice(0, 5).map(row => row[column.key]));
  return inferred === 'text' && modality !== 'text' && modality !== 'other' && modality !== 'multimodal'
    ? fallbackPreviewForModality(modality)
    : inferred;
};

const schemaFromPreview = (
  preview: DatasetDirectImportPreview,
  outputColumns: Set<string>,
  modality: DatasetModality,
): DatasetSchemaField[] => preview.columns.map(column => {
  const isOutput = outputColumns.has(column.key);
  const previewType = isOutput ? outputPreviewType(column, preview.rows, modality) : column.previewType;
  return {
    key: column.key,
    label: column.key,
    sourceKey: column.key,
    role: isOutput ? 'output' : column.role,
    type: isOutput ? inferSchemaType(previewType) : column.type,
    previewType,
    ...(column.canonicalKey ? { canonicalKey: column.canonicalKey } : {}),
    ...(column.key === 'case_id' ? { required: true } : {}),
  };
});

const mappingsFromSchema = (schema: DatasetSchemaField[]): DatasetColumnMappings => ({
  caseId: schema.find(field => field.role === 'case_id')?.key,
  inputColumns: schema.filter(field => field.role === 'input').map(field => field.key),
  outputColumns: schema.filter(field => field.role === 'output').map(field => field.key),
  dimensionColumns: schema.filter(field => field.role === 'dimension').map(field => field.key),
  referenceColumns: schema.filter(field => field.role === 'reference' || field.role === 'media').map(field => field.key),
  standard: Object.fromEntries(schema
    .filter(field => field.canonicalKey)
    .map(field => [field.canonicalKey as string, field.key])),
});

export const compileDirectImportDataset = (input: {
  id: string;
  preview: DatasetDirectImportPreview;
  outputColumns: string[];
  metadata: DatasetDirectImportMetadata;
  actor: { id: string; name: string };
  now?: number;
}): EvalDataset => {
  if (!input.preview.valid) throw new Error('直接导入预检存在阻断问题。');
  const requestedOutputColumns = [...new Set(input.outputColumns)];
  requestedOutputColumns.forEach(column => {
    const descriptor = input.preview.columns.find(item => item.key === column);
    if (!descriptor) throw new Error(`模型结果列不在源表中：${column}`);
    if (!descriptor.outputEligible || descriptor.usage === 'identity') throw new Error(`身份列 ${column} 不能标记为模型结果。`);
    if (column.startsWith('__')) throw new Error(`保留字段不能标记为模型结果：${column}`);
  });
  const requestedOutputSet = new Set(requestedOutputColumns);
  const outputColumns = input.preview.headers.filter(column => requestedOutputSet.has(column));

  const now = input.now ?? Date.now();
  const outputSet = new Set(outputColumns);
  const schema = schemaFromPreview(input.preview, outputSet, input.metadata.modality);
  const mappings = mappingsFromSchema(schema);
  const items = ensureStableDatasetItemIds(input.id, input.preview.rows.map(row => ({ ...row })));
  const inputType = inferInputTypeFromDataset({
    id: input.id,
    inputSchema: schema,
    items,
    columnMappings: mappings,
  } as EvalDataset);
  const versionMeta = appendDatasetVersion(
    {},
    input.actor.name,
    `直接导入 ${items.length} 条 case、${schema.length} 列`,
    0,
    items.length,
  );
  const datasetBase = {
    id: input.id,
    name: input.metadata.name.trim().slice(0, 100),
    description: input.metadata.description.trim(),
    tags: [...input.metadata.tags],
    inputSchema: schema,
    items,
    inputType,
    modality: input.metadata.modality,
    categoryPath: [...input.metadata.categoryPath],
    columnMappings: mappings,
    validationSummary: validateDatasetItems(items, mappings),
    importMetadata: {
      version: 1,
      mode: 'direct',
      identityMode: input.preview.identityMode,
    },
    ...versionMeta,
    creatorUid: input.actor.id,
    creatorName: input.actor.name,
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<EvalDataset, 'datasetCard'>;
  return {
    ...datasetBase,
    datasetCard: buildDatasetCard(datasetBase, mappings, {
      ...input.metadata.datasetCard,
      latestChange: '直接导入评测集',
      modality: input.metadata.modality,
      updatedAt: now,
    }),
  };
};
