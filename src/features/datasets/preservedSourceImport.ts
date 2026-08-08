import { ensureStableDatasetItemIds } from '../../datasetSync.ts';
import type {
  DatasetSchemaField,
  DatasetValidationSummary,
  EvalDataset,
} from '../../types.ts';

export const VIDMUSE_STRUCTURED_EVALUATION_COLUMNS = [
  'case_id',
  'cell_id',
  'modality',
  'effects',
  'intent',
  'variant_label',
  'prompt',
  'duration',
  'aspect_ratio',
  'resolution',
  'generate_audio',
  'audio_url',
  'source_thread',
  'source_note',
  'image_urls',
  'elements',
] as const;

export const VIDMUSE_STRUCTURED_AUDIT_COLUMNS = [
  'case_id',
  'variant_label',
  'cell_id',
  'modality',
  'source_record_id',
  'import_status',
  'mcp_contract_status',
  'prompt_status',
  'media_status',
  'severity',
  'issue_categories',
  'evidence',
  'recommended_action',
  'review_status',
  'initial_review_note',
  'model_compatibility_summary',
  'ready_models',
] as const;

export type VidMuseStructuredEvaluationColumn = typeof VIDMUSE_STRUCTURED_EVALUATION_COLUMNS[number];
export const PRESERVED_SOURCE_NORMALIZATION_VERSION = 2 as const;

export interface FeishuBaseSnapshotRecord {
  recordId: string;
  values: unknown[];
}

export interface FeishuBaseSnapshot {
  sourceUrl: string;
  baseToken: string;
  tableId: string;
  viewId: string;
  fetchedAt: string;
  snapshotHash: string;
  fields: string[];
  fieldIds: string[];
  fieldTypes: string[];
  records: FeishuBaseSnapshotRecord[];
}

export interface PreservedEvaluationDatasetOptions {
  id: string;
  name: string;
  description?: string;
  now?: number;
}

export interface PreservedEvaluationVerification {
  ok: boolean;
  errors: string[];
  recordCount: number;
  visibleColumnCount: number;
  transportNormalizations: number;
  duplicateCaseIdRows: number;
  normalizationVersion: typeof PRESERVED_SOURCE_NORMALIZATION_VERSION;
}

export interface PreservedEvaluationImportEnvelope {
  importMode: 'preserve_source_schema_v1';
  dataset: EvalDataset;
  verification: PreservedEvaluationVerification & {
    sourceSnapshotHash?: string;
  };
}

export interface AuditedEvaluationImportEnvelope {
  importMode: 'audited_dataset_v1';
  dataset: EvalDataset;
  verification: {
    ok: true;
    sourceSnapshotHash: string;
    recordCount: number;
    visibleColumnCount: number;
  };
}

export type VerifiedEvaluationImportEnvelope =
  | PreservedEvaluationImportEnvelope
  | AuditedEvaluationImportEnvelope;

type NormalizedSourceRow = {
  row: Record<string, unknown>;
  normalizationCount: number;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableValue(entry)]));
};

const stableJson = (value: unknown) => JSON.stringify(stableValue(value));

export const sameVerifiedEvaluationDatasetContent = (
  left: EvalDataset,
  right: EvalDataset,
) => stableJson(left.inputSchema) === stableJson(right.inputSchema)
  && stableJson(left.items) === stableJson(right.items);

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const visibleKeys = (row: Record<string, unknown>) => Object.keys(row)
  .filter(key => key !== '_originalData' && !key.startsWith('__'));

const markdownParts = (value: string) => {
  if (!value.startsWith('[') || !value.endsWith(')')) return undefined;
  const separator = value.lastIndexOf('](');
  if (separator <= 1) return undefined;
  return {
    label: value.slice(1, separator),
    target: value.slice(separator + 2, -1),
  };
};

export const unwrapFeishuTransportLink = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const parts = markdownParts(trimmed);
  if (!parts) return value;
  if (/^https:\/\//i.test(parts.label) && parts.label === parts.target) return parts.label;
  if (parts.label.startsWith('online-mining/')
    && (parts.target === parts.label || parts.target === `http://${parts.label}`)) {
    return parts.label;
  }
  return value;
};

const normalizeUrlEntry = (value: unknown, count: { value: number }) => {
  const normalized = unwrapFeishuTransportLink(value);
  if (normalized !== value) count.value += 1;
  return normalized;
};

const normalizeElementValue = (value: unknown, count: { value: number }): unknown => {
  if (Array.isArray(value)) return value.map(entry => normalizeElementValue(entry, count));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (key === 'frontal_image_url' || key === 'video_url') {
      return [key, normalizeUrlEntry(entry, count)];
    }
    if (key === 'reference_image_urls' && Array.isArray(entry)) {
      return [key, entry.map(item => normalizeUrlEntry(item, count))];
    }
    return [key, entry];
  }));
};

const normalizeStructuredCell = (
  value: unknown,
  transform: (parsed: unknown, count: { value: number }) => unknown,
  count: { value: number },
) => {
  if (typeof value !== 'string') return transform(value, count);
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.stringify(transform(JSON.parse(trimmed), count));
  } catch {
    return value;
  }
};

const normalizeSourceValue = (
  field: string,
  fieldType: string,
  value: unknown,
  count: { value: number },
) => {
  if (fieldType === 'select' && Array.isArray(value) && value.length <= 1) {
    count.value += 1;
    return value[0] ?? null;
  }
  if (field === 'audio_url') return normalizeUrlEntry(value, count);
  if (field === 'image_urls') {
    return normalizeStructuredCell(value, (parsed, currentCount) =>
      Array.isArray(parsed) ? parsed.map(entry => normalizeUrlEntry(entry, currentCount)) : parsed, count);
  }
  if (field === 'elements') {
    return normalizeStructuredCell(value, normalizeElementValue, count);
  }
  return value;
};

const assertSnapshotShape = (snapshot: FeishuBaseSnapshot) => {
  const expected = [...VIDMUSE_STRUCTURED_EVALUATION_COLUMNS];
  if (stableJson(snapshot.fields) !== stableJson(expected)) {
    throw new Error(`The source view must expose the exact 16-column contract. Received: ${snapshot.fields.join(', ')}`);
  }
  if (snapshot.fieldTypes.length !== snapshot.fields.length
    || snapshot.fieldIds.length !== snapshot.fields.length) {
    throw new Error('The source field IDs and field types must align with the visible fields.');
  }
  snapshot.records.forEach((record, index) => {
    if (!record.recordId) throw new Error(`Source row ${index + 1} has no Feishu record ID.`);
    if (record.values.length !== snapshot.fields.length) {
      throw new Error(`Source record ${record.recordId} has ${record.values.length} values for ${snapshot.fields.length} fields.`);
    }
  });
};

const normalizeSnapshotRecord = (
  snapshot: FeishuBaseSnapshot,
  record: FeishuBaseSnapshotRecord,
  rowIndex: number,
): NormalizedSourceRow => {
  const raw = Object.fromEntries(snapshot.fields.map((field, index) => [field, record.values[index] ?? null]));
  const normalizationCount = { value: 0 };
  const visible = Object.fromEntries(snapshot.fields.map((field, index) => [
    field,
    normalizeSourceValue(field, snapshot.fieldTypes[index], record.values[index] ?? null, normalizationCount),
  ]));
  const rowHash = hashString(stableJson(raw));
  return {
    row: {
      ...visible,
      _originalData: raw,
      __feishuRecordId: record.recordId,
      __sourceRowIndex: rowIndex,
      __sourceRowHash: rowHash,
      __sourceSnapshotHash: snapshot.snapshotHash,
      __sourceNormalizationVersion: PRESERVED_SOURCE_NORMALIZATION_VERSION,
      __sourceUrl: snapshot.sourceUrl,
      __transportNormalizationCount: normalizationCount.value,
    },
    normalizationCount: normalizationCount.value,
  };
};

const fieldSchema = (key: VidMuseStructuredEvaluationColumn): DatasetSchemaField => {
  const base: DatasetSchemaField = {
    key,
    label: key,
    type: 'text',
    role: 'metadata',
    sourceKey: key,
  };
  if (key === 'case_id') return { ...base, role: 'case_id', canonicalKey: 'case_id', required: true };
  if (key === 'prompt') return { ...base, role: 'input', canonicalKey: 'full_prompt', required: true };
  if (key === 'audio_url') return { ...base, role: 'reference', canonicalKey: 'audio_url', type: 'audio_url', previewType: 'audio' };
  if (key === 'image_urls' || key === 'elements') return { ...base, role: 'reference' };
  if (key === 'duration' || key === 'aspect_ratio' || key === 'resolution') {
    return { ...base, canonicalKey: key };
  }
  return base;
};

const validationSummaryForRows = (rows: Record<string, unknown>[]): DatasetValidationSummary => {
  const occurrences = new Map<string, number>();
  let missingCaseIdCount = 0;
  let missingInputCount = 0;
  rows.forEach(row => {
    const caseId = String(row.case_id ?? '').trim();
    const prompt = String(row.prompt ?? '').trim();
    if (!caseId) missingCaseIdCount += 1;
    if (!prompt) missingInputCount += 1;
    if (caseId) occurrences.set(caseId, (occurrences.get(caseId) || 0) + 1);
  });
  const duplicateCaseIdCount = [...occurrences.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const warnings = [
    ...(missingCaseIdCount ? [`${missingCaseIdCount} source rows have no case_id.`] : []),
    ...(missingInputCount ? [`${missingInputCount} source rows have no prompt.`] : []),
    ...(duplicateCaseIdCount
      ? [`${duplicateCaseIdCount} duplicate case_id rows are retained and distinguished by variant_label plus occurrence.`]
      : []),
  ];
  return {
    status: missingCaseIdCount || missingInputCount ? 'error' : warnings.length ? 'warning' : 'ok',
    missingCaseIdCount,
    duplicateCaseIdCount,
    invalidUrlCount: 0,
    missingInputCount,
    emptyOutputCells: 0,
    dimensionDistribution: {},
    warnings,
  };
};

export const buildPreservedEvaluationDataset = (
  snapshot: FeishuBaseSnapshot,
  options: PreservedEvaluationDatasetOptions,
): EvalDataset => {
  assertSnapshotShape(snapshot);
  const now = options.now ?? Date.now();
  const normalized = snapshot.records.map((record, index) => normalizeSnapshotRecord(snapshot, record, index));
  const rows = ensureStableDatasetItemIds(options.id, normalized.map(item => item.row));
  return {
    id: options.id,
    name: options.name,
    description: options.description
      || `Exact source-shape import from ${snapshot.sourceUrl}. Snapshot ${snapshot.snapshotHash}.`,
    tags: ['VidMuse', 'structured-evaluation', 'source-preserved'],
    inputSchema: VIDMUSE_STRUCTURED_EVALUATION_COLUMNS.map(fieldSchema),
    items: rows,
    inputType: 'other',
    modality: 'multimodal',
    categoryPath: ['VidMuse', '模型评测集'],
    columnMappings: {
      caseId: 'case_id',
      inputColumns: ['prompt'],
      outputColumns: [],
      dimensionColumns: [],
      referenceColumns: ['audio_url', 'image_urls', 'elements'],
      standard: {
        case_id: 'case_id',
        full_prompt: 'prompt',
        audio_url: 'audio_url',
        duration: 'duration',
        aspect_ratio: 'aspect_ratio',
        resolution: 'resolution',
      },
    },
    datasetCard: {
      applicableTasks: ['新模型接入评测', 'VidMuse MCP 输入检查'],
      applicableStages: ['接入前', 'dev 验证'],
      source: snapshot.sourceUrl,
      sampleSize: rows.length,
      modality: 'multimodal',
      tagDistribution: {},
      dimensionDistribution: {},
      rubricBinding: '人工评测；本数据集不执行 AI 打分。',
      coverageGaps: [],
      latestChange: `Imported source snapshot ${snapshot.snapshotHash}`,
      updatedAt: now,
    },
    validationSummary: validationSummaryForRows(rows),
    version: 1,
    versionHistory: [{
      version: 1,
      changedAt: now,
      changedBy: 'Feishu Base audited import',
      changeSummary: `Imported ${rows.length} source records without changing visible column names or order.`,
      itemCountBefore: 0,
      itemCountAfter: rows.length,
    }],
    createdAt: now,
    updatedAt: now,
  };
};

export const verifyPreservedEvaluationDataset = (
  snapshot: FeishuBaseSnapshot,
  dataset: EvalDataset,
): PreservedEvaluationVerification => {
  const errors: string[] = [];
  try {
    assertSnapshotShape(snapshot);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const expectedFields = [...VIDMUSE_STRUCTURED_EVALUATION_COLUMNS];
  if (stableJson(dataset.inputSchema.map(field => field.key)) !== stableJson(expectedFields)) {
    errors.push('The imported schema keys do not match the exact source field order.');
  }
  if (stableJson(dataset.inputSchema.map(field => field.label)) !== stableJson(expectedFields)) {
    errors.push('The imported schema labels do not match the exact source field names.');
  }
  if (dataset.items.length !== snapshot.records.length) {
    errors.push(`The imported dataset contains ${dataset.items.length} rows; source contains ${snapshot.records.length}.`);
  }
  let transportNormalizations = 0;
  const occurrenceByCaseId = new Map<string, number>();
  dataset.items.forEach((row, index) => {
    const source = snapshot.records[index];
    if (!source) return;
    const expected = normalizeSnapshotRecord(snapshot, source, index).row;
    const rowFields = visibleKeys(row);
    if (stableJson(rowFields) !== stableJson(expectedFields)) {
      errors.push(`Source record ${source.recordId} does not retain the exact visible field order.`);
    }
    expectedFields.forEach(field => {
      if (stableJson(row[field]) !== stableJson(expected[field])) {
        errors.push(`Source record ${source.recordId} differs in visible field ${field}.`);
      }
    });
    if (row.__feishuRecordId !== source.recordId) {
      errors.push(`Source record ${source.recordId} lost its record ID provenance.`);
    }
    if (row.__sourceRowHash !== expected.__sourceRowHash) {
      errors.push(`Source record ${source.recordId} failed its raw row hash check.`);
    }
    if (row.__sourceSnapshotHash !== snapshot.snapshotHash) {
      errors.push(`Source record ${source.recordId} has the wrong source snapshot hash.`);
    }
    if (stableJson(row._originalData) !== stableJson(expected._originalData)) {
      errors.push(`Source record ${source.recordId} lost its raw API values.`);
    }
    transportNormalizations += Number(row.__transportNormalizationCount || 0);
    const caseId = String(row.case_id ?? '').trim();
    if (caseId) occurrenceByCaseId.set(caseId, (occurrenceByCaseId.get(caseId) || 0) + 1);
  });
  return {
    ok: errors.length === 0,
    errors,
    recordCount: dataset.items.length,
    visibleColumnCount: dataset.inputSchema.length,
    transportNormalizations,
    duplicateCaseIdRows: [...occurrenceByCaseId.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    normalizationVersion: PRESERVED_SOURCE_NORMALIZATION_VERSION,
  };
};

export const parsePreservedEvaluationImportEnvelope = (
  text: string,
): PreservedEvaluationImportEnvelope | undefined => {
  const parsed = JSON.parse(text) as Partial<PreservedEvaluationImportEnvelope>;
  if (parsed.importMode !== 'preserve_source_schema_v1') return undefined;
  if (!parsed.dataset || !parsed.verification) {
    throw new Error('The preserved-source import envelope is incomplete.');
  }
  const expected = [...VIDMUSE_STRUCTURED_EVALUATION_COLUMNS];
  const schemaKeys = parsed.dataset.inputSchema?.map(field => field.key) || [];
  const schemaLabels = parsed.dataset.inputSchema?.map(field => field.label) || [];
  if (stableJson(schemaKeys) !== stableJson(expected)
    || stableJson(schemaLabels) !== stableJson(expected)) {
    throw new Error('The preserved-source import envelope does not contain the exact 16-column schema.');
  }
  if (parsed.dataset.items.length !== parsed.verification.recordCount) {
    throw new Error('The preserved-source record count does not match its verification record.');
  }
  parsed.dataset.items.forEach((row, index) => {
    if (stableJson(visibleKeys(row)) !== stableJson(expected)) {
      throw new Error(`Preserved-source row ${index + 1} does not contain the exact visible field order.`);
    }
    if (!row._originalData || !row.__feishuRecordId || !row.__sourceRowHash || !row.__sourceSnapshotHash
      || row.__sourceNormalizationVersion !== PRESERVED_SOURCE_NORMALIZATION_VERSION) {
      throw new Error(`Preserved-source row ${index + 1} is missing audit provenance.`);
    }
  });
  return parsed as PreservedEvaluationImportEnvelope;
};

export const parseAuditedEvaluationImportEnvelope = (
  text: string,
): AuditedEvaluationImportEnvelope | undefined => {
  const parsed = JSON.parse(text) as Partial<AuditedEvaluationImportEnvelope>;
  if (parsed.importMode !== 'audited_dataset_v1') return undefined;
  if (!parsed.dataset || !parsed.verification) {
    throw new Error('The audited-dataset import envelope is incomplete.');
  }
  if (parsed.verification.ok !== true) {
    throw new Error('The audited-dataset import envelope is not verified.');
  }
  const expected = [...VIDMUSE_STRUCTURED_AUDIT_COLUMNS];
  const schemaKeys = parsed.dataset.inputSchema?.map(field => field.key) || [];
  const schemaLabels = parsed.dataset.inputSchema?.map(field => field.label) || [];
  if (stableJson(schemaKeys) !== stableJson(expected)
    || stableJson(schemaLabels) !== stableJson(expected)) {
    throw new Error('The audited-dataset import envelope does not contain the exact audit schema.');
  }
  if (parsed.verification.visibleColumnCount !== expected.length
    || parsed.dataset.items.length !== parsed.verification.recordCount) {
    throw new Error('The audited-dataset dimensions do not match the verification record.');
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(parsed.verification.sourceSnapshotHash)) {
    throw new Error('The audited-dataset source snapshot hash is invalid.');
  }
  if (!parsed.dataset.id.startsWith('ds-vidmuse-audit-')) {
    throw new Error('The audited-dataset ID is outside the VidMuse audit namespace.');
  }
  parsed.dataset.items.forEach((row, index) => {
    if (stableJson(visibleKeys(row)) !== stableJson(expected)) {
      throw new Error(`Audited-dataset row ${index + 1} does not contain the exact visible field order.`);
    }
    if (!row.source_record_id
      || row.__sourceRecordId !== row.source_record_id
      || row.__sourceSnapshotHash !== parsed.verification?.sourceSnapshotHash) {
      throw new Error(`Audited-dataset row ${index + 1} is missing source provenance.`);
    }
  });
  return parsed as AuditedEvaluationImportEnvelope;
};

export const parseVerifiedEvaluationImportEnvelope = (
  text: string,
): VerifiedEvaluationImportEnvelope | undefined => (
  parsePreservedEvaluationImportEnvelope(text)
  || parseAuditedEvaluationImportEnvelope(text)
);
