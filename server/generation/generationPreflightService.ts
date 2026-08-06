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
  GenerationCompatibilityMode,
  GenerationDurationSource,
  GenerationInputMappingMode,
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
  createGenerationBatchFromPreflight,
  getGenerationPreflight,
  getGenerationAssetsForPreflight,
  isGenerationDatasetInOrganization,
  saveGenerationPreflight,
} from './generationExecutionRepository.ts';

export type GenerationPreflightRequest = {
  datasetId: string;
  datasetVersion: number;
  datasetName?: string;
  modelName: string;
  targetColumn: string;
  targetMode?: GenerationTargetMode;
  inputMapping: {
    mappingMode?: GenerationInputMappingMode;
    compatibilityMode?: GenerationCompatibilityMode;
    canonicalFieldMappings?: Record<string, string>;
    promptColumn?: string;
    referenceImageColumns?: string[];
    referenceAudioColumns?: string[];
    referenceVideoColumns?: string[];
    startImageColumn?: string;
    endImageColumn?: string;
    lyricsOrDialogueColumn?: string;
    extraInputColumns?: string[];
    extraInputMappings?: Record<string, string>;
  };
  defaultControls?: Record<string, any>;
  perCaseControlColumns?: Record<string, string>;
  durationSource?: GenerationDurationSource;
  seedMode?: 'fixed' | 'derive_from_case' | 'column';
  fixedSeed?: number;
  seedColumn?: string;
  selectedDatasetItemIds?: string[];
  retryOfJobId?: string;
  retrySourceItemIds?: Record<string, string>;
  retryDuplicateBillingRiskConfirmed?: boolean;
  assetBindings?: UploadedAssetCandidate[];
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
    const input = request.inputMapping || {};
    const mappingMode = input.mappingMode || 'assisted';
    const durationIssues: PreflightIssue[] = [];
    const assetIssues: PreflightIssue[] = [];
    const assistedIssues: PreflightIssue[] = [];
    const durationSource = request.durationSource;
    const controls = { ...(request.defaultControls || {}) };
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
      if (controls[definition.key] !== undefined) {
        controls[definition.key] = coerceControl(controls[definition.key], definition);
      }
    }

    let rawCanonicalInput: Record<string, unknown>;
    if (mappingMode === 'mcp') {
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

    const compiled = compileVidMuseGenerationInput({
      model: { modelName: model.modelName, outputModality: model.outputModality },
      input: rawCanonicalInput,
      compatibilityMode: input.compatibilityMode || 'strict',
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
      generationType: caseGenerationType,
      compilerAudit: {
        compilerVersion: compiled.compilerVersion,
        profileId: compiled.profileId,
        compatibilityApplied: compiled.compatibilityApplied,
        originalInput: compiled.originalInput,
        compiledInput: compiled.input,
        bindings: compiled.bindings,
      },
      ...(durationResolution ? { durationResolution } : {}),
    };
    return {
      resolvedCase,
      preparationIssues: [
        ...assetIssues,
        ...assistedIssues,
        ...compiled.errors,
        ...durationIssues,
        ...seedIssues,
      ],
      preparationWarnings: compiled.warnings,
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
    const result = preflightGenerationCase(model, resolvedCase);
    const sourceRow = dataset.items[resolvedCase.rowIndex] || {};
    const targetValue = text(sourceRow[request.targetColumn]);
    const errors = [...preparationIssues, ...result.errors];
    const warnings = [...preparationWarnings, ...result.warnings];
    const finalAionRequest = buildAionGenerationRequest(model, result.resolvedCase).body;
    const auditedResolvedCase = result.resolvedCase.compilerAudit
      ? {
          ...result.resolvedCase,
          compilerAudit: { ...result.resolvedCase.compilerAudit, finalAionRequest },
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
    return {
      ...result,
      valid: errors.length === 0,
      errors,
      warnings,
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
    durationSource: request.durationSource,
    retryOfJobId: request.retryOfJobId,
    retryDuplicateBillingRiskConfirmed: request.retryDuplicateBillingRiskConfirmed === true,
    seedMode: request.seedMode,
    fixedSeed: request.fixedSeed,
    seedColumn: request.seedColumn,
    selectedDatasetItemIds: selection.normalizedIds,
    cases: cases.map(item => item.resolvedCase),
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
