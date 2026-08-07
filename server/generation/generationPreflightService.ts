import { randomUUID } from 'node:crypto';

import { getDatasetRowCaseId } from '../../src/datasetSync.ts';
import {
  inspectGenerationTargetColumn,
  resolveGenerationCaseSelection,
  type GenerationSelectionRow,
} from '../../src/features/generation/caseSelection.ts';
import { resolveReferenceAudioDuration } from '../../src/features/generation/audioDuration.ts';
import {
  flattenGenerationReferences,
  parseStructuredGenerationValue,
} from '../../src/features/generation/mediaReferences.ts';
import {
  buildAssistedVidMuseInput,
  compileVidMuseGenerationInput,
} from '../../src/features/generation/vidmuseInputContract.ts';
import type {
  GenerationDurationSource,
  GenerationCaseReview,
  GenerationInputMapping,
  GenerationParameterBinding,
  GenerationParameterValueType,
  GenerationTargetMode,
} from '../../src/types.ts';
import type { RequestUser } from '../auth/context.ts';
import { serverConfig } from '../config.ts';
import { getDatasetVersion } from '../datasets/datasetRepository.ts';
import { ApiError, badRequest, conflict, notFound } from '../http/errors.ts';
import { aionGenerationClient } from './aionGenerationClient.ts';
import {
  buildAionGenerationRequest,
  deriveGenerationSeed,
  estimateGenerationCost,
  fingerprintConfig,
  generationSeedIssue,
  KNOWN_INVALID_GENERATION_PARAMETERS,
  matchUploadedAsset,
  MAX_PORTABLE_GENERATION_SEED,
  preflightGenerationCase,
  stableJson,
  type GenerationCase,
  type NormalizedGenerationModel,
  type PreflightIssue,
  type UploadedAssetCandidate,
} from './generationPlanning.ts';
import {
  compileGenerationContentMappingV2,
  generationContentMappingColumns,
} from './generationContentMapping.ts';

import {
  createGenerationBatchFromPreflight,
  getGenerationPreflight,
  getGenerationAssetsForPreflight,
  isGenerationDatasetInOrganization,
  saveGenerationPreflight,
} from './generationExecutionRepository.ts';
import { generationValidationForModel } from './generationValidationPolicy.ts';

export type GenerationPreflightRequest = {
  datasetId: string;
  datasetVersion: number;
  datasetName?: string;
  modelName: string;
  targetColumn: string;
  targetMode?: GenerationTargetMode;
  inputMapping: Partial<GenerationInputMapping>;
  defaultControls?: Record<string, any>;
  perCaseControlColumns?: Record<string, string>;
  parameterBindings?: Record<string, GenerationParameterBinding>;
  durationSource?: GenerationDurationSource;
  seedMode?: 'fixed' | 'derive_from_case' | 'column';
  fixedSeed?: number;
  seedColumn?: string;
  selectedDatasetItemIds?: string[];
  retryOfJobId?: string;
  retrySourceItemIds?: Record<string, string>;
  retryDuplicateBillingRiskConfirmed?: boolean;
  assetBindings?: UploadedAssetCandidate[];
  caseReviews?: Record<string, GenerationCaseReview>;
};

const text = (value: unknown) => String(value ?? '').trim();

const parseStructured = parseStructuredGenerationValue;
const flattenReferences = flattenGenerationReferences;

const coerceControl = (value: unknown, definition: NormalizedGenerationModel['controls'][number] | undefined) => {
  if (!definition) return value;
  if (definition.type === 'number') return Number(value);
  if (definition.type === 'select'
    && definition.options?.length
    && definition.options.every(option => Number.isFinite(Number(option)))) {
    return Number(value);
  }
  if (definition.type === 'toggle') {
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on', 'enabled'].includes(text(value).toLowerCase());
  }
  if (definition.type === 'json') return parseStructured(value);
  return value;
};

const STRICT_BOOLEAN_BINDINGS = new Map<string, boolean>([
  ['true', true],
  ['1', true],
  ['yes', true],
  ['on', true],
  ['enabled', true],
  ['\u662f', true],
  ['\u5f00', true],
  ['\u542f\u7528', true],
  ['false', false],
  ['0', false],
  ['no', false],
  ['off', false],
  ['disabled', false],
  ['\u5426', false],
  ['\u5173', false],
  ['\u7981\u7528', false],
]);

const parameterValueType = (
  definition: NormalizedGenerationModel['controls'][number] | undefined,
  explicitType?: GenerationParameterValueType,
): GenerationParameterValueType => {
  if (explicitType) return explicitType;
  if (definition?.type === 'toggle') return 'boolean';
  if (definition?.type === 'number') return 'number';
  if (definition?.type === 'json') return 'json';
  if (definition?.type === 'select'
    && definition.options?.length
    && definition.options.every(option => Number.isFinite(Number(option)))) return 'number';
  return 'string';
};

const coerceBoundParameter = (
  value: unknown,
  valueType: GenerationParameterValueType,
): { valid: true; value: unknown } | { valid: false; message: string } => {
  if (valueType === 'boolean') {
    if (typeof value === 'boolean') return { valid: true, value };
    if (typeof value === 'number' && (value === 0 || value === 1)) return { valid: true, value: value === 1 };
    const normalized = text(value).toLowerCase();
    if (STRICT_BOOLEAN_BINDINGS.has(normalized)) {
      return { valid: true, value: STRICT_BOOLEAN_BINDINGS.get(normalized) as boolean };
    }
    return { valid: false, message: 'Expected a supported boolean value such as true/false, 1/0, yes/no, on/off, enabled/disabled, or the documented Chinese equivalents.' };
  }
  if (valueType === 'number') {
    const normalized = typeof value === 'number' ? value : Number(text(value));
    return Number.isFinite(normalized)
      ? { valid: true, value: normalized }
      : { valid: false, message: 'Expected a finite number.' };
  }
  if (valueType === 'json') {
    if (typeof value !== 'string') return { valid: true, value };
    try {
      return { valid: true, value: JSON.parse(value) };
    } catch {
      return { valid: false, message: 'Expected valid JSON.' };
    }
  }
  return { valid: true, value: typeof value === 'string' ? value.trim() : String(value) };
};

const activeParameterBinding = (binding: GenerationParameterBinding | undefined) =>
  Boolean(binding && binding.source !== 'unused');

const datasetHasColumn = (dataset: { items?: Array<Record<string, unknown>> }, column: string) =>
  Boolean(column) && Boolean(dataset.items?.some(row => Object.prototype.hasOwnProperty.call(row, column)));

export const validateGenerationContentMappingConfiguration = (
  request: GenerationPreflightRequest,
  model: NormalizedGenerationModel,
  dataset: { items?: Array<Record<string, unknown>> },
) => {
  if (request.inputMapping?.contentMappingVersion !== 2) return;
  const mapping = request.inputMapping.contentMapping;
  if (!mapping || mapping.version !== 2) {
    throw badRequest('Generation content mapping v2 requires a version 2 mapping snapshot.');
  }
  if (!['text', 'multi_prompt_json', 'typed'].includes(mapping.prompt.format)) {
    throw badRequest('Unknown Prompt format in generation content mapping.');
  }
  if (!['unused', 'columns', 'array_column'].includes(mapping.keyframes.source)) {
    throw badRequest('Unknown keyframe input source.');
  }
  if (mapping.keyframes.source === 'columns' && !mapping.keyframes.firstColumn?.trim()) {
    throw badRequest('Separate keyframe columns require a first-frame column.');
  }
  if (mapping.keyframes.source === 'array_column' && !mapping.keyframes.column?.trim()) {
    throw badRequest('Keyframe array input requires an image_urls column.');
  }
  if (!['unused', 'builder', 'array_column'].includes(mapping.elements.source)) {
    throw badRequest('Unknown reference element source.');
  }
  if (mapping.elements.source === 'array_column' && !mapping.elements.column?.trim()) {
    throw badRequest('Reference element JSON input requires an elements column.');
  }
  if (mapping.elements.source === 'builder') {
    const ids = new Set<string>();
    for (const item of mapping.elements.items) {
      if (!item.id?.trim() || ids.has(item.id)) {
        throw badRequest('Reference element bindings require unique stable IDs.');
      }
      ids.add(item.id);
      if (!['image', 'video', 'element_id'].includes(item.mode)) {
        throw badRequest(`Unknown reference element mode: ${item.mode}.`);
      }
      if (item.mode === 'image'
        && !item.frontalImageColumn?.trim()
        && !(item.referenceImageColumns || []).some(Boolean)
        && !item.referenceImageArrayColumn?.trim()) {
        throw badRequest('An image element requires a frontal or reference-image source.');
      }
      if (item.mode === 'video' && !item.videoColumn?.trim()) {
        throw badRequest('A video element requires a video URL column.');
      }
      if (item.mode === 'element_id' && !item.elementIdColumn?.trim()) {
        throw badRequest('An existing element requires an element ID column.');
      }
    }
  }
  if (!['unused', 'builder', 'array_column'].includes(mapping.audios.source)) {
    throw badRequest('Unknown reference audio source.');
  }
  if (mapping.audios.source === 'array_column' && !mapping.audios.column?.trim()) {
    throw badRequest('Reference audio JSON input requires an audios column.');
  }
  if (mapping.audios.source === 'builder') {
    const ids = new Set<string>();
    for (const item of mapping.audios.items) {
      if (!item.id?.trim() || ids.has(item.id)) {
        throw badRequest('Reference audio bindings require unique stable IDs.');
      }
      ids.add(item.id);
      if (!item.urlColumn?.trim()) throw badRequest('Each reference audio item requires a URL column.');
      if (!['none', 'fixed', 'column', 'columns'].includes(item.rangeSource)) {
        throw badRequest('Unknown reference audio range source.');
      }
      if (item.rangeSource === 'fixed'
        && (!Array.isArray(item.fixedRange) || item.fixedRange.length !== 2)) {
        throw badRequest('A fixed audio range requires start and end values.');
      }
      if (item.rangeSource === 'column' && !item.rangeColumn?.trim()) {
        throw badRequest('Audio range column mode requires a range column.');
      }
      if (item.rangeSource === 'columns'
        && (!item.rangeStartColumn?.trim() || !item.rangeEndColumn?.trim())) {
        throw badRequest('Audio start/end mode requires both columns.');
      }
    }
  }
  if (model.outputModality === 'image'
    && (mapping.elements.source !== 'unused' || mapping.audios.source !== 'unused')) {
    throw badRequest('Image generation does not accept video reference elements or audios.');
  }
  const missingColumns = generationContentMappingColumns(mapping)
    .filter(column => !datasetHasColumn(dataset, column));
  if (missingColumns.length) {
    throw badRequest('One or more content mapping columns do not exist in this dataset version.', {
      columns: missingColumns,
    });
  }
};


export const validateGenerationParameterBindings = (
  request: GenerationPreflightRequest,
  model: NormalizedGenerationModel,
  dataset: { items?: Array<Record<string, unknown>> },
) => {
  const bindings = request.parameterBindings;
  const invalidParameters = new Map(Object.entries(KNOWN_INVALID_GENERATION_PARAMETERS).map(
    ([key, definition]) => [key, { key, ...definition }],
  ));
  const mappedKeys = new Set([
    ...Object.entries(request.inputMapping?.canonicalFieldMappings || {})
      .filter(([, column]) => Boolean(column?.trim()))
      .map(([key]) => key),
    ...Object.entries(request.inputMapping?.extraInputMappings || {})
      .filter(([, column]) => Boolean(column?.trim()))
      .map(([key]) => key),
    ...(request.inputMapping?.extraInputColumns || []).map(String),
    ...Object.entries(request.defaultControls || {})
      .filter(([, value]) => hasMappedValue(value))
      .map(([key]) => key),
    ...Object.entries(request.perCaseControlColumns || {})
      .filter(([, column]) => Boolean(column?.trim()))
      .map(([key]) => key),
    ...Object.entries(bindings || {})
      .filter(([, binding]) => activeParameterBinding(binding))
      .map(([key]) => key),
  ]);
  for (const [key, definition] of invalidParameters) {
    if (!mappedKeys.has(key)) continue;
    throw badRequest(`${definition.message} ${definition.replacement}`, { field: key });
  }

  if (bindings === undefined) return;

  const controlDefinitions = new Map(model.controls.map(control => [control.key, control]));
  const advancedDefinitions = new Map((model.advancedParameters || []).map(parameter => [parameter.key, parameter]));
  const canonicalParameterKeys = new Set([
    ...controlDefinitions.keys(),
    ...advancedDefinitions.keys(),
    'duration',
    'seed',
    'extra_params',
  ]);
  for (const [key, column] of Object.entries(request.inputMapping?.canonicalFieldMappings || {})) {
    if (!column?.trim() || !canonicalParameterKeys.has(key)) continue;
    throw badRequest(`The generation parameter mapping for ${key} must use parameterBindings, not MCP input mapping.`);
  }
  for (const [key, column] of Object.entries(request.inputMapping?.extraInputMappings || {})) {
    if (!column?.trim() || !canonicalParameterKeys.has(key)) continue;
    throw badRequest(`The generation parameter mapping for ${key} must use explicit parameterBindings.`);
  }
  for (const key of request.inputMapping?.extraInputColumns || []) {
    if (!canonicalParameterKeys.has(key)) continue;
    throw badRequest(`The generation parameter mapping for ${key} must use explicit parameterBindings.`);
  }
  for (const [key, value] of Object.entries(request.defaultControls || {})) {
    if (key === 'duration' || !hasMappedValue(value) || !canonicalParameterKeys.has(key)) continue;
    throw badRequest(`The generation parameter ${key} has more than one source.`);
  }
  for (const [key, column] of Object.entries(request.perCaseControlColumns || {})) {
    if (key === 'duration' || !column?.trim() || !canonicalParameterKeys.has(key)) continue;
    throw badRequest(`The generation parameter ${key} has more than one source.`);
  }

  for (const [key, binding] of Object.entries(bindings)) {
    if (!binding || !['unused', 'uniform', 'column'].includes(binding.source)) {
      throw badRequest(`Unknown parameter source for ${key}.`);
    }
    if (key === 'seed') throw badRequest('Seed must use the dedicated Seed strategy.');
    if (key === 'duration') throw badRequest('Duration must use the dedicated duration source selector.');
    const control = controlDefinitions.get(key);
    const advanced = advancedDefinitions.get(key);
    if (!control && !advanced) throw badRequest(`The live model configuration does not declare generation parameter: ${key}.`);
    if (binding.source === 'unused') continue;
    if (advanced && !binding.valueType) {
      throw badRequest(`Advanced parameter ${key} requires an explicit value type.`);
    }
    if (binding.valueType && !['string', 'number', 'boolean', 'json'].includes(binding.valueType)) {
      throw badRequest(`Unknown value type for generation parameter ${key}.`);
    }
    if (binding.source === 'uniform' && !hasMappedValue(binding.value)) {
      throw badRequest(`Uniform generation parameter ${key} requires a value.`);
    }
    if (binding.source === 'column') {
      if (!binding.column?.trim()) throw badRequest(`Generation parameter ${key} requires a dataset column.`);
      if (!datasetHasColumn(dataset, binding.column)) {
        throw badRequest(`The selected column for generation parameter ${key} does not exist in this dataset version.`);
      }
    }
  }
};
const resolveReferences = (
  values: unknown[],
  assets: UploadedAssetCandidate[],
): { urls: string[]; issues: PreflightIssue[] } => {
  const urls: string[] = [];
  const issues: PreflightIssue[] = [];
  for (const reference of values.flatMap(flattenReferences)) {
    if (/^(https?:\/\/|asset:\/\/)/i.test(reference)) {
      urls.push(reference);
      continue;
    }
    const matched = matchUploadedAsset(reference, assets);
    if (matched.assetId) urls.push(`asset://${matched.assetId}`);
    else issues.push({
      code: matched.errorCode || 'MISSING_ASSET',
      message: matched.message || `Uploaded asset was not found: ${reference}`,
    });
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
  const parsed = parseStructured(value);
  if (parsed !== value) return resolveStructuredAssets(parsed, assets, fieldPath);
  if (Array.isArray(value)) {
    const resolved = value.map((entry, index) => resolveStructuredAssets(entry, assets, `${fieldPath}[${index}]`));
    return {
      value: resolved.map(entry => entry.value),
      issues: resolved.flatMap(entry => entry.issues),
    };
  }
  if (value && typeof value === 'object') {
    const resolved = Object.entries(value).map(([key, entry]) => {
      const child = resolveStructuredAssets(entry, assets, `${fieldPath}.${key}`);
      return { key, ...child };
    });
    return {
      value: Object.fromEntries(resolved.map(entry => [entry.key, entry.value])),
      issues: resolved.flatMap(entry => entry.issues),
    };
  }
  if (typeof value !== 'string') return { value, issues: [] };
  const reference = value.trim();
  if (!reference || /^(https?:\/\/|asset:\/\/)/i.test(reference)) return { value, issues: [] };
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

const hasMappedValue = (value: unknown) =>
  value !== undefined && value !== null && text(value) !== '';

const BLOCKED_OVERRIDE_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'result_file_dir',
  'preview_file_dir',
  'callback',
  'callback_url',
  'webhook',
  'webhook_url',
]);
const CREDENTIAL_KEY_PATTERN = /(?:authorization|credential|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|password)/i;

const inspectOverrideValue = (value: unknown, path = 'request') => {
  if (typeof value === 'string') {
    if (/^file:\/\//i.test(value.trim())) throw badRequest(`Unsafe file URL is not allowed in ${path}.`);
    if (/(^|[\\/])\.\.([\\/]|$)/.test(value)) throw badRequest(`Path traversal is not allowed in ${path}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectOverrideValue(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw badRequest(`Only plain JSON objects are allowed in ${path}.`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_OVERRIDE_KEYS.has(key) || CREDENTIAL_KEY_PATTERN.test(key)) {
      throw badRequest(`Generation request override cannot set protected field: ${path}.${key}.`);
    }
    inspectOverrideValue(entry, `${path}.${key}`);
  }
};

export const validateGenerationRequestOverride = (
  model: NormalizedGenerationModel,
  baseRequest: Record<string, unknown>,
  override: Record<string, unknown>,
) => {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    throw badRequest('The final Aion request override must be a JSON object.');
  }
  inspectOverrideValue(override);
  if (override.model_name !== model.modelName) {
    throw badRequest('The selected model is immutable in a final Aion request override.');
  }
  if (stableJson(override.features) !== stableJson(baseRequest.features)) {
    throw badRequest('The generation features object is immutable in a final Aion request override.');
  }
  if (model.outputModality === 'video') {
    if (typeof override.generation_type !== 'string' || !override.generation_type.trim()) {
      throw badRequest('A forced video request requires an explicit generation_type.');
    }
  } else if (override.generation_type !== undefined) {
    throw badRequest('Image generation request overrides cannot set generation_type.');
  }
  return JSON.parse(JSON.stringify(override)) as Record<string, unknown>;
};

const FORCEABLE_PREFLIGHT_CODES = new Set([
  'CONTRACT_REVIEW_REQUIRED',
  'GENERATION_TYPE_REVIEW_REQUIRED',
  'RELATIVE_ASSET_REQUIRES_REVIEW',
  'AUDIO_ONLY_MODE_REVIEW_REQUIRED',
  'UNSUPPORTED_INPUT',
  'UNSUPPORTED_GENERATION_TYPE',
  'MISSING_REQUIRED_INPUT',
  'INPUT_COUNT_OUT_OF_RANGE',
  'MULTIPLE_AUDIOS_REQUIRE_AUDIOS',
  'AUDIO_RANGE_REQUIRES_AUDIOS',
]);

export const buildGenerationCasesForPreflight = (
  dataset: Awaited<ReturnType<typeof getDatasetVersion>> extends infer T ? Exclude<T, null> : never,
  request: GenerationPreflightRequest,
  model: NormalizedGenerationModel,
  selectedRows: GenerationSelectionRow[],
) => {
  const assets = request.assetBindings || [];
  const controlDefinitions = new Map(model.controls.map(control => [control.key, control]));
  const controlKeys = new Set(controlDefinitions.keys());
  const coreInputKeys = new Set(['prompt', 'image_urls', 'images', 'audios']);

  return selectedRows.map(({ row, rowIndex, datasetItemId }) => {
    const caseId = getDatasetRowCaseId(row, rowIndex);
    const caseReview = request.caseReviews?.[datasetItemId];
    const input = request.inputMapping || {};
    const mappingMode = input.mappingMode || 'assisted';
    const contentMapping = input.contentMappingVersion === 2 && input.contentMapping?.version === 2
      ? input.contentMapping
      : undefined;
    const durationIssues: PreflightIssue[] = [];
    const assetIssues: PreflightIssue[] = [];
    const assistedIssues: PreflightIssue[] = [];
    const parameterIssues: PreflightIssue[] = [];
    const parameterWarnings: PreflightIssue[] = [];
    const parameterAudit: NonNullable<GenerationCase['parameterAudit']> = {};
    const advancedExtraParams: Record<string, unknown> = {};
    const durationSource = request.durationSource;
    const usesParameterBindings = request.parameterBindings !== undefined;
    const controls: Record<string, unknown> = usesParameterBindings
      ? {}
      : { ...(request.defaultControls || {}) };

    if (input.presetId === 'vidmuse_evaluation_v1') {
      const original = row._originalData
        && typeof row._originalData === 'object'
        && !Array.isArray(row._originalData)
        ? row._originalData as Record<string, unknown>
        : undefined;
      const rowModality = text(row.modality ?? original?.modality).toLowerCase();
      if (rowModality && rowModality !== model.outputModality) {
        assistedIssues.push({
          code: 'DATASET_MODALITY_MISMATCH',
          field: 'modality',
          message: `Case ${caseId} is marked as ${rowModality}, but the selected model produces ${model.outputModality}.`,
        });
      }
    }

    if (usesParameterBindings) {
      if ((!durationSource || durationSource.mode === 'uniform')
        && hasMappedValue(request.defaultControls?.duration)) {
        controls.duration = request.defaultControls?.duration;
      }
      const advancedKeys = new Set((model.advancedParameters || []).map(parameter => parameter.key));
      for (const [key, binding] of Object.entries(request.parameterBindings || {})) {
        if (!binding || binding.source === 'unused') continue;
        const definition = controlDefinitions.get(key);
        const isAdvanced = advancedKeys.has(key);
        let rawValue: unknown;
        if (binding.source === 'column') {
          rawValue = row[binding.column];
          if (!hasMappedValue(rawValue)) {
            parameterIssues.push({
              code: 'MISSING_PARAMETER_COLUMN_VALUE',
              field: key,
              message: `The ${binding.column} column is empty for parameter ${key} in case ${caseId}.`,
            });
            continue;
          }
        } else {
          rawValue = binding.value;
        }
        const valueType = parameterValueType(definition, isAdvanced ? binding.valueType : undefined);
        const coerced = coerceBoundParameter(rawValue, valueType);
        if ('message' in coerced) {
          parameterIssues.push({
            code: 'INVALID_PARAMETER_VALUE',
            field: key,
            message: `${key}: ${coerced.message}`,
          });
          continue;
        }
        if (isAdvanced) {
          advancedExtraParams[key] = coerced.value;
          parameterWarnings.push({
            code: 'UNVERIFIED_EXTRA_PARAMETER',
            field: key,
            message: `${key} is not covered by the unified Aion contract and will be passed through extra_params.`,
          });
        } else {
          controls[key] = coerced.value;
        }
        parameterAudit[key] = {
          source: binding.source,
          ...(binding.source === 'column' ? { column: binding.column } : {}),
          value: coerced.value,
          verified: !isAdvanced,
          destination: isAdvanced ? 'extra_params' : 'control',
        };
      }
    } else {
      if (durationSource && durationSource.mode !== 'uniform') delete controls.duration;
      for (const [key, column] of Object.entries(request.perCaseControlColumns || {})) {
        if (durationSource && key === 'duration') continue;
        const value = row[column];
        if (hasMappedValue(value)) controls[key] = value;
      }
      if (mappingMode === 'mcp') {
        for (const [key, column] of Object.entries(input.canonicalFieldMappings || {})) {
          if (!controlKeys.has(key) || !hasMappedValue(row[column])) continue;
          controls[key] = row[column];
        }
      }
    }
    if (durationSource?.mode === 'column') {
      const value = durationSource.column ? row[durationSource.column] : undefined;
      if (!hasMappedValue(value)) {
        durationIssues.push({
          code: 'MISSING_DURATION_COLUMN_VALUE',
          field: durationSource.column || 'duration',
          message: `The duration column is empty for case ${caseId}.`,
        });
      } else {
        controls.duration = value;
      }
    }
    for (const definition of model.controls) {
      if (controls[definition.key] !== undefined
        && (!usesParameterBindings || definition.key === 'duration')) {
        controls[definition.key] = coerceControl(controls[definition.key], definition);
      }
    }

    let rawCanonicalInput: Record<string, unknown>;
    let contentIntent: ReturnType<typeof compileGenerationContentMappingV2>['intent'] | undefined;
    if (contentMapping) {
      const content = compileGenerationContentMappingV2({
        row,
        mapping: contentMapping,
        outputModality: model.outputModality,
        assets,
      });
      contentIntent = content.intent;
      assetIssues.push(...content.issues);
      rawCanonicalInput = { ...content.input, ...controls };
    } else if (mappingMode === 'mcp') {
      const mappings = { ...(input.canonicalFieldMappings || {}) };
      if (!mappings.prompt && input.promptColumn) mappings.prompt = input.promptColumn;
      const mappedInput: Record<string, unknown> = {};
      for (const [key, column] of Object.entries(mappings)) {
        if (!column || controlKeys.has(key) || !hasMappedValue(row[column])) continue;
        const resolved = resolveStructuredAssets(row[column], assets, key);
        mappedInput[key] = resolved.value;
        assetIssues.push(...resolved.issues);
      }
      rawCanonicalInput = { ...mappedInput, ...controls };
    } else {
      const start = resolveReferences(input.startImageColumn ? [row[input.startImageColumn]] : [], assets);
      const end = resolveReferences(input.endImageColumn ? [row[input.endImageColumn]] : [], assets);
      const references = resolveReferences(
        (input.referenceImageColumns || []).map(column => row[column]),
        assets,
      );
      const videos = resolveReferences(
        (input.referenceVideoColumns || []).map(column => row[column]),
        assets,
      );
      assetIssues.push(...start.issues, ...end.issues, ...references.issues, ...videos.issues);
      if (start.urls.length > 1) {
        assistedIssues.push({
          code: 'INVALID_IMAGE_ROLE_COUNT',
          field: 'startImageColumn',
          message: 'A case can contain only one start-frame image.',
        });
      }
      if (end.urls.length > 1) {
        assistedIssues.push({
          code: 'INVALID_IMAGE_ROLE_COUNT',
          field: 'endImageColumn',
          message: 'A case can contain only one end-frame image.',
        });
      }
      if (end.urls.length && !start.urls.length) {
        assistedIssues.push({
          code: 'MISSING_START_IMAGE',
          field: 'startImageColumn',
          message: 'An end-frame image requires a start-frame image in the same case.',
        });
      }

      const rawExtraInputs = Object.fromEntries([
        ...(input.extraInputColumns || []).map(column => [column, parseStructured(row[column])]),
        ...Object.entries(input.extraInputMappings || {}).map(([key, column]) => [key, parseStructured(row[column])]),
      ]);
      if (input.lyricsOrDialogueColumn) {
        rawExtraInputs.lyrics_or_dialogue = row[input.lyricsOrDialogueColumn];
      }
      const resolvedExtraInputs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawExtraInputs)) {
        const resolved = resolveStructuredAssets(value, assets, key);
        resolvedExtraInputs[key] = resolved.value;
        assetIssues.push(...resolved.issues);
      }

      const referenceAudios: unknown[] = [];
      for (const column of input.referenceAudioColumns || []) {
        const rawValue = row[column];
        const parsed = parseStructured(rawValue);
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
          const resolved = resolveStructuredAssets(parsed, assets, 'audios');
          referenceAudios.push(resolved.value);
          assetIssues.push(...resolved.issues);
        } else {
          const resolved = resolveReferences([rawValue], assets);
          referenceAudios.push(...resolved.urls);
          assetIssues.push(...resolved.issues);
        }
      }

      const promptValue = input.promptColumn ? row[input.promptColumn] : undefined;
      if (model.outputModality === 'image') {
        rawCanonicalInput = {
          ...resolvedExtraInputs,
          ...controls,
          prompt: promptValue,
          images: [...start.urls, ...end.urls, ...references.urls],
        };
      } else {
        const existingElements = resolvedExtraInputs.elements;
        delete resolvedExtraInputs.elements;
        rawCanonicalInput = {
          ...buildAssistedVidMuseInput({
            prompt: promptValue,
            startImageUrls: start.urls,
            endImageUrls: end.urls,
            referenceImageUrls: references.urls,
            referenceVideoUrls: videos.urls,
            referenceAudios,
            existingElements,
            extraInputs: resolvedExtraInputs,
          }),
          ...controls,
        };
      }
    }

    if (Object.keys(advancedExtraParams).length) {
      const existingExtraParams = rawCanonicalInput.extra_params;
      rawCanonicalInput.extra_params = {
        ...(existingExtraParams && typeof existingExtraParams === 'object' && !Array.isArray(existingExtraParams)
          ? existingExtraParams : {}),
        ...advancedExtraParams,
      };
    }
    const compiled = compileVidMuseGenerationInput({
      model: {
        modelName: model.modelName,
        outputModality: model.outputModality,
        capabilities: model.capabilities,
        inputSchema: model.inputSchema,
        options: model.options,
      },
      input: rawCanonicalInput,
      compatibilityMode: contentMapping ? 'strict' : input.compatibilityMode || 'strict',
      contractVersion: contentMapping ? 3 : 1,
      promptFormat: contentMapping?.prompt.format,
      review: caseReview,
    });
    const audioInputs = compiled.input.audios || [];
    const audioUrls = audioInputs.map(audio => audio.url);
    const imageUrls = compiled.input.image_urls || compiled.input.images || [];
    const videoUrls = (compiled.input.elements || []).flatMap(element =>
      element.video_url ? [element.video_url] : []);
    const prompt = compiled.input.prompt;
    const caseGenerationType = compiled.generationType;

    const seedMode = request.seedMode || 'derive_from_case';
    const seedColumnValue = seedMode === 'column' && request.seedColumn
      ? row[request.seedColumn]
      : undefined;
    const seed = seedMode === 'fixed'
      ? Number(request.fixedSeed ?? 42)
      : seedMode === 'column'
        ? Number(seedColumnValue)
        : deriveGenerationSeed(`${dataset.id}:${caseId}:${request.targetColumn}:${stableJson(prompt || '')}`);
    const seedIssues: PreflightIssue[] = [];
    if (seedMode === 'column' && (!request.seedColumn || seedColumnValue == null || text(seedColumnValue) === '')) {
      seedIssues.push({
        code: 'INVALID_SEED',
        field: request.seedColumn || 'seedColumn',
        message: `The seed column must contain an integer between 0 and ${MAX_PORTABLE_GENERATION_SEED} for case ${caseId}.`,
      });
    } else {
      const issue = generationSeedIssue(seed);
      if (issue) {
        seedIssues.push({
          ...issue,
          field: seedMode === 'fixed' ? 'fixedSeed' : request.seedColumn || issue.field,
        });
      }
    }

    let durationResolution: GenerationCase['durationResolution'];
    if (durationSource?.mode === 'reference_audio') {
      const audit = durationSource.referenceAudio?.[datasetItemId];
      if (audioUrls.length !== 1) {
        durationIssues.push({
          code: audioUrls.length ? 'MULTIPLE_REFERENCE_AUDIOS' : 'MISSING_REFERENCE_AUDIO',
          field: 'referenceAudioColumns',
          message: `Audio-follow duration requires exactly one reference audio for case ${caseId}.`,
        });
      } else if (!/^https?:\/\//i.test(audioUrls[0])) {
        durationIssues.push({
          code: 'REFERENCE_AUDIO_NOT_PUBLIC',
          field: 'referenceAudioColumns',
          message: 'Audio-follow duration only supports public HTTP(S) reference audio.',
        });
      } else if (!audit) {
        durationIssues.push({
          code: 'UNKNOWN_AUDIO_DURATION',
          field: 'duration',
          message: `No audio metadata duration was provided for case ${caseId}.`,
        });
      } else if (audit.audioUrl !== audioUrls[0]) {
        durationIssues.push({
          code: 'AUDIO_DURATION_URL_MISMATCH',
          field: 'duration',
          message: `The probed audio URL does not match the selected reference audio for case ${caseId}.`,
        });
      } else {
        const normalized = resolveReferenceAudioDuration(model, audit.detectedSeconds, caseGenerationType);
        if (!normalized.valid) {
          durationIssues.push({
            code: 'REFERENCE_AUDIO_DURATION_UNSUPPORTED',
            field: 'duration',
            message: normalized.error?.message || 'Reference audio duration is unsupported.',
          });
        } else if (Math.abs(normalized.resolvedDuration - Number(audit.resolvedDuration)) > 0.001) {
          durationIssues.push({
            code: 'AUDIO_DURATION_RESOLUTION_MISMATCH',
            field: 'duration',
            message: `The submitted duration does not match the server resolution for case ${caseId}.`,
          });
        } else {
          controls.duration = normalized.resolvedDuration;
          durationResolution = {
            source: 'reference_audio',
            audioUrl: audit.audioUrl,
            detectedSeconds: normalized.detectedSeconds,
            resolvedDuration: normalized.resolvedDuration,
          };
        }
      }
    } else if (durationSource?.mode === 'column' && Number.isFinite(Number(controls.duration))) {
      durationResolution = {
        source: 'column',
        column: durationSource.column,
        resolvedDuration: Number(controls.duration),
      };
    } else if (durationSource?.mode === 'uniform' && Number.isFinite(Number(controls.duration))) {
      durationResolution = {
        source: 'uniform',
        resolvedDuration: Number(controls.duration),
      };
    }
    if (controls.duration !== undefined && controls.duration !== '') {
      compiled.input.duration = controls.duration;
      compiled.originalInput.duration = controls.duration;
    }

    const extraInputs = Object.fromEntries(Object.entries(compiled.input).filter(([key]) =>
      !coreInputKeys.has(key) && !controlKeys.has(key)));
    const resolvedCase: GenerationCase = {
      caseId,
      datasetItemId,
      rowIndex,
      prompt,
      imageUrls,
      audioUrls,
      audioInputs,
      videoUrls,
      controls,
      seed,
      extraInputs,
      ...(Object.keys(parameterAudit).length ? { parameterAudit } : {}),
      generationType: caseGenerationType,
      compilerAudit: {
        compilerVersion: compiled.compilerVersion,
        profileId: compiled.profileId,
        modelDescription: model.description,
        effectiveGenerationType: compiled.effectiveGenerationType,
        ...(contentIntent ? { intent: contentIntent } : {}),
        compatibilityApplied: compiled.compatibilityApplied,
        originalInput: compiled.originalInput,
        compiledInput: compiled.input,
        bindings: compiled.bindings,
        contractFindings: compiled.contractFindings,
        appliedFindingIds: compiled.appliedFindingIds,
        reviewedFindingIds: compiled.reviewedFindingIds,
        contractSource: compiled.contractSource,
        review: caseReview,
      },
      ...(durationResolution ? { durationResolution } : {}),
    };
    return {
      resolvedCase,
      preparationIssues: [
        ...assetIssues,
        ...assistedIssues,
        ...compiled.errors,
        ...parameterIssues,
        ...durationIssues,
        ...seedIssues,
      ],
      preparationWarnings: [...compiled.warnings, ...parameterWarnings],
    };
  });
};

export const validateDurationSourceConfiguration = (
  request: GenerationPreflightRequest,
  model: NormalizedGenerationModel,
) => {
  const source = request.durationSource;
  if (!source) return;
  if (!['uniform', 'column', 'reference_audio'].includes(source.mode)) {
    throw badRequest('Unknown duration source mode.');
  }
  if (model.outputModality !== 'video') {
    throw badRequest('Duration source selection is only available for video generation.');
  }

  const hasDefaultDuration = hasMappedValue(request.defaultControls?.duration);
  const hasPerCaseDuration = hasMappedValue(request.perCaseControlColumns?.duration);
  if (source.mode === 'uniform') {
    if (hasPerCaseDuration || source.column || source.referenceAudio) {
      throw badRequest('Uniform duration cannot be combined with another duration source.');
    }
    return;
  }
  if (source.mode === 'column') {
    if (!source.column?.trim()) throw badRequest('A duration column is required.');
    if (hasDefaultDuration || hasPerCaseDuration || source.referenceAudio) {
      throw badRequest('Column duration cannot be combined with another duration source.');
    }
    return;
  }
  if (hasDefaultDuration || hasPerCaseDuration || source.column) {
    throw badRequest('Reference-audio duration cannot be combined with another duration source.');
  }
  if (source.referenceAudio && typeof source.referenceAudio !== 'object') {
    throw badRequest('Reference-audio duration metadata must be keyed by stable dataset item ID.');
  }
};

const deduplicatePreflightIssues = <T extends { code: string; field?: string; message: string }>(issues: T[]) =>
  issues.filter((issue, index) => issues.findIndex(candidate =>
    candidate.code === issue.code
    && candidate.field === issue.field
    && candidate.message === issue.message) === index);

export const createGenerationPreflight = async (
  request: GenerationPreflightRequest,
  user: RequestUser,
) => {
  if (!request.datasetId || !request.modelName || !request.targetColumn?.trim()) {
    throw badRequest('datasetId, modelName, and targetColumn are required.');
  }
  if (request.targetColumn.startsWith('__') || request.targetColumn === '_originalData') {
    throw badRequest('The target column is reserved for internal fields.');
  }

  if (!await isGenerationDatasetInOrganization(request.datasetId, user.organizationId)) {
    throw new ApiError(403, 'FORBIDDEN', 'This dataset is outside your organization.');
  }
  const dataset = await getDatasetVersion(request.datasetId, Number(request.datasetVersion));
  if (!dataset) throw notFound('Dataset version');
  const model = await aionGenerationClient.getModel(request.modelName);
  if (!model) throw notFound('Enabled Aion model');
  validateDurationSourceConfiguration(request, model);
  validateGenerationParameterBindings(request, model, dataset);
  validateGenerationContentMappingConfiguration(request, model, dataset);

  const targetMode = request.targetMode || 'new';
  const targetInspection = inspectGenerationTargetColumn(dataset, {
    mode: targetMode,
    targetColumn: request.targetColumn,
    modelName: model.modelName || model.id,
    outputModality: model.outputModality,
    configFingerprint: model.configFingerprint,
  });
  const targetErrors = request.retryOfJobId
    ? targetInspection.errors.filter(issue => ![
      'TARGET_COLUMN_EXISTS',
      'TARGET_COLUMN_NOT_OUTPUT',
    ].includes(issue.code))
    : targetInspection.errors;
  if (targetErrors.length) {
    throw badRequest(targetErrors[0].message, { issues: targetErrors });
  }

  const selection = resolveGenerationCaseSelection(
    dataset.items || [],
    request.selectedDatasetItemIds,
  );
  if (selection.errors.length) {
    throw badRequest(selection.errors[0].message, { issues: selection.errors });
  }
  const selectedIdSet = new Set(selection.normalizedIds);
  const unknownReviewIds = Object.keys(request.caseReviews || {}).filter(id => !selectedIdSet.has(id));
  if (unknownReviewIds.length) {
    throw badRequest('Case reviews contain unknown or unselected stable item IDs.', {
      datasetItemIds: unknownReviewIds,
    });
  }
  if (request.durationSource?.mode === 'column'
    && !dataset.items.some(row => Object.prototype.hasOwnProperty.call(row, request.durationSource?.column || ''))) {
    throw badRequest('The selected duration column does not exist in this dataset version.');
  }
  if (request.durationSource?.mode === 'reference_audio') {
    const selectedIds = new Set(selection.normalizedIds);
    const unknownDurationIds = Object.keys(request.durationSource.referenceAudio || {})
      .filter(datasetItemId => !selectedIds.has(datasetItemId));
    if (unknownDurationIds.length) {
      throw badRequest('Reference-audio duration metadata contains unknown or unselected case IDs.', {
        datasetItemIds: unknownDurationIds,
      });
    }
  }
  request = {
    ...request,
    targetMode,
    selectedDatasetItemIds: selection.normalizedIds,
  };

  const requestedAssetIds = Array.from(new Set((request.assetBindings || []).map(asset => String(asset.id))));
  const verifiedAssets = await getGenerationAssetsForPreflight(requestedAssetIds, request.datasetId, user);
  if (verifiedAssets.length !== requestedAssetIds.length) {
    const verifiedIds = new Set(verifiedAssets.map(asset => asset.id));
    throw badRequest('One or more uploaded assets are unavailable for this dataset and user.', {
      assetIds: requestedAssetIds.filter(assetId => !verifiedIds.has(assetId)),
    });
  }
  request = { ...request, assetBindings: verifiedAssets };

  const prepared = buildGenerationCasesForPreflight(dataset, request, model, selection.rows);
  if (!prepared.length) throw badRequest('No dataset cases were selected.');
  if (prepared.length > serverConfig.generationMaxBatchSize) {
    throw badRequest(`A generation batch is limited to ${serverConfig.generationMaxBatchSize} cases.`);
  }

  const cases = prepared.map(({ resolvedCase, preparationIssues, preparationWarnings }) => {
    const result = preflightGenerationCase(
      model,
      resolvedCase,
      generationValidationForModel(model, serverConfig.generationModelValidationOverrides),
    );
    const sourceRow = dataset.items[resolvedCase.rowIndex] || {};
    const targetValue = text(sourceRow[request.targetColumn]);
    let errors = [...preparationIssues, ...result.errors];
    const warnings = [...preparationWarnings, ...result.warnings];
    const review = request.caseReviews?.[resolvedCase.datasetItemId];
    const baseAionRequest = buildAionGenerationRequest(model, result.resolvedCase).body;
    const force = review?.force;
    if (review?.finalAionRequest && !force) {
      throw badRequest(`Case ${resolvedCase.caseId} must include a force reason and duplicate-billing confirmation when editing final Aion JSON.`);
    }
    if (force && (!text(force.reason) || force.duplicateBillingRiskConfirmed !== true)) {
      throw badRequest(`Case ${resolvedCase.caseId} requires a force reason and duplicate-billing confirmation.`);
    }
    if (force && !review?.finalAionRequest && errors.some(issue => [
      'GENERATION_TYPE_REVIEW_REQUIRED',
      'AUDIO_ONLY_MODE_REVIEW_REQUIRED',
      'UNSUPPORTED_GENERATION_TYPE',
    ].includes(issue.code))) {
      throw badRequest(`Case ${resolvedCase.caseId} requires an explicit final Aion JSON request because its generation mode is unresolved.`);
    }
    const finalAionRequest = review?.finalAionRequest
      ? validateGenerationRequestOverride(model, baseAionRequest, review.finalAionRequest)
      : baseAionRequest;
    const bypassedRules = force
      ? errors.filter(issue => FORCEABLE_PREFLIGHT_CODES.has(issue.code)).map(issue => issue.code)
      : [];
    if (force) {
      errors = errors.filter(issue => !FORCEABLE_PREFLIGHT_CODES.has(issue.code));
      warnings.push({
        code: 'AION_MANUAL_OVERRIDE',
        field: 'request',
        message: `This case uses a reviewed Aion override and is no longer guaranteed to align with the VidMuse MCP contract. Reason: ${text(force.reason)}`,
      });
    }
    const finalGenerationType = model.outputModality === 'video'
      && typeof finalAionRequest.generation_type === 'string'
      ? finalAionRequest.generation_type
      : result.generationType;
    const auditedResolvedCase = result.resolvedCase.compilerAudit
      ? {
          ...result.resolvedCase,
          generationType: finalGenerationType,
          compilerAudit: {
            ...result.resolvedCase.compilerAudit,
            finalAionRequest,
            ...((force || review?.finalAionRequest) ? {
              overrideAudit: {
                forced: Boolean(force),
                ...(force ? { reason: text(force.reason) } : {}),
                actorId: user.id,
                actorName: user.displayName,
                reviewedAt: Date.now(),
                originalRequest: baseAionRequest,
                finalRequest: finalAionRequest,
                bypassedRules: Array.from(new Set(bypassedRules)),
                configFingerprint: model.configFingerprint,
              },
            } : {}),
          },
        }
      : result.resolvedCase;
    if (targetValue) {
      errors.push({
        code: 'TARGET_NOT_EMPTY',
        field: request.targetColumn,
        message: `The target column already contains a result for case ${auditedResolvedCase.caseId}.`,
      });
    }
    if (!auditedResolvedCase.datasetItemId) {
      errors.push({
        code: 'MISSING_STABLE_ITEM_ID',
        message: `The case has no stable dataset item ID: ${auditedResolvedCase.caseId}.`,
      });
    }
    const finalErrors = deduplicatePreflightIssues(errors);
    const finalWarnings = deduplicatePreflightIssues(warnings);
    return {
      ...result,
      generationType: finalGenerationType,
      valid: finalErrors.length === 0,
      errors: finalErrors,
      warnings: finalWarnings,
      resolvedCase: auditedResolvedCase,
    };
  });

  const validCount = cases.filter(item => item.valid).length;
  const invalidCount = cases.length - validCount;
  const selectionSummary = {
    datasetTotal: dataset.items.length,
    selected: cases.length,
    valid: validCount,
    invalid: invalidCount,
    unselected: Math.max(0, dataset.items.length - cases.length),
  };
  const costEstimate = estimateGenerationCost(model, cases.filter(item => item.valid).map(item => item.resolvedCase));
  const hashCases = cases.map(item => {
    const resolved = item.resolvedCase;
    const audit = resolved.compilerAudit;
    return {
      datasetItemId: resolved.datasetItemId,
      generationType: item.generationType,
      prompt: resolved.prompt,
      imageUrls: resolved.imageUrls,
      audioInputs: resolved.audioInputs,
      controls: resolved.controls,
      seed: resolved.seed,
      extraInputs: resolved.extraInputs,
      compilerAudit: audit ? {
        compilerVersion: audit.compilerVersion,
        originalInput: audit.originalInput,
        compiledInput: audit.compiledInput,
        finalAionRequest: audit.finalAionRequest,
        appliedFindingIds: audit.appliedFindingIds,
        reviewedFindingIds: audit.reviewedFindingIds,
        overrideAudit: audit.overrideAudit ? {
          forced: audit.overrideAudit.forced,
          reason: audit.overrideAudit.reason,
          originalRequest: audit.overrideAudit.originalRequest,
          finalRequest: audit.overrideAudit.finalRequest,
          bypassedRules: audit.overrideAudit.bypassedRules,
          configFingerprint: audit.overrideAudit.configFingerprint,
        } : undefined,
      } : undefined,
    };
  });
  const requestHash = fingerprintConfig({
    datasetId: request.datasetId,
    datasetVersion: request.datasetVersion,
    modelName: request.modelName,
    configFingerprint: model.configFingerprint,
    targetColumn: request.targetColumn.trim(),
    targetMode,
    inputMapping: request.inputMapping,
    defaultControls: request.defaultControls || {},
    perCaseControlColumns: request.perCaseControlColumns || {},
    parameterBindings: request.parameterBindings,
    durationSource: request.durationSource,
    retryOfJobId: request.retryOfJobId,
    retryDuplicateBillingRiskConfirmed: request.retryDuplicateBillingRiskConfirmed === true,
    seedMode: request.seedMode,
    fixedSeed: request.fixedSeed,
    seedColumn: request.seedColumn,
    selectedDatasetItemIds: selection.normalizedIds,
    cases: hashCases,
  });
  const id = `preflight-${randomUUID()}`;
  const expiresAt = Date.now() + 30 * 60 * 1000;
  const payload = {
    ...request,
    targetColumn: request.targetColumn.trim(),
    datasetName: request.datasetName || dataset.name,
  };
  const result = {
    model,
    configFingerprint: model.configFingerprint,
    validCount,
    invalidCount,
    total: cases.length,
    selectionSummary,
    batchWarnings: targetInspection.warnings,
    costEstimate,
    cases,
    requestHash,
    expiresAt,
  };

  await saveGenerationPreflight({
    id,
    datasetId: request.datasetId,
    datasetVersion: request.datasetVersion,
    modelName: request.modelName,
    configFingerprint: model.configFingerprint,
    requestHash,
    payload,
    result,
    createdBy: user.id,
    expiresAt,
  });

  return { id, ...result };
};

export const confirmGenerationPreflight = async (
  preflightId: string,
  user: RequestUser,
) => {
  const preflight = await getGenerationPreflight(preflightId);
  if (!preflight) throw new ApiError(410, 'PREFLIGHT_EXPIRED', 'The preflight expired; run it again.');
  if (preflight.createdBy !== user.id) throw new ApiError(403, 'FORBIDDEN', 'This preflight belongs to another user.');
  if (!await isGenerationDatasetInOrganization(preflight.datasetId, user.organizationId)) {
    throw new ApiError(403, 'FORBIDDEN', 'This preflight is outside your organization.');
  }

  const currentModel = await aionGenerationClient.getModel(preflight.modelName);
  if (!currentModel) throw notFound('Enabled Aion model');
  if (currentModel.configFingerprint !== preflight.configFingerprint) {
    throw conflict('The live model configuration changed; run preflight again.', {
      previousFingerprint: preflight.configFingerprint,
      currentFingerprint: currentModel.configFingerprint,
    });
  }
  if (!(preflight.result.validCount > 0)) {
    throw badRequest('The preflight contains no valid cases to submit.');
  }

  return createGenerationBatchFromPreflight(preflight, user);
};

export const generationPreflightFingerprint = (request: GenerationPreflightRequest) =>
  fingerprintConfig(stableJson(request));
