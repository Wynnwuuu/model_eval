import { randomUUID } from 'node:crypto';

import { DATASET_ITEM_ID_KEY, getDatasetRowCaseId } from '../../src/datasetSync.ts';
import type { RequestUser } from '../auth/context.ts';
import { serverConfig } from '../config.ts';
import { getDatasetVersion } from '../datasets/datasetRepository.ts';
import { ApiError, badRequest, conflict, notFound } from '../http/errors.ts';
import { aionGenerationClient } from './aionGenerationClient.ts';
import {
  estimateGenerationCost,
  fingerprintConfig,
  matchUploadedAsset,
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
  saveGenerationPreflight,
} from './generationExecutionRepository.ts';

export type GenerationPreflightRequest = {
  datasetId: string;
  datasetVersion: number;
  datasetName?: string;
  modelName: string;
  targetColumn: string;
  inputMapping: {
    promptColumn?: string;
    referenceImageColumns?: string[];
    referenceAudioColumns?: string[];
    startImageColumn?: string;
    endImageColumn?: string;
    lyricsOrDialogueColumn?: string;
    extraInputColumns?: string[];
    extraInputMappings?: Record<string, string>;
  };
  defaultControls?: Record<string, any>;
  perCaseControlColumns?: Record<string, string>;
  seedMode?: 'fixed' | 'derive_from_case' | 'column';
  fixedSeed?: number;
  seedColumn?: string;
  selectedDatasetItemIds?: string[];
  retryOfJobId?: string;
  assetBindings?: UploadedAssetCandidate[];
};

const text = (value: unknown) => String(value ?? '').trim();

const parseStructured = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const flattenReferences = (value: unknown): string[] => {
  if (value == null) return [];
  const parsed = parseStructured(value);
  if (Array.isArray(parsed)) return parsed.flatMap(flattenReferences);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    return flattenReferences(record.url || record.src || record.path || record.file);
  }
  const raw = text(parsed);
  if (!raw) return [];
  const urls = raw.match(/(?:https?:\/\/|asset:\/\/)[^\s"'\t|,;<>]+/g);
  if (urls?.length) return urls.map(url => url.replace(/[)\],;]+$/g, ''));
  return raw.split(/[\n\r|;,]+/).map(item => item.trim()).filter(Boolean);
};

const deriveSeed = (value: string) => {
  const hash = fingerprintConfig(value).slice(0, 8);
  return Number.parseInt(hash, 16) >>> 0;
};

const coerceControl = (value: unknown, definition: NormalizedGenerationModel['controls'][number] | undefined) => {
  if (!definition) return value;
  if (definition.type === 'number') return Number(value);
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
  return { urls: Array.from(new Set(urls)), issues };
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

const buildCases = (
  dataset: Awaited<ReturnType<typeof getDatasetVersion>> extends infer T ? Exclude<T, null> : never,
  request: GenerationPreflightRequest,
  model: NormalizedGenerationModel,
) => {
  const selected = new Set(request.selectedDatasetItemIds || []);
  const assets = request.assetBindings || [];
  return (dataset.items || [])
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => !selected.size || selected.has(text(row[DATASET_ITEM_ID_KEY])))
    .map(({ row, rowIndex }) => {
      const datasetItemId = text(row[DATASET_ITEM_ID_KEY]);
      const caseId = getDatasetRowCaseId(row, rowIndex);
      const input = request.inputMapping || {};
      const start = resolveReferences(input.startImageColumn ? [row[input.startImageColumn]] : [], assets);
      const end = resolveReferences(input.endImageColumn ? [row[input.endImageColumn]] : [], assets);
      const references = resolveReferences(
        (input.referenceImageColumns || []).map(column => row[column]),
        assets,
      );
      const audios = resolveReferences(
        (input.referenceAudioColumns || []).map(column => row[column]),
        assets,
      );
      const controls = { ...(request.defaultControls || {}) };
      for (const [key, column] of Object.entries(request.perCaseControlColumns || {})) {
        const value = row[column];
        if (value !== undefined && value !== null && text(value) !== '') controls[key] = value;
      }
      for (const definition of model.controls) {
        if (controls[definition.key] !== undefined) {
          controls[definition.key] = coerceControl(controls[definition.key], definition);
        }
      }
      const rawExtraInputs = Object.fromEntries([
        ...(input.extraInputColumns || []).map(column => [column, parseStructured(row[column])]),
        ...Object.entries(input.extraInputMappings || {}).map(([key, column]) => [key, parseStructured(row[column])]),
      ]);
      if (input.lyricsOrDialogueColumn) {
        rawExtraInputs.lyrics_or_dialogue = row[input.lyricsOrDialogueColumn];
      }
      const extraInputs: Record<string, unknown> = {};
      const extraInputIssues: PreflightIssue[] = [];
      for (const [key, value] of Object.entries(rawExtraInputs)) {
        const resolved = resolveStructuredAssets(value, assets, key);
        extraInputs[key] = resolved.value;
        extraInputIssues.push(...resolved.issues);
      }
      const prompt = input.promptColumn ? text(row[input.promptColumn]) : '';
      const seed = request.seedMode === 'fixed'
        ? Number(request.fixedSeed ?? 42)
        : request.seedMode === 'column' && request.seedColumn
          ? Number(row[request.seedColumn]) || deriveSeed(`${dataset.id}:${caseId}:${prompt}`)
          : deriveSeed(`${dataset.id}:${caseId}:${request.targetColumn}:${prompt}`);

      const resolvedCase: GenerationCase = {
        caseId,
        datasetItemId,
        rowIndex,
        prompt,
        imageUrls: Array.from(new Set([...start.urls, ...end.urls, ...references.urls])),
        audioUrls: audios.urls,
        controls,
        seed,
        extraInputs,
      };
      return {
        resolvedCase,
        preparationIssues: [...start.issues, ...end.issues, ...references.issues, ...audios.issues, ...extraInputIssues],
      };
    });
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

  const dataset = await getDatasetVersion(request.datasetId, Number(request.datasetVersion));
  if (!dataset) throw notFound('Dataset version');
  const model = await aionGenerationClient.getModel(request.modelName);
  if (!model) throw notFound('Enabled Aion model');

  const requestedAssetIds = Array.from(new Set((request.assetBindings || []).map(asset => String(asset.id))));
  const verifiedAssets = await getGenerationAssetsForPreflight(requestedAssetIds, request.datasetId, user);
  if (verifiedAssets.length !== requestedAssetIds.length) {
    const verifiedIds = new Set(verifiedAssets.map(asset => asset.id));
    throw badRequest('One or more uploaded assets are unavailable for this dataset and user.', {
      assetIds: requestedAssetIds.filter(assetId => !verifiedIds.has(assetId)),
    });
  }
  request = { ...request, assetBindings: verifiedAssets };

  const prepared = buildCases(dataset, request, model);
  if (!prepared.length) throw badRequest('No dataset cases were selected.');
  if (prepared.length > serverConfig.generationMaxBatchSize) {
    throw badRequest(`A generation batch is limited to ${serverConfig.generationMaxBatchSize} cases.`);
  }

  const cases = prepared.map(({ resolvedCase, preparationIssues }) => {
    const result = preflightGenerationCase(model, resolvedCase);
    const sourceRow = dataset.items[resolvedCase.rowIndex] || {};
    const targetValue = text(sourceRow[request.targetColumn]);
    const errors = [...preparationIssues, ...result.errors];
    if (targetValue) {
      errors.push({
        code: 'TARGET_NOT_EMPTY',
        field: request.targetColumn,
        message: `The target column already contains a result for case ${resolvedCase.caseId}.`,
      });
    }
    if (!resolvedCase.datasetItemId) {
      errors.push({
        code: 'MISSING_STABLE_ITEM_ID',
        message: `The case has no stable dataset item ID: ${resolvedCase.caseId}.`,
      });
    }
    return {
      ...result,
      valid: errors.length === 0,
      errors,
      resolvedCase: result.resolvedCase,
    };
  });

  const validCount = cases.filter(item => item.valid).length;
  const invalidCount = cases.length - validCount;
  const costEstimate = estimateGenerationCost(model, cases.filter(item => item.valid).map(item => item.resolvedCase));
  const requestHash = fingerprintConfig({
    datasetId: request.datasetId,
    datasetVersion: request.datasetVersion,
    modelName: request.modelName,
    configFingerprint: model.configFingerprint,
    targetColumn: request.targetColumn.trim(),
    inputMapping: request.inputMapping,
    defaultControls: request.defaultControls || {},
    perCaseControlColumns: request.perCaseControlColumns || {},
    retryOfJobId: request.retryOfJobId,
    seedMode: request.seedMode,
    fixedSeed: request.fixedSeed,
    seedColumn: request.seedColumn,
    selectedDatasetItemIds: request.selectedDatasetItemIds || [],
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
