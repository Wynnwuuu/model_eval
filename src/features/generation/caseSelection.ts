import { DATASET_ITEM_ID_KEY } from '../../datasetSync.ts';
import type {
  DatasetModality,
  DatasetPreviewType,
  EvalDataset,
  GenerationPreflightIssue,
  GenerationTargetMode,
} from '../../types.ts';

export interface GenerationSelectionRow {
  row: Record<string, any>;
  rowIndex: number;
  datasetItemId: string;
}

export interface GenerationCaseSelectionResult {
  rows: GenerationSelectionRow[];
  normalizedIds: string[];
  errors: GenerationPreflightIssue[];
}

export interface GenerationTargetInspection {
  exists: boolean;
  isOutputColumn: boolean;
  completedCount: number;
  emptyCount: number;
  unknownModelAuditCount: number;
  priorModelNames: string[];
  priorConfigFingerprints: string[];
  errors: GenerationPreflightIssue[];
  warnings: GenerationPreflightIssue[];
}

interface GenerationTargetOptions {
  mode: GenerationTargetMode;
  targetColumn: string;
  modelName?: string;
  modelDisplayName?: string;
  modelProvider?: string;
  outputModality: DatasetModality;
  configFingerprint?: string;
}

const text = (value: unknown) => String(value ?? '').trim();

const normalizedModelLabel = (value: unknown) => text(value).toLocaleLowerCase();

const MODEL_VARIANT_SUFFIXES = [
  '/text-to-image',
  '/image-to-image',
  '/image-to-video',
  '/text-to-video',
  '/reference-to-video',
  '/frame-to-video',
  '/frame_to_video',
  '/edit',
  '/transition',
] as const;

/**
 * Generation columns represent a model family in evaluation workflows, while
 * modelName identifies the concrete invocation route. Keep the normalisation
 * deliberately conservative so unrelated models from the same provider do not
 * become compatible by accident.
 */
export const generationModelFamilyKey = (modelName: unknown) => {
  const normalized = normalizedModelLabel(modelName);
  return MODEL_VARIANT_SUFFIXES.reduce((family, suffix) => (
    family.endsWith(suffix) ? family.slice(0, -suffix.length) : family
  ), normalized);
};

const auditMatchesModelFamily = (
  audit: Record<string, any>,
  options: GenerationTargetOptions,
) => {
  const auditModelName = text(audit.modelName);
  if (!auditModelName || !options.modelName) return false;
  if (auditModelName === options.modelName) return true;

  const auditDisplayName = normalizedModelLabel(audit.displayName);
  const selectedDisplayName = normalizedModelLabel(options.modelDisplayName);
  const auditProvider = normalizedModelLabel(audit.provider);
  const selectedProvider = normalizedModelLabel(options.modelProvider);
  const normalizedFamilyMatches = generationModelFamilyKey(auditModelName)
    === generationModelFamilyKey(options.modelName);
  if (auditDisplayName && selectedDisplayName && auditDisplayName === selectedDisplayName
    && ((auditProvider && selectedProvider && auditProvider === selectedProvider)
      || normalizedFamilyMatches)) {
    return true;
  }

  return normalizedFamilyMatches;
};

const duplicateValues = (values: string[]) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates);
};

export const resolveGenerationCaseSelection = (
  rows: Record<string, any>[],
  selectedDatasetItemIds?: string[],
): GenerationCaseSelectionResult => {
  const indexedRows = rows.map((row, rowIndex) => ({
    row,
    rowIndex,
    datasetItemId: text(row[DATASET_ITEM_ID_KEY]),
  }));
  if (selectedDatasetItemIds === undefined) {
    return {
      rows: indexedRows,
      normalizedIds: indexedRows.map(item => item.datasetItemId).filter(Boolean),
      errors: [],
    };
  }

  const requestedIds = selectedDatasetItemIds.map(text).filter(Boolean);
  const errors: GenerationPreflightIssue[] = [];
  if (!requestedIds.length) {
    errors.push({ code: 'EMPTY_SELECTION', message: 'Select at least one dataset case.' });
    return { rows: [], normalizedIds: [], errors };
  }

  const duplicateRequestedIds = duplicateValues(requestedIds);
  if (duplicateRequestedIds.length) {
    errors.push({
      code: 'DUPLICATE_SELECTED_ITEM_ID',
      field: DATASET_ITEM_ID_KEY,
      message: `The case selection contains duplicate stable IDs: ${duplicateRequestedIds.join(', ')}`,
    });
  }

  const requestedSet = new Set(requestedIds);
  const datasetIds = indexedRows.map(item => item.datasetItemId).filter(Boolean);
  const duplicateDatasetIds = duplicateValues(datasetIds).filter(id => requestedSet.has(id));
  if (duplicateDatasetIds.length) {
    errors.push({
      code: 'DUPLICATE_DATASET_ITEM_ID',
      field: DATASET_ITEM_ID_KEY,
      message: `The dataset contains duplicate stable IDs: ${duplicateDatasetIds.join(', ')}`,
    });
  }

  const datasetIdSet = new Set(datasetIds);
  const unknownIds = Array.from(requestedSet).filter(id => !datasetIdSet.has(id));
  if (unknownIds.length) {
    errors.push({
      code: 'UNKNOWN_SELECTED_ITEM_ID',
      field: DATASET_ITEM_ID_KEY,
      message: `The selected cases are not present in this dataset version: ${unknownIds.join(', ')}`,
    });
  }

  const selectedRows = indexedRows.filter(item => item.datasetItemId && requestedSet.has(item.datasetItemId));
  return {
    rows: selectedRows,
    normalizedIds: selectedRows.map(item => item.datasetItemId),
    errors,
  };
};

const parseAuditMetadata = (value: unknown): Record<string, any> | undefined => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : undefined;
  } catch {
    return undefined;
  }
};

const previewTypeForField = (dataset: EvalDataset, targetColumn: string): DatasetPreviewType | undefined => {
  const field = dataset.inputSchema?.find(item => item.key === targetColumn || item.sourceKey === targetColumn);
  if (field?.previewType && field.previewType !== 'none') return field.previewType;
  if (field?.type === 'image_url') return 'image';
  if (field?.type === 'video_url') return 'video';
  if (field?.type === 'audio_url') return 'audio';
  if (field?.type === 'text' || field?.type === 'chat_history') return 'text';
  if (field?.type === 'url') return 'link';
  return undefined;
};

export const getGenerationOutputColumns = (dataset: EvalDataset): string[] => {
  const mapped = dataset.columnMappings?.outputColumns || [];
  const schemaOutputs = (dataset.inputSchema || [])
    .filter(field => field.role === 'output')
    .map(field => field.key);
  return Array.from(new Set([...mapped, ...schemaOutputs].map(text).filter(Boolean)));
};

export const inspectGenerationTargetColumn = (
  dataset: EvalDataset,
  options: GenerationTargetOptions,
): GenerationTargetInspection => {
  const targetColumn = text(options.targetColumn);
  const outputColumns = getGenerationOutputColumns(dataset);
  const isOutputColumn = outputColumns.includes(targetColumn);
  const exists = isOutputColumn
    || (dataset.inputSchema || []).some(field => field.key === targetColumn || field.sourceKey === targetColumn)
    || (dataset.items || []).some(row => Object.prototype.hasOwnProperty.call(row, targetColumn));
  const completedCount = (dataset.items || []).filter(row => text(row[targetColumn])).length;
  const emptyCount = Math.max(0, (dataset.items || []).length - completedCount);
  const errors: GenerationPreflightIssue[] = [];
  const warnings: GenerationPreflightIssue[] = [];
  const usesExistingColumn = options.mode === 'fill_existing' || options.mode === 'update_existing';

  if (!targetColumn) {
    errors.push({ code: 'TARGET_COLUMN_REQUIRED', field: 'targetColumn', message: 'A target result column is required.' });
  } else if (options.mode === 'new' && exists) {
    errors.push({
      code: 'TARGET_COLUMN_EXISTS',
      field: targetColumn,
      message: `The target column already exists: ${targetColumn}`,
    });
  } else if (usesExistingColumn && !isOutputColumn) {
    errors.push({
      code: 'TARGET_COLUMN_NOT_OUTPUT',
      field: targetColumn,
      message: `The selected column is not a model output column: ${targetColumn}`,
    });
  }

  const expectedPreview = ['image', 'video', 'audio', 'text'].includes(options.outputModality)
    ? options.outputModality as DatasetPreviewType
    : undefined;
  const actualPreview = previewTypeForField(dataset, targetColumn);
  if (usesExistingColumn && expectedPreview && actualPreview
    && actualPreview !== expectedPreview && actualPreview !== 'link') {
    errors.push({
      code: 'TARGET_MODALITY_MISMATCH',
      field: targetColumn,
      message: `The target column is ${actualPreview}, but the selected model produces ${expectedPreview}.`,
    });
  }

  if (options.mode === 'fill_existing' && isOutputColumn && emptyCount === 0) {
    errors.push({
      code: 'TARGET_COLUMN_COMPLETE',
      field: targetColumn,
      message: `The target column has no empty cases: ${targetColumn}`,
    });
  }

  const populatedRows = (dataset.items || []).filter(row => text(row[targetColumn]));
  const parsedAudits = populatedRows.map(row => parseAuditMetadata(row[`${targetColumn}_params_json`]));
  const audits = parsedAudits.filter((value): value is Record<string, any> => Boolean(value));
  const unknownModelAuditCount = parsedAudits.filter(audit => (
    !text(audit?.modelName) || !text(audit?.configFingerprint)
  )).length;
  const priorModelNames = Array.from(new Set(audits.map(audit => text(audit.modelName)).filter(Boolean)));
  const priorConfigFingerprints = Array.from(new Set(audits.map(audit => text(audit.configFingerprint)).filter(Boolean)));

  if (usesExistingColumn && completedCount > 0) {
    const auditedModelRows = audits.filter(audit => text(audit.modelName));
    const incompatibleModelNames = Array.from(new Set(auditedModelRows
      .filter(audit => !auditMatchesModelFamily(audit, options))
      .map(audit => text(audit.modelName))));
    if (incompatibleModelNames.length && options.modelName) {
      errors.push({
        code: 'TARGET_MODEL_MISMATCH',
        field: targetColumn,
        message: `The target column contains results from a different model family: ${incompatibleModelNames.join(', ')}; selected ${options.modelName}.`,
      });
    }
    if (!incompatibleModelNames.length && options.modelName
      && priorModelNames.some(modelName => modelName !== options.modelName)) {
      warnings.push({
        code: 'TARGET_MODEL_VARIANT_MIXED',
        field: targetColumn,
        message: 'The target column contains another invocation variant of the same model. Per-case model and configuration metadata will be preserved.',
      });
    }
    if (unknownModelAuditCount > 0) {
      warnings.push({
        code: 'TARGET_MODEL_UNKNOWN',
        field: targetColumn,
        message: `${unknownModelAuditCount} existing result${unknownModelAuditCount === 1 ? '' : 's'} do not contain complete generation model/config metadata. Confirm that they belong to the selected model before updating the column.`,
      });
    }

    if (options.configFingerprint && priorConfigFingerprints.length
      && priorConfigFingerprints.some(fingerprint => fingerprint !== options.configFingerprint)) {
      warnings.push({
        code: 'TARGET_CONFIG_CHANGED',
        field: targetColumn,
        message: 'The live model configuration differs from earlier rows. Each case will retain its actual configuration fingerprint.',
      });
    }
  }

  return {
    exists,
    isOutputColumn,
    completedCount,
    emptyCount,
    unknownModelAuditCount,
    priorModelNames,
    priorConfigFingerprints,
    errors,
    warnings,
  };
};
