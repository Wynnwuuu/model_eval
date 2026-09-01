import {
  DatasetCard,
  DatasetColumnMappings,
  DatasetFieldRole,
  DatasetModality,
  DatasetPreviewType,
  DatasetSchemaField,
  DatasetStandardFieldDefinition,
  DatasetValidationSummary,
  DatasetVersionEntry,
  EvalDataset,
  SchemaFieldType
} from './types.ts';
import { getDatasetActiveColumnKeys } from './datasetColumnDeletion.ts';

const URL_PATTERN = /https?:\/\/[^\s"'\t|,;>]+/i;
const VIDEO_PATTERN = /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i;
const IMAGE_PATTERN = /\.(jpeg|jpg|gif|png|webp|bmp|svg)(\?|#|$)/i;
const AUDIO_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg)(\?|#|$)/i;

export const DATASET_MODALITIES: Array<{ key: DatasetModality; label: string; description: string }> = [
  { key: 'image', label: '图像', description: '模型产物是图片' },
  { key: 'video', label: '视频', description: '模型产物是视频' },
  { key: 'audio', label: '音频', description: '模型产物是音乐/语音' },
  { key: 'text', label: '文本', description: '模型产物是文本' },
  { key: 'multimodal', label: '多模态', description: '模型产物同时含多类媒体' },
  { key: 'other', label: '其他', description: '暂未分类或自定义产物' }
];

export const STANDARD_DATASET_FIELDS: DatasetStandardFieldDefinition[] = [
  { canonicalKey: 'case_id', label: '用例ID', role: 'case_id', type: 'text', required: true, aliases: ['id', 'case_id', 'case id', 'itemid', 'item_id', '用例', '编号'], group: '身份与来源' },
  { canonicalKey: 'purpose', label: '评测目的', role: 'metadata', type: 'text', aliases: ['purpose', '目标', '目的'], group: '身份与来源' },
  { canonicalKey: 'source_dataset', label: '来源数据集', role: 'metadata', type: 'text', aliases: ['source_dataset', 'source', '来源', '数据源'], group: '身份与来源' },
  { canonicalKey: 'eval_form', label: '评测形式', role: 'metadata', type: 'text', aliases: ['评测形式', 'eval_form', 'paradigm', 'template'], group: '身份与来源' },
  { canonicalKey: 'stage', label: '适用阶段', role: 'metadata', type: 'text', aliases: ['stage', '阶段', '适用阶段'], group: '身份与来源' },
  { canonicalKey: 'tags', label: '标签', role: 'metadata', type: 'text', aliases: ['tag', 'tags', '标签'], group: '身份与来源' },
  { canonicalKey: 'full_prompt', label: '完整Prompt', role: 'input', type: 'text', required: true, aliases: ['prompt', 'full prompt', 'video prompt', '完整prompt', '提示词', '输入'], group: '输入与上下文' },
  { canonicalKey: 'zh_prompt', label: '中文Prompt', role: 'input', type: 'text', aliases: ['中文prompt', '中文提示词', 'zh_prompt'], group: '输入与上下文' },
  { canonicalKey: 'reference_image_urls', label: '参考图_URLs', role: 'reference', type: 'image_url', previewType: 'image', aliases: ['参考图', 'reference', 'reference image', 'ref_image', '参考图_urls'], group: '输入与上下文' },
  { canonicalKey: 'reference_image_note', label: '参考图_说明', role: 'reference', type: 'text', aliases: ['参考图说明', 'ref_note', 'reference note'], group: '输入与上下文' },
  { canonicalKey: 'audio_url', label: '音频_URL', role: 'reference', type: 'audio_url', previewType: 'audio', aliases: ['audio', 'audio_url', '音乐', '音频'], group: '输入与上下文' },
  { canonicalKey: 'lyrics_or_dialogue', label: '歌词或对白', role: 'input', type: 'text', aliases: ['lyrics', 'dialogue', '歌词', '对白'], group: '输入与上下文' },
  { canonicalKey: 'beat_segment_map', label: 'Beat或段落映射', role: 'metadata', type: 'text', aliases: ['beat', 'segment', '段落', 'beat_or_segment_map'], group: '输入与上下文' },
  { canonicalKey: 'start_image_url', label: '首帧图_URL', role: 'reference', type: 'image_url', previewType: 'image', aliases: ['start image', 'first frame', '首帧', '首帧图'], group: '输入与上下文' },
  { canonicalKey: 'end_image_url', label: '尾帧图_URL', role: 'reference', type: 'image_url', previewType: 'image', aliases: ['end image', 'last frame', '尾帧', '尾帧图'], group: '输入与上下文' },
  { canonicalKey: 'eval_dimension', label: '评测维度', role: 'dimension', type: 'text', aliases: ['dimension', 'category', 'scenario', 'ability', 'difficulty', '评测维度', '维度', '类别', '场景', '能力', '难度'], group: '评测设计' },
  { canonicalKey: 'observation_focus', label: '观察重点', role: 'rubric', type: 'text', aliases: ['观察重点', 'focus', 'observe'], group: '评测设计' },
  { canonicalKey: 'test_variable', label: '测试变量', role: 'metadata', type: 'text', aliases: ['test_variable', '测试变量'], group: '评测设计' },
  { canonicalKey: 'control_variable', label: '控制变量', role: 'metadata', type: 'text', aliases: ['control_variable', '控制变量'], group: '评测设计' },
  { canonicalKey: 'constraints', label: '约束条件', role: 'rubric', type: 'text', aliases: ['constraint', 'constraints', '约束'], group: '评测设计' },
  { canonicalKey: 'rubric', label: '评分标准', role: 'rubric', type: 'text', aliases: ['rubric', '评分标准', '打分标准'], group: '评测设计' },
  { canonicalKey: 'evidence_plan', label: '证据计划', role: 'rubric', type: 'text', aliases: ['evidence', 'evidence_plan', '证据'], group: '评测设计' },
  { canonicalKey: 'cannot_judge_rules', label: '不可判断规则', role: 'rubric', type: 'text', aliases: ['cannot_judge', '无法判断', '不可判断'], group: '评测设计' },
  { canonicalKey: 'expected_failure_modes', label: '预期失败模式', role: 'rubric', type: 'text', aliases: ['failure', 'failure mode', '失败模式'], group: '评测设计' },
  { canonicalKey: 'pending_questions', label: '待确认项', role: 'metadata', type: 'text', aliases: ['待确认', 'todo', 'pending'], group: '评测设计' },
  { canonicalKey: 'design_rationale', label: '设计理由', role: 'metadata', type: 'text', aliases: ['rationale', 'reason', '设计理由'], group: '评测设计' },
  { canonicalKey: 'aspect_ratio', label: '宽高比', role: 'metadata', type: 'text', aliases: ['aspect_ratio', 'ratio', '宽高比'], group: '媒体属性' },
  { canonicalKey: 'resolution', label: '分辨率', role: 'metadata', type: 'text', aliases: ['resolution', '分辨率'], group: '媒体属性' },
  { canonicalKey: 'duration', label: '时长', role: 'metadata', type: 'text', aliases: ['duration', '时长'], group: '媒体属性' },
  { canonicalKey: 'generation_method', label: '生成方式', role: 'metadata', type: 'text', aliases: ['generation', 'method', 'route', '生成方式'], group: '媒体属性' }
];

export const STANDARD_FIELD_BY_CANONICAL = Object.fromEntries(
  STANDARD_DATASET_FIELDS.map(field => [field.canonicalKey, field])
) as Record<string, DatasetStandardFieldDefinition>;

const normalizeKey = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-_:/\\()（）[\]【】]/g, '');

const cleanValue = (value: any) => String(value ?? '').trim();

const splitList = (value: string | string[] | undefined) =>
  Array.isArray(value)
    ? value.map(cleanValue).filter(Boolean)
    : cleanValue(value).split(/[,，;；|]/).map(item => item.trim()).filter(Boolean);

export const getStandardFieldForColumn = (column: string) => {
  const normalized = normalizeKey(column);
  const exactMatch = STANDARD_DATASET_FIELDS.find(field => {
    const candidates = [field.label, field.canonicalKey, ...(field.aliases || [])].map(normalizeKey);
    return candidates.some(candidate => normalized === candidate);
  });
  if (exactMatch) return exactMatch;
  return STANDARD_DATASET_FIELDS.find(field => {
    const candidates = [field.label, field.canonicalKey, ...(field.aliases || [])].map(normalizeKey);
    return candidates.some(candidate => candidate.length >= 4 && (normalized.includes(candidate) || candidate.includes(normalized)));
  });
};
export const getExactStandardFieldForColumn = (column: string) => {
  const normalized = normalizeKey(column);
  return STANDARD_DATASET_FIELDS.find(field => {
    const candidates = [field.label, field.canonicalKey, ...(field.aliases || [])].map(normalizeKey);
    return candidates.some(candidate => normalized === candidate);
  });
};


export const inferPreviewType = (column: string, sampleValues: any[] = []): DatasetPreviewType => {
  const normalized = normalizeKey(column);
  const joined = sampleValues.map(cleanValue).find(Boolean) || column;
  if (AUDIO_PATTERN.test(joined) || normalized.includes('audio') || normalized.includes('音频') || normalized.includes('音乐')) return 'audio';
  if (VIDEO_PATTERN.test(joined) || normalized.includes('video') || normalized.includes('视频')) return 'video';
  if (IMAGE_PATTERN.test(joined) || normalized.includes('image') || normalized.includes('图片') || normalized.includes('图')) return 'image';
  if (URL_PATTERN.test(joined) || normalized.includes('url') || normalized.includes('链接')) return 'link';
  return 'text';
};

export const inferSchemaType = (previewType: DatasetPreviewType): SchemaFieldType => {
  if (previewType === 'image') return 'image_url';
  if (previewType === 'video') return 'video_url';
  if (previewType === 'audio') return 'audio_url';
  if (previewType === 'link') return 'url';
  return 'text';
};

export const inferFieldRole = (column: string, sampleValues: any[] = []): DatasetFieldRole => {
  const standard = getStandardFieldForColumn(column);
  if (standard) return standard.role;
  const normalized = normalizeKey(column);
  if (normalized.includes('model') || normalized.includes('模型') || normalized.includes('provider') || normalized.includes('slot') || normalized.includes('out') || normalized.includes('结果')) return 'output';
  if (normalized.includes('dimension') || normalized.includes('维度') || normalized.includes('category') || normalized.includes('类别') || normalized.includes('scenario') || normalized.includes('场景') || normalized.includes('difficulty') || normalized.includes('难度')) return 'dimension';
  if (normalized.includes('ref') || normalized.includes('参考') || normalized.includes('start') || normalized.includes('first') || normalized.includes('首帧') || normalized.includes('audio') || normalized.includes('音频')) return 'reference';
  const previewType = inferPreviewType(column, sampleValues);
  if (previewType === 'image' || previewType === 'video' || previewType === 'audio') return 'media';
  return 'input';
};

const CORE_IMPORT_STANDARD_KEYS = new Set([
  'case_id',
  'full_prompt',
  'zh_prompt',
  'reference_image_urls',
  'audio_url',
  'lyrics_or_dialogue',
  'start_image_url',
  'end_image_url',
]);

const IMPORT_OUTPUT_HINTS = [
  'model',
  'output',
  'result',
  'prediction',
  'candidate',
  'provider',
  'slot',
  '\u6a21\u578b',
  '\u8f93\u51fa',
  '\u7ed3\u679c',
];

const IMPORT_INPUT_HINTS = [
  'prompt',
  'instruction',
  'question',
  'query',
  '\u63d0\u793a\u8bcd',
];

const IMPORT_REFERENCE_HINTS = [
  'reference',
  'refimage',
  'audio',
  'music',
  'firstframe',
  'startimage',
  'lastframe',
  'endimage',
  '\u53c2\u8003',
  '\u97f3\u9891',
  '\u97f3\u4e50',
  '\u9996\u5e27',
  '\u5c3e\u5e27',
];

const hasImportHint = (column: string, hints: string[]) => {
  const normalized = normalizeKey(column);
  return hints.some(hint => normalized.includes(normalizeKey(hint)));
};

export const inferDatasetImportMappings = (
  headers: string[],
  rows: Record<string, any>[] = []
): DatasetColumnMappings => {
  const visibleHeaders = headers.filter(header => header !== '_originalData' && !header.startsWith('__'));
  const mappings: DatasetColumnMappings = {
    inputColumns: [],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
    standard: {},
  };
  const reservedSources = new Set<string>();

  visibleHeaders.forEach(header => {
    const standard = getExactStandardFieldForColumn(header);
    if (!standard || !CORE_IMPORT_STANDARD_KEYS.has(standard.canonicalKey)) return;
    if (mappings.standard[standard.canonicalKey]) return;

    mappings.standard[standard.canonicalKey] = header;
    reservedSources.add(header);
    if (standard.role === 'case_id') mappings.caseId = header;
    if (standard.role === 'input') mappings.inputColumns.push(header);
    if (standard.role === 'reference') mappings.referenceColumns.push(header);
  });

  visibleHeaders.forEach(header => {
    if (reservedSources.has(header)) return;
    const samples = rows.slice(0, 5).map(row => row?.[header]);
    const sampleValue = samples.map(cleanValue).find(Boolean) || '';
    const previewType = inferPreviewType(header, samples);
    const hasOutputHint = hasImportHint(header, IMPORT_OUTPUT_HINTS);
    const hasReferenceHint = hasImportHint(header, IMPORT_REFERENCE_HINTS);
    const isMediaUrl = URL_PATTERN.test(sampleValue)
      && (previewType === 'image' || previewType === 'video' || previewType === 'audio');

    if (hasReferenceHint && !hasOutputHint && isMediaUrl) {
      mappings.referenceColumns.push(header);
      reservedSources.add(header);
      return;
    }

    if (hasImportHint(header, IMPORT_INPUT_HINTS)) {
      mappings.inputColumns.push(header);
      reservedSources.add(header);
      return;
    }

    if (hasOutputHint || isMediaUrl) {
      mappings.outputColumns.push(header);
      reservedSources.add(header);
    }
  });

  return {
    ...mappings,
    inputColumns: Array.from(new Set(mappings.inputColumns)),
    outputColumns: Array.from(new Set(mappings.outputColumns)),
    dimensionColumns: [],
    referenceColumns: Array.from(new Set(mappings.referenceColumns)),
  };
};

export const inferDatasetMappings = (headers: string[], rows: Record<string, any>[] = []): DatasetColumnMappings => {
  const visibleHeaders = headers.filter(header => header !== '_originalData' && !header.startsWith('__'));
  const mappings: DatasetColumnMappings = {
    inputColumns: [],
    outputColumns: [],
    dimensionColumns: [],
    referenceColumns: [],
    standard: {}
  };

  visibleHeaders.forEach(header => {
    const samples = rows.slice(0, 5).map(row => row?.[header]);
    const standard = getStandardFieldForColumn(header);
    const role = inferFieldRole(header, samples);
    if (standard) {
      mappings.standard[standard.canonicalKey] = header;
      if (standard.role === 'case_id') mappings.caseId = header;
    }
    if (role === 'case_id') mappings.caseId = mappings.caseId || header;
    if (role === 'input' || role === 'media') mappings.inputColumns.push(header);
    if (role === 'output') mappings.outputColumns.push(header);
    if (role === 'dimension') mappings.dimensionColumns.push(header);
    if (role === 'reference') mappings.referenceColumns.push(header);
  });

  if (!mappings.inputColumns.length) {
    const prompt = visibleHeaders.find(header => getStandardFieldForColumn(header)?.canonicalKey === 'full_prompt') || visibleHeaders.find(header => !mappings.outputColumns.includes(header) && header !== mappings.caseId);
    if (prompt) mappings.inputColumns = [prompt];
  }

  return {
    ...mappings,
    inputColumns: Array.from(new Set(mappings.inputColumns.filter(Boolean))),
    outputColumns: Array.from(new Set(mappings.outputColumns.filter(Boolean))),
    dimensionColumns: Array.from(new Set(mappings.dimensionColumns.filter(Boolean))),
    referenceColumns: Array.from(new Set(mappings.referenceColumns.filter(Boolean)))
  };
};

export const getDatasetColumnMappings = (dataset?: EvalDataset, headers?: string[]): DatasetColumnMappings => {
  const inferredHeaders = headers && headers.length
    ? headers
    : getDatasetActiveColumnKeys(dataset);
  const inferred = inferDatasetMappings(inferredHeaders, dataset?.items || []);
  return {
    ...inferred,
    ...(dataset?.columnMappings || {}),
    inputColumns: dataset?.columnMappings?.inputColumns?.length ? dataset.columnMappings.inputColumns : inferred.inputColumns,
    outputColumns: dataset?.columnMappings?.outputColumns?.length ? dataset.columnMappings.outputColumns : inferred.outputColumns,
    dimensionColumns: dataset?.columnMappings?.dimensionColumns?.length ? dataset.columnMappings.dimensionColumns : inferred.dimensionColumns,
    referenceColumns: dataset?.columnMappings?.referenceColumns?.length ? dataset.columnMappings.referenceColumns : inferred.referenceColumns,
    standard: { ...inferred.standard, ...(dataset?.columnMappings?.standard || {}) }
  };
};

export const buildDatasetSchema = (
  headers: string[],
  rows: Record<string, any>[],
  mappings: DatasetColumnMappings,
  overrides: DatasetSchemaField[] = []
): DatasetSchemaField[] => {
  const standardSources = new Map(Object.entries(mappings.standard).map(([canonical, source]) => [source, canonical]));
  const overrideByKey = new Map(overrides.map(field => [field.key, field]));
  const allHeaders = Array.from(new Set([
    ...overrides.map(field => field.key),
    ...(headers.length ? headers : STANDARD_DATASET_FIELDS.map(field => field.label))
  ]));
  return allHeaders.filter(key => key !== '_originalData' && !key.startsWith('__')).map(key => {
    const override = overrideByKey.get(key);
    const canonicalKey = standardSources.get(key);
    const standard = canonicalKey ? STANDARD_FIELD_BY_CANONICAL[canonicalKey] : getStandardFieldForColumn(key);
    const sourceKey = override?.sourceKey || key;
    const samples = rows.slice(0, 5).map(row => row?.[sourceKey] ?? row?.[key]);
    const previewType = override?.previewType || standard?.previewType || inferPreviewType(sourceKey, samples);
    const role = override?.role || standard?.role || inferFieldRole(sourceKey, samples);
    return {
      key,
      label: override?.label || standard?.label || key,
      type: override?.type || standard?.type || inferSchemaType(previewType),
      role,
      canonicalKey: override?.canonicalKey || standard?.canonicalKey,
      sourceKey,
      previewType,
      required: override?.required ?? standard?.required
    };
  });
};

export interface NormalizeDatasetRowsOptions {
  activeFieldsOnly?: boolean;
}

export const normalizeDatasetRows = (
  rows: Record<string, any>[],
  mappings: DatasetColumnMappings,
  schemaFields: DatasetSchemaField[] = [],
  options: NormalizeDatasetRowsOptions = {}
) => rows.map((row, index) => {
  const original = Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_originalData' && !key.startsWith('__')));
  const next: Record<string, any> = options.activeFieldsOnly
    ? { _originalData: original }
    : { ...row, _originalData: original };

  if (schemaFields.length) {
    schemaFields.forEach(field => {
      const sourceKey = field.sourceKey || field.key;
      const value = row[sourceKey] ?? row[field.key];
      if (value !== undefined && value !== '') next[field.key] = value;
    });
  } else {
    Object.entries(mappings.standard).forEach(([canonicalKey, sourceKey]) => {
      const field = STANDARD_FIELD_BY_CANONICAL[canonicalKey];
      if (!field || !sourceKey) return;
      const value = row[sourceKey];
      if (value !== undefined && value !== '') next[field.label] = value;
    });
  }

  const caseSource = mappings.caseId || mappings.standard.case_id;
  const caseValue = cleanValue(caseSource ? (next[caseSource] ?? row[caseSource]) : next['用例ID']);
  next['用例ID'] = caseValue || `case-${String(index + 1).padStart(4, '0')}`;

  return next;
});

export const calculateDimensionDistribution = (
  rows: Record<string, any>[],
  dimensionColumns: string[]
): Record<string, Record<string, number>> => {
  const distribution: Record<string, Record<string, number>> = {};
  dimensionColumns.forEach(column => {
    rows.forEach(row => {
      const value = cleanValue(row[column]);
      if (!value) return;
      distribution[column] = distribution[column] || {};
      distribution[column][value] = (distribution[column][value] || 0) + 1;
    });
  });
  return distribution;
};

export const validateDatasetItems = (
  rows: Record<string, any>[],
  mappings: DatasetColumnMappings,
  schemaFields: DatasetSchemaField[] = [],
): DatasetValidationSummary => {
  const warnings: string[] = [];
  const caseKey = mappings.standard.case_id || mappings.caseId || '用例ID';
  const ids = new Set<string>();
  let missingCaseIdCount = 0;
  let duplicateCaseIdCount = 0;
  let invalidUrlCount = 0;
  let missingInputCount = 0;
  let emptyOutputCells = 0;
  const schemaUrlColumns = schemaFields
    .filter(field => (
      field.type === 'url'
      || field.type === 'image_url'
      || field.type === 'video_url'
      || field.type === 'audio_url'
      || ['image', 'video', 'audio', 'link'].includes(field.previewType || '')
    ))
    .map(field => field.key);
  const urlColumns = Array.from(new Set([
    ...mappings.outputColumns,
    ...mappings.referenceColumns,
    ...schemaUrlColumns,
  ]));

  rows.forEach(row => {
    const id = cleanValue(row[caseKey] || row['用例ID']);
    if (!id) missingCaseIdCount += 1;
    if (id && ids.has(id)) duplicateCaseIdCount += 1;
    if (id) ids.add(id);

    if (mappings.inputColumns.length && mappings.inputColumns.every(column => !cleanValue(row[column]))) {
      missingInputCount += 1;
    }

    mappings.outputColumns.forEach(column => {
      if (!cleanValue(row[column])) emptyOutputCells += 1;
    });

    urlColumns.forEach(column => {
      const value = cleanValue(row[column]);
      const schemaDeclaresUrl = schemaUrlColumns.includes(column);
      if (value && (schemaDeclaresUrl || inferPreviewType(column, [value]) !== 'text') && !URL_PATTERN.test(value)) invalidUrlCount += 1;
    });
  });

  if (missingCaseIdCount) warnings.push(`${missingCaseIdCount} 行缺少用例ID，已自动补齐。`);
  if (duplicateCaseIdCount) warnings.push(`${duplicateCaseIdCount} 个用例ID重复。`);
  if (invalidUrlCount) warnings.push(`${invalidUrlCount} 个媒体/链接字段格式可能异常。`);
  if (missingInputCount) warnings.push(`${missingInputCount} 行缺少输入内容。`);
  if (emptyOutputCells) warnings.push(`${emptyOutputCells} 个模型结果单元格为空。`);

  const status = duplicateCaseIdCount || missingInputCount ? 'warning' : warnings.length ? 'warning' : 'ok';
  return {
    status,
    missingCaseIdCount,
    duplicateCaseIdCount,
    invalidUrlCount,
    missingInputCount,
    emptyOutputCells,
    dimensionDistribution: calculateDimensionDistribution(rows, mappings.dimensionColumns),
    warnings
  };
};

export const inferDatasetModality = (
  rows: Record<string, any>[],
  mappings: DatasetColumnMappings,
  fallback: DatasetModality = 'other',
  schemaFields: DatasetSchemaField[] = []
): DatasetModality => {
  const sampleRows = rows.slice(0, 5);
  const schemaByKey = new Map(schemaFields.map(field => [field.key, field]));
  const getTypes = (columns: string[]) =>
    new Set(
      columns
        .map(column => {
          const schema = schemaByKey.get(column);
          return schema?.previewType || inferPreviewType(schema?.sourceKey || column, sampleRows.map(row => row[schema?.sourceKey || column] ?? row[column]));
        })
        .filter(type => type !== 'none' && type !== 'link')
    );
  const pickModality = (types: Set<DatasetPreviewType>, mixedAsMultimodal: boolean): DatasetModality | undefined => {
    const presentTypes = ['video', 'image', 'audio', 'text'].filter(type => types.has(type as DatasetPreviewType));
    if (!presentTypes.length) return undefined;
    if (mixedAsMultimodal && presentTypes.length > 1) return 'multimodal';
    if (types.has('video')) return 'video';
    if (types.has('image')) return 'image';
    if (types.has('audio')) return 'audio';
    if (types.has('text')) return 'text';
    return undefined;
  };

  const outputModality = pickModality(getTypes(mappings.outputColumns), true);
  if (outputModality) return outputModality;

  return fallback;
};

export const inferOutputTypeFromDataset = (
  dataset?: EvalDataset,
  preferredOutputColumns: string[] = [],
): 'text' | 'image' | 'video' | 'audio' | 'markdown' => {
  if (!dataset) return 'text';
  const mappings = getDatasetColumnMappings(dataset);
  const activeColumns = new Set(getDatasetActiveColumnKeys(dataset));
  const firstOutput = preferredOutputColumns.find(column => activeColumns.has(column))
    || mappings.outputColumns.find(column => activeColumns.has(column));
  const field = firstOutput ? dataset.inputSchema?.find(schemaField => schemaField.key === firstOutput) : undefined;
  const sourceKey = field?.sourceKey || firstOutput;
  const preview = firstOutput ? field?.previewType || inferPreviewType(sourceKey, dataset.items?.slice(0, 5).map(row => row[sourceKey] ?? row[firstOutput])) : 'text';
  if (preview === 'image') return 'image';
  if (preview === 'video') return 'video';
  if (preview === 'audio') return 'audio';
  return 'text';
};

export const inputTypeFromModality = (modality?: DatasetModality): EvalDataset['inputType'] => {
  if (modality === 'image' || modality === 'multimodal') return 'text_image';
  if (modality === 'audio') return 'text_audio';
  return 'text';
};

export const inferInputTypeFromDataset = (dataset?: EvalDataset): EvalDataset['inputType'] => {
  if (!dataset) return 'text';
  const mappings = getDatasetColumnMappings(dataset);
  const schemaByKey = new Map((dataset.inputSchema || []).map(field => [field.key, field]));
  const columns = [...mappings.inputColumns, ...mappings.referenceColumns];
  const previews = columns.map(column => {
    const field = schemaByKey.get(column);
    return field?.previewType || inferPreviewType(field?.sourceKey || column, dataset.items?.slice(0, 5).map(row => row[field?.sourceKey || column] ?? row[column]));
  });
  const hasImage = previews.includes('image');
  const hasAudio = previews.includes('audio');
  if (hasImage && hasAudio) return 'other';
  if (hasImage) return 'text_image';
  if (hasAudio) return 'text_audio';
  return 'text';
};

export const buildDatasetCard = (
  dataset: Pick<EvalDataset, 'name' | 'tags' | 'items' | 'modality' | 'description'> & Partial<EvalDataset>,
  mappings: DatasetColumnMappings,
  extras: Partial<DatasetCard> = {}
): DatasetCard => {
  const tagDistribution: Record<string, number> = {};
  (dataset.items || []).forEach(row => {
    const tagValue = cleanValue(row['标签'] || row[mappings.standard.tags || '']);
    splitList(tagValue).forEach(tag => {
      tagDistribution[tag] = (tagDistribution[tag] || 0) + 1;
    });
  });
  dataset.tags?.forEach(tag => {
    if (!tagDistribution[tag]) tagDistribution[tag] = 0;
  });

  return {
    applicableTasks: extras.applicableTasks || dataset.datasetCard?.applicableTasks || [],
    applicableStages: extras.applicableStages || dataset.datasetCard?.applicableStages || [],
    source: extras.source ?? dataset.datasetCard?.source ?? '',
    sampleSize: dataset.items?.length || 0,
    modality: extras.modality || dataset.modality || 'other',
    tagDistribution,
    dimensionDistribution: calculateDimensionDistribution(dataset.items || [], mappings.dimensionColumns),
    rubricBinding: extras.rubricBinding ?? dataset.datasetCard?.rubricBinding ?? '',
    coverageGaps: extras.coverageGaps || dataset.datasetCard?.coverageGaps || [],
    latestChange: extras.latestChange || dataset.datasetCard?.latestChange || '初始化评测集',
    updatedAt: Date.now()
  };
};

export const appendDatasetVersion = (
  dataset: Partial<EvalDataset>,
  changedBy: string,
  changeSummary: string,
  itemCountBefore: number,
  itemCountAfter: number
): { version: number; versionHistory: DatasetVersionEntry[] } => {
  const nextVersion = (dataset.version || 0) + 1;
  const entry: DatasetVersionEntry = {
    version: nextVersion,
    changedAt: Date.now(),
    changedBy,
    changeSummary,
    itemCountBefore,
    itemCountAfter
  };
  return {
    version: nextVersion,
    versionHistory: [...(dataset.versionHistory || []), entry]
  };
};

export const normalizeDatasetForDisplay = (dataset: EvalDataset): EvalDataset => {
  const mappings = getDatasetColumnMappings(dataset);
  const modality = dataset.modality || inferDatasetModality(dataset.items || [], mappings, 'other', dataset.inputSchema || []);
  return {
    ...dataset,
    tags: dataset.tags || [],
    items: dataset.items || [],
    inputSchema: dataset.inputSchema?.length ? dataset.inputSchema : buildDatasetSchema(getDatasetActiveColumnKeys(dataset), dataset.items || [], mappings),
    modality,
    categoryPath: dataset.categoryPath || ['未分类'],
    standardFields: dataset.standardFields || STANDARD_DATASET_FIELDS,
    columnMappings: mappings,
    validationSummary: dataset.validationSummary || validateDatasetItems(dataset.items || [], mappings, dataset.inputSchema || []),
    datasetCard: dataset.datasetCard || buildDatasetCard({ ...dataset, modality }, mappings),
    version: dataset.version || 1,
    versionHistory: dataset.versionHistory || []
  };
};

export const getDatasetDisplayValue = (row: Record<string, any>, keys: string[]) => {
  const key = keys.find(candidate => cleanValue(row[candidate]));
  return key ? cleanValue(row[key]) : '';
};
