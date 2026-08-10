import type {
  DatasetColumnMappings,
  EvalDataset,
  GenerationParameterBinding,
  GenerationPreflightIssue,
} from '../../src/types.ts';
import { DATASET_ITEM_ID_KEY } from '../../src/datasetSync.ts';
import {
  defaultGenerationInputMapping,
  defaultVidMuseEvaluationParameterColumns,
  generationRowMatchesModality,
  resolveVidMuseEvaluationPresetColumns,
} from '../../src/features/generation/inputMapping.ts';
import {
  buildAionGenerationRequest,
  generationRequestProjectionDiff,
  preflightGenerationCase,
  type GenerationProjectionDiff,
  type NormalizedGenerationModel,
} from './generationPlanning.ts';
import {
  buildGenerationCasesForPreflight,
  type GenerationPreflightRequest,
} from './generationPreflightService.ts';
import {
  generationValidationForModel,
  type GenerationModelValidationOverrides,
} from './generationValidationPolicy.ts';

export type DatasetCompatibilityStatus =
  | 'ready_as_authored'
  | 'ready_with_explicit_batch_override'
  | 'dataset_error'
  | 'unsupported_by_model'
  | 'manual_contract_review';

export interface DatasetModelCompatibilityCase {
  caseId: string;
  datasetItemId: string;
  rowIndex: number;
  cellId: string;
  variantLabel: string;
  modality: 'image' | 'video';
  modelName: string;
  configFingerprint: string;
  status: DatasetCompatibilityStatus;
  generationType: string;
  errors: GenerationPreflightIssue[];
  warnings: GenerationPreflightIssue[];
  mcpToolInput?: Record<string, unknown>;
  finalAionRequest?: Record<string, unknown>;
  projectionDiff: GenerationProjectionDiff[];
  parameterAudit?: Record<string, unknown>;
  suggestedOverrides: Record<string, unknown>;
}

export interface DatasetCompatibilityAuditResult {
  dryRun: true;
  generationPostRequests: 0;
  dataset: {
    id: string;
    name: string;
    version: number;
    totalCases: number;
  };
  configFingerprints: Record<string, string>;
  cases: DatasetModelCompatibilityCase[];
  summary: {
    modelCount: number;
    totalEvaluations: number;
    byStatus: Record<DatasetCompatibilityStatus, number>;
    byModel: Record<string, Record<DatasetCompatibilityStatus, number>>;
    byCell: Record<string, Record<DatasetCompatibilityStatus, number>>;
  };
}

const MANUAL_REVIEW_CODES = new Set([
  'CONTRACT_REVIEW_REQUIRED',
  'GENERATION_TYPE_REVIEW_REQUIRED',
  'AUDIO_ONLY_MODE_REVIEW_REQUIRED',
  'PLUGIN_MIXED_INPUT_REVIEW',
]);

const EXPLICIT_OVERRIDE_CODES = new Set([
  'UNSUPPORTED_CONTROL_VALUE',
  'UNSUPPORTED_PRESET_PARAMETER',
]);

const DATASET_ERROR_CODES = new Set([
  'MEDIA_TYPE_MISMATCH',
  'NON_PUBLIC_ASSET_URL',
  'MISSING_ASSET',
  'MCP_AION_PROJECTION_MISMATCH',
  'REQUEST_BUILD_FAILED',
]);

const isDatasetErrorCode = (code: string) =>
  DATASET_ERROR_CODES.has(code)
  || /^(?:INVALID|MALFORMED|MISSING_START|MCP_)/.test(code)
  || /(?:PARSE|STRUCTURE|COUNT|RANGE)_ERROR$/.test(code);

export const classifyDatasetCompatibility = (
  errors: GenerationPreflightIssue[],
): DatasetCompatibilityStatus => {
  if (!errors.length) return 'ready_as_authored';
  if (errors.some(issue => isDatasetErrorCode(issue.code))) return 'dataset_error';
  if (errors.some(issue => MANUAL_REVIEW_CODES.has(issue.code))) return 'manual_contract_review';
  if (errors.every(issue => EXPLICIT_OVERRIDE_CODES.has(issue.code))) {
    return 'ready_with_explicit_batch_override';
  }
  return 'unsupported_by_model';
};

const defaultParameterBindings = (
  dataset: EvalDataset,
  headers: string[],
  model: NormalizedGenerationModel,
): Record<string, GenerationParameterBinding> => ({
  ...Object.fromEntries([
    ...model.controls
      .filter(control => control.key !== 'duration' && control.key !== 'seed')
      .map(control => [control.key, { source: 'unused' as const }]),
    ...(model.advancedParameters || [])
      .map(parameter => [parameter.key, { source: 'unused' as const }]),
  ]),
  ...defaultVidMuseEvaluationParameterColumns(
    headers,
    model.controls.map(control => control.key),
    dataset.inputSchema || [],
  ),
});

const datasetMappingsForAudit = (
  dataset: EvalDataset,
  headers: string[],
): DatasetColumnMappings => {
  const configured = dataset.columnMappings;
  return {
    caseId: configured?.caseId || (headers.includes('case_id') ? 'case_id' : ''),
    inputColumns: configured?.inputColumns?.length
      ? configured.inputColumns
      : headers.includes('prompt') ? ['prompt'] : [],
    outputColumns: configured?.outputColumns || [],
    dimensionColumns: configured?.dimensionColumns || [],
    referenceColumns: configured?.referenceColumns || [],
    standard: {
      ...(headers.includes('case_id') ? { case_id: 'case_id' } : {}),
      ...(headers.includes('prompt') ? { full_prompt: 'prompt' } : {}),
      ...(headers.includes('duration') ? { duration: 'duration' } : {}),
      ...(headers.includes('aspect_ratio') ? { aspect_ratio: 'aspect_ratio' } : {}),
      ...(headers.includes('resolution') ? { resolution: 'resolution' } : {}),
      ...(configured?.standard || {}),
    },
  };
};

const suggestedOverridesFor = (
  model: NormalizedGenerationModel,
  errors: GenerationPreflightIssue[],
) => {
  const suggestions: Record<string, unknown> = {};
  errors.forEach(issue => {
    const field = issue.field || '';
    if (issue.code === 'UNSUPPORTED_PRESET_PARAMETER' && field) {
      suggestions[field] = { source: 'unused' };
      return;
    }
    if (issue.code !== 'UNSUPPORTED_CONTROL_VALUE') return;
    if (field === 'duration' && model.supportedDurations.length) {
      suggestions.duration = { source: 'uniform', allowedValues: model.supportedDurations };
    } else if (field === 'aspect_ratio' && model.supportedAspectRatios.length) {
      suggestions.aspect_ratio = { source: 'uniform', allowedValues: model.supportedAspectRatios };
    } else if (field === 'resolution' && model.supportedResolutions.length) {
      suggestions.resolution = { source: 'uniform', allowedValues: model.supportedResolutions };
    } else if (field) {
      const control = model.controls.find(candidate => candidate.key === field);
      suggestions[field] = {
        source: 'uniform',
        ...(control?.options?.length ? { allowedValues: control.options } : {}),
        ...(control?.defaultValue !== undefined ? { defaultValue: control.defaultValue } : {}),
      };
    }
  });
  return suggestions;
};

const auditModel = (
  dataset: EvalDataset,
  model: NormalizedGenerationModel,
  validationOverrides: GenerationModelValidationOverrides,
): DatasetModelCompatibilityCase[] => {
  const headers = (dataset.inputSchema || []).map(field => field.key);
  const mapping = defaultGenerationInputMapping(
    dataset,
    headers,
    datasetMappingsForAudit(dataset, headers),
    model.outputModality,
  );
  const presetColumns = resolveVidMuseEvaluationPresetColumns(headers, dataset.inputSchema || []);
  const durationColumn = model.controls.some(control => control.key === 'duration')
    ? presetColumns.duration
    : undefined;
  const selectedRows = (dataset.items || []).flatMap((row, rowIndex) => {
    if (!generationRowMatchesModality(row, model.outputModality)) return [];
    const datasetItemId = String(row[DATASET_ITEM_ID_KEY] || '').trim();
    if (!datasetItemId) throw new Error(`Dataset row ${rowIndex + 1} has no stable item ID.`);
    return [{ row, rowIndex, datasetItemId }];
  });
  const request: GenerationPreflightRequest = {
    datasetId: dataset.id,
    datasetVersion: dataset.version || 1,
    datasetName: dataset.name,
    modelName: model.modelName,
    targetColumn: `dry_run_${model.outputModality}`,
    targetMode: 'new',
    inputMapping: mapping,
    defaultControls: {},
    perCaseControlColumns: {},
    parameterBindings: defaultParameterBindings(dataset, headers, model),
    ...(durationColumn ? { durationSource: { mode: 'column' as const, column: durationColumn } } : {}),
    seedMode: 'unused',
    seedPolicyVersion: 2,
  };
  const prepared = buildGenerationCasesForPreflight(dataset as any, request, model, selectedRows);
  return prepared.map(item => {
    const validation = preflightGenerationCase(
      model,
      item.resolvedCase,
      generationValidationForModel(model, validationOverrides),
    );
    const errors = [...item.preparationIssues, ...validation.errors];
    const warnings = [...item.preparationWarnings, ...validation.warnings];
    let finalAionRequest: Record<string, unknown> | undefined;
    let projectionDiff: GenerationProjectionDiff[] = [];
    try {
      finalAionRequest = buildAionGenerationRequest(model, validation.resolvedCase).body;
      const mcpToolInput = validation.resolvedCase.compilerAudit?.mcpToolInput;
      projectionDiff = mcpToolInput
        ? generationRequestProjectionDiff(model, mcpToolInput, finalAionRequest)
        : [];
      if (projectionDiff.length) {
        errors.push({
          code: 'MCP_AION_PROJECTION_MISMATCH',
          field: 'request',
          message: 'The final Aion request does not preserve the normalized MCP public fields and ordering.',
        });
      }
    } catch (error) {
      errors.push({
        code: 'REQUEST_BUILD_FAILED',
        field: 'request',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const row = dataset.items[item.resolvedCase.rowIndex] || {};
    return {
      caseId: item.resolvedCase.caseId,
      datasetItemId: item.resolvedCase.datasetItemId,
      rowIndex: item.resolvedCase.rowIndex,
      cellId: String(row.cell_id ?? ''),
      variantLabel: String(row.variant_label ?? ''),
      modality: model.outputModality,
      modelName: model.modelName,
      configFingerprint: model.configFingerprint,
      status: classifyDatasetCompatibility(errors),
      generationType: validation.generationType,
      errors,
      warnings,
      mcpToolInput: validation.resolvedCase.compilerAudit?.mcpToolInput,
      finalAionRequest,
      projectionDiff,
      parameterAudit: validation.resolvedCase.parameterAudit,
      suggestedOverrides: suggestedOverridesFor(model, errors),
    };
  });
};

const emptyStatusCounts = (): Record<DatasetCompatibilityStatus, number> => ({
  ready_as_authored: 0,
  ready_with_explicit_batch_override: 0,
  dataset_error: 0,
  unsupported_by_model: 0,
  manual_contract_review: 0,
});

export const auditDatasetAgainstModels = (
  dataset: EvalDataset,
  models: NormalizedGenerationModel[],
  validationOverrides: GenerationModelValidationOverrides = {},
): DatasetCompatibilityAuditResult => {
  const cases = models.flatMap(model => auditModel(dataset, model, validationOverrides));
  const byStatus = emptyStatusCounts();
  const byModel: Record<string, Record<DatasetCompatibilityStatus, number>> = {};
  const byCell: Record<string, Record<DatasetCompatibilityStatus, number>> = {};
  cases.forEach(item => {
    byStatus[item.status] += 1;
    byModel[item.modelName] ||= emptyStatusCounts();
    byModel[item.modelName][item.status] += 1;
    const cell = item.cellId || '(empty)';
    byCell[cell] ||= emptyStatusCounts();
    byCell[cell][item.status] += 1;
  });
  return {
    dryRun: true,
    generationPostRequests: 0,
    dataset: {
      id: dataset.id,
      name: dataset.name,
      version: dataset.version || 1,
      totalCases: dataset.items.length,
    },
    configFingerprints: Object.fromEntries(models.map(model => [model.modelName, model.configFingerprint])),
    cases,
    summary: {
      modelCount: models.length,
      totalEvaluations: cases.length,
      byStatus,
      byModel,
      byCell,
    },
  };
};
