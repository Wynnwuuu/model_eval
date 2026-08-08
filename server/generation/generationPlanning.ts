import { createHash } from 'node:crypto';

import {
  getGenerationReferenceVideoSupport,
  supportsGenerationMode,
  type GenerationMode,
} from '../../src/features/generation/modelCapabilities.ts';
import type {
  VidMuseAudioInput,
  VidMuseInputBindings,
  VidMusePrompt,
} from '../../src/features/generation/vidmuseInputContract.ts';
import { isForceableRelativeGenerationAsset } from '../../src/features/generation/vidmuseInputContract.ts';
import type {
  GenerationAdvancedParameterDefinition,
  GenerationCaseReview,
  GenerationContractFinding,
  GenerationInvalidParameterDefinition,
  GenerationParameterAuditEntry,
  GenerationSeedMode,
} from '../../src/types.ts';
import type { GenerationContentIntentAudit } from './generationContentMapping.ts';
import type { GenerationModelValidationOverride } from './generationValidationPolicy.ts';

export type GenerationModality = 'image' | 'video';

export type GenerationControl = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'toggle' | 'json';
  options?: string[];
  defaultValue?: string | number | boolean;
  unit?: string;
};

export type NormalizedGenerationModel = {
  id: string;
  configId: string;
  modelName: string;
  displayName: string;
  description: string;
  provider: string;
  outputModality: GenerationModality;
  previewType: GenerationModality;
  capabilities: string[];
  supportsSeed: boolean;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  supportedDurations: Array<string | number>;
  controls: GenerationControl[];
  advancedParameters: GenerationAdvancedParameterDefinition[];
  invalidParameters: GenerationInvalidParameterDefinition[];
  inputSchema?: Record<string, any>;
  options: Record<string, any>;
  priceItems: Array<Record<string, any>>;
  costItems: Array<Record<string, any>>;
  configFingerprint: string;
  updatedAt?: string;
};

export type GenerationCase = {
  caseId: string;
  datasetItemId: string;
  rowIndex: number;
  prompt?: VidMusePrompt;
  imageUrls: string[];
  audioUrls: string[];
  audioInputs?: VidMuseAudioInput[];
  videoUrls?: string[];
  controls: Record<string, any>;
  compilerAudit?: {
    compilerVersion: string;
    profileId?: string;
    modelDescription?: string;
    effectiveGenerationType?: string;
    intent?: GenerationContentIntentAudit;
    compatibilityApplied: boolean;
    originalInput: Record<string, unknown>;
    compiledInput: Record<string, unknown>;
    mcpToolInput?: Record<string, unknown>;
    projectionDiff?: GenerationProjectionDiff[];
    bindings: VidMuseInputBindings;
    finalAionRequest?: Record<string, unknown>;
    contractFindings?: GenerationContractFinding[];
    appliedFindingIds?: string[];
    reviewedFindingIds?: string[];
    contractSource?: Record<string, unknown>;
    review?: GenerationCaseReview;
    overrideAudit?: {
      forced: boolean;
      reason?: string;
      actorId: string;
      actorName: string;
      reviewedAt: number;
      originalRequest: Record<string, unknown>;
      finalRequest: Record<string, unknown>;
      bypassedRules: string[];
      configFingerprint: string;
    };
  };
  parameterAudit?: Record<string, GenerationParameterAuditEntry>;
  durationResolution?: {
    source: 'uniform' | 'column' | 'reference_audio';
    column?: string;
    audioUrl?: string;
    detectedSeconds?: number;
    resolvedDuration: number;
  };
  seed?: number;
  seedMode?: GenerationSeedMode;
  seedPolicyVersion?: 2;
  extraInputs?: Record<string, any>;
  generationType?: string;
};

export type PreflightIssue = {
  code: string;
  message: string;
  field?: string;
};

export type PreflightCaseResult = {
  valid: boolean;
  generationType: string;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  resolvedCase: GenerationCase & { generationType: string };
};

export type GenerationImageRoleInputs = {
  referenceUrls: string[];
  startUrls: string[];
  endUrls: string[];
};

export type ResolvedGenerationImageInputs = {
  imageUrls: string[];
  generationType?: 'reference_to_video' | 'image_to_video' | 'images_to_video';
  issues: PreflightIssue[];
};

const uniqueUrls = (values: string[]) => Array.from(new Set(values));

export const resolveGenerationImageInputs = (
  outputModality: GenerationModality,
  input: GenerationImageRoleInputs,
): ResolvedGenerationImageInputs => {
  const referenceUrls = uniqueUrls(input.referenceUrls);
  const startUrls = uniqueUrls(input.startUrls);
  const endUrls = uniqueUrls(input.endUrls);

  if (outputModality === 'image') {
    return {
      imageUrls: uniqueUrls([...startUrls, ...endUrls, ...referenceUrls]),
      issues: [],
    };
  }

  const issues: PreflightIssue[] = [];
  if (startUrls.length > 1) {
    issues.push({
      code: 'INVALID_IMAGE_ROLE_COUNT',
      field: 'startImageColumn',
      message: 'A case can contain only one start-frame image.',
    });
  }
  if (endUrls.length > 1) {
    issues.push({
      code: 'INVALID_IMAGE_ROLE_COUNT',
      field: 'endImageColumn',
      message: 'A case can contain only one end-frame image.',
    });
  }

  const hasReference = referenceUrls.length > 0;
  const hasStart = startUrls.length > 0;
  const hasEnd = endUrls.length > 0;
  if (hasEnd && !hasStart) {
    issues.push({
      code: 'MISSING_START_IMAGE',
      field: 'startImageColumn',
      message: 'An end-frame image requires a start-frame image in the same case.',
    });
  }
  if (hasReference && (hasStart || hasEnd)) {
    issues.push({
      code: 'CONFLICTING_IMAGE_ROLES',
      field: 'referenceImageColumns',
      message: 'A case cannot mix reference images with start/end keyframes.',
    });
  }

  if (hasStart || hasEnd) {
    return {
      imageUrls: [...startUrls, ...endUrls, ...referenceUrls],
      generationType: hasEnd ? 'images_to_video' : 'image_to_video',
      issues,
    };
  }
  if (hasReference) {
    return {
      imageUrls: referenceUrls,
      generationType: 'reference_to_video',
      issues,
    };
  }
  return { imageUrls: [], issues };
};

export type CompiledGenerationReferenceVideoInputs = {
  videoUrls: string[];
  extraInputs: Record<string, any>;
  generationType?: 'reference_to_video';
  issues: PreflightIssue[];
};

const hasConfiguredValue = (value: unknown) =>
  value !== undefined
  && value !== null
  && value !== ''
  && (!Array.isArray(value) || value.length > 0);

export const compileGenerationReferenceVideoInputs = (
  model: NormalizedGenerationModel,
  rawVideoUrls: string[],
  rawElements?: unknown,
): CompiledGenerationReferenceVideoInputs => {
  const videoUrls = uniqueUrls(rawVideoUrls);
  const issues: PreflightIssue[] = [];
  if (!videoUrls.length) return { videoUrls, extraInputs: {}, issues };

  if (hasConfiguredValue(rawElements)) {
    issues.push({
      code: 'CONFLICTING_REFERENCE_VIDEO_INPUTS',
      field: 'referenceVideoColumns',
      message: 'A case cannot combine reference-video columns with a raw elements JSON column.',
    });
    return { videoUrls, extraInputs: {}, generationType: 'reference_to_video', issues };
  }

  const support = getGenerationReferenceVideoSupport(model);
  if (!support.supported) {
    issues.push({
      code: 'REFERENCE_VIDEO_NOT_SUPPORTED',
      field: 'referenceVideoColumns',
      message: 'The live model configuration does not verify simple reference-video input support.',
    });
    return { videoUrls, extraInputs: {}, generationType: 'reference_to_video', issues };
  }
  if (videoUrls.length < support.min || (support.max !== undefined && videoUrls.length > support.max)) {
    const range = support.max === undefined ? `at least ${support.min}` : `${support.min}-${support.max}`;
    issues.push({
      code: 'REFERENCE_VIDEO_COUNT_OUT_OF_RANGE',
      field: 'referenceVideoColumns',
      message: `Reference video count ${videoUrls.length} is outside the supported range ${range}.`,
    });
  }

  const extraInputs = support.strategy === 'elements'
    ? { elements: videoUrls.map(video_url => ({ video_url })) }
    : support.strategy === 'single_field'
      ? { [support.field]: videoUrls[0] }
      : { [support.field]: videoUrls };
  return {
    videoUrls,
    extraInputs,
    generationType: 'reference_to_video',
    issues,
  };
};
const STANDARD_CONTROLS: Record<string, Omit<GenerationControl, 'key'>> = {
  aspect_ratio: { label: 'Aspect ratio', type: 'select' },
  resolution: { label: 'Resolution', type: 'select' },
  duration: { label: 'Duration', type: 'select', unit: 's' },
  generate_audio: { label: 'Generate audio', type: 'toggle', defaultValue: false },
  negative_prompt: { label: 'Negative prompt', type: 'text' },
  guidance_scale: { label: 'Guidance scale', type: 'number' },
  safety_tolerance: { label: 'Safety tolerance', type: 'number' },
  watermark: { label: 'Watermark', type: 'toggle', defaultValue: false },
  keep_original_sound: { label: 'Keep original sound', type: 'toggle' },
  num_images: { label: 'Image count', type: 'number', defaultValue: 1 },
  seed: { label: 'Seed', type: 'number' },
};

export const KNOWN_INVALID_GENERATION_PARAMETERS: Record<string, Omit<GenerationInvalidParameterDefinition, 'key'>> = {
  reference_image_urls: {
    label: 'reference image urls',
    message: 'Top-level reference_image_urls is not consumed by the Aion video request contract.',
    replacement: 'Use elements[].reference_image_urls inside the elements MCP field.',
  },
  multi_shots: {
    label: 'multi shots',
    message: 'multi_shots is not a VidMuse MCP or Aion unified video request field.',
    replacement: 'Use prompt: [{ "prompt": "...", "duration": 3 }] for multi-shot input.',
  },
};

const SPECIALIZED_PARAMETER_KEYS = new Set(['seed']);
const RESERVED_PARAMETER_KEYS = new Set([
  'model_name',
  'generation_type',
  'features',
  'extra_params',
]);

const OPTION_KEYS: Record<string, string[]> = {
  aspect_ratio: ['aspect_ratio_options', 'aspect_ratios', 'supported_aspect_ratios'],
  resolution: ['resolution_options', 'resolutions', 'supported_resolutions'],
  duration: ['duration_options', 'durations', 'supported_durations'],
};

const DEFAULT_KEYS: Record<string, string[]> = {
  aspect_ratio: ['default_aspect_ratio', 'aspect_ratio_default', 'aspect_ratio'],
  resolution: ['default_resolution', 'resolution_default', 'resolution'],
  duration: ['default_duration', 'duration_default', 'duration'],
};

const stableValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
};

export const stableJson = (value: unknown) => JSON.stringify(stableValue(value));

export const fingerprintConfig = (value: unknown) =>
  createHash('sha256').update(stableJson(value)).digest('hex');

export const MAX_PORTABLE_GENERATION_SEED = 0x7fffffff;

export const deriveGenerationSeed = (value: string) =>
  Number.parseInt(fingerprintConfig(value).slice(0, 8), 16) & MAX_PORTABLE_GENERATION_SEED;

export const generationSeedIssue = (value: unknown): PreflightIssue | undefined => {
  const seed = Number(value);
  if (Number.isInteger(seed) && seed >= 0 && seed <= MAX_PORTABLE_GENERATION_SEED) return undefined;
  return {
    code: 'INVALID_SEED',
    field: 'seed',
    message: `Seed must be an integer between 0 and ${MAX_PORTABLE_GENERATION_SEED}.`,
  };
};

const valueArray = (value: unknown): Array<string | number> =>
  Array.isArray(value)
    ? value.filter(item => typeof item === 'string' || typeof item === 'number')
    : [];

const firstOptionArray = (options: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const values = valueArray(options[key]);
    if (values.length) return values;
  }
  return [];
};

const firstDefined = (options: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    if (options[key] !== undefined && options[key] !== null) return options[key];
  }
  return undefined;
};

const normalizeCapabilities = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, any>)
    .filter(([, enabled]) => enabled === true || (Array.isArray(enabled) && enabled.length > 0))
    .map(([key]) => key);
};

const supportedParams = (options: Record<string, any>) => {
  const values = options.supported_params || options.supportedParams;
  return new Set(Array.isArray(values) ? values.map(String) : []);
};

export const generationOptionsSupportSeed = (options: Record<string, any> | undefined) =>
  Boolean(options && Array.isArray(options.supported_params) && options.supported_params.includes('seed'));

const parameterSchemaProperties = (options: Record<string, any>): Record<string, any> => {
  for (const candidate of [options.parameter_schema, options.params_schema, options.parameters_schema]) {
    if (candidate?.properties && typeof candidate.properties === 'object') return candidate.properties;
  }
  return {};
};

const STANDARD_INPUT_PARAMS = new Set([
  'prompt',
  'image_urls',
  'images',
  'audio_url',
  'audios',
  'video_url',
  'video_urls',
  'reference_video_urls',
  'elements',
  'generation_type',
]);

const normalizeInputSchema = (raw: Record<string, any>, options: Record<string, any>) => {
  const explicit = raw.input_schema || raw.inputSchema || options.input_schema || options.inputSchema;
  if (explicit && typeof explicit === 'object') return explicit;
  const requiredInputs = options.required_params || options.requiredParams;
  const requiredOneOfInputs = options.required_one_of_params || options.requiredOneOfParams;
  const unsupportedInputs = options.unsupported_inputs || options.unsupportedInputs;
  const supportedInputs = Array.from(supportedParams(options))
    .filter((key: string) => STANDARD_INPUT_PARAMS.has(key));
  if (!requiredInputs && !requiredOneOfInputs && !unsupportedInputs && !supportedInputs.length) return undefined;
  return {
    ...(requiredInputs ? { required_inputs: requiredInputs } : {}),
    ...(requiredOneOfInputs ? { required_one_of_inputs: requiredOneOfInputs } : {}),
    ...(unsupportedInputs ? { unsupported_inputs: unsupportedInputs } : {}),
    ...(supportedInputs.length ? { supported_inputs: Array.from(new Set(supportedInputs)) } : {}),
  };
};

const controlFor = (key: string, options: Record<string, any>): GenerationControl => {
  const schema = parameterSchemaProperties(options)[key] || {};
  const inferredType: GenerationControl['type'] = Array.isArray(schema.enum)
    ? 'select'
    : schema.type === 'number' || schema.type === 'integer'
      ? 'number'
      : schema.type === 'boolean'
        ? 'toggle'
        : schema.type === 'object' || schema.type === 'array'
          ? 'json'
          : key.endsWith('_json') || key === 'extra_params'
            ? 'json'
            : 'text';
  const standard = STANDARD_CONTROLS[key];
  const base = standard
    ? {
        ...standard,
        ...(schema.type || Array.isArray(schema.enum) ? { type: inferredType } : {}),
      }
    : {
        label: key.replaceAll('_', ' '),
        type: inferredType,
      };
  const configuredOptions = OPTION_KEYS[key] ? firstOptionArray(options, OPTION_KEYS[key]) : [];
  const optionValues = Array.isArray(schema.enum) ? schema.enum : configuredOptions;
  const configuredDefault = DEFAULT_KEYS[key] ? firstDefined(options, DEFAULT_KEYS[key]) : base.defaultValue;
  const defaultValue = schema.default ?? configuredDefault;
  return {
    key,
    ...base,
    label: String(schema.title || base.label),
    ...(optionValues.length
      ? { type: 'select' as const, options: optionValues.map(String), defaultValue: defaultValue ?? optionValues[0] }
      : defaultValue !== undefined
        ? { defaultValue }
        : {}),
  };
};

export const normalizeAionModelConfig = (raw: Record<string, any>): NormalizedGenerationModel => {
  const modelName = String(raw.name || raw.model_name || raw.modelName || '');
  const modelType = String(raw.model_type || raw.modelType || raw.type || raw.sub_type || raw.subType || '').toLowerCase();
  if (modelType !== 'image' && modelType !== 'video') {
    throw new Error(`Unsupported generation model type: ${modelType || 'unknown'}`);
  }
  const options = raw.options && typeof raw.options === 'object' ? raw.options : {};
  if (!modelName) throw new Error('Aion model config has no model name.');
  const inputSchema = normalizeInputSchema(raw, options);
  const priceItems = Array.isArray(raw.price_items) ? raw.price_items : Array.isArray(raw.priceItems) ? raw.priceItems : [];
  const costItems = Array.isArray(raw.cost_items) ? raw.cost_items : Array.isArray(raw.costItems) ? raw.costItems : [];
  const updatedAt = raw.update_time || raw.updateTime || raw.updated_at || raw.updatedAt;
  const params = supportedParams(options);
  const schemaProperties = parameterSchemaProperties(options);
  const normalizedParamKeys = Array.from(params).map(key => key.replace(/_options$/, ''));
  const invalidParameters = Object.entries(KNOWN_INVALID_GENERATION_PARAMETERS)
    .filter(([key]) => normalizedParamKeys.includes(key) || Object.prototype.hasOwnProperty.call(schemaProperties, key))
    .map(([key, definition]) => ({ key, ...definition }));
  const invalidKeys = new Set(invalidParameters.map(parameter => parameter.key));
  const controlKeys = [
    ...normalizedParamKeys.filter(key => Boolean(STANDARD_CONTROLS[key])),
    ...Object.keys(schemaProperties).filter(key => Boolean(STANDARD_CONTROLS[key])),
  ];
  for (const key of Object.keys(STANDARD_CONTROLS)) {
    if (OPTION_KEYS[key]?.some(optionKey => valueArray(options[optionKey]).length)) controlKeys.push(key);
  }
  const controls = Array.from(new Set(controlKeys))
    .filter(key => !STANDARD_INPUT_PARAMS.has(key))
    .filter(key => !RESERVED_PARAMETER_KEYS.has(key))
    .filter(key => !SPECIALIZED_PARAMETER_KEYS.has(key))
    .filter(key => !invalidKeys.has(key))
    .map(key => controlFor(key, options));
  const controlKeySet = new Set(controls.map(control => control.key));
  const advancedParameters = Array.from(new Set([
    ...normalizedParamKeys,
    ...Object.keys(schemaProperties),
  ]))
    .filter(key => !STANDARD_INPUT_PARAMS.has(key))
    .filter(key => !RESERVED_PARAMETER_KEYS.has(key))
    .filter(key => !SPECIALIZED_PARAMETER_KEYS.has(key))
    .filter(key => !invalidKeys.has(key))
    .filter(key => !controlKeySet.has(key))
    .map(key => ({
      key,
      label: key.replaceAll('_', ' '),
      verified: false as const,
      destination: 'extra_params' as const,
    }));

  const fingerprintSource = {
    id: raw.id,
    name: modelName,
    model_type: modelType,
    provider: raw.provider,
    capabilities: raw.capabilities,
    options,
    input_schema: inputSchema,
    price_items: priceItems,
    cost_items: costItems,
    update_time: updatedAt,
  };

  return {
    id: modelName,
    configId: String(raw.id || raw.configId || modelName),
    modelName,
    displayName: String(raw.display_name || raw.displayName || modelName),
    description: String(raw.description || ''),
    provider: String(raw.provider || ''),
    outputModality: modelType,
    previewType: modelType,
    capabilities: normalizeCapabilities(raw.capabilities),
    supportsSeed: generationOptionsSupportSeed(options),
    supportedAspectRatios: firstOptionArray(options, OPTION_KEYS.aspect_ratio).map(String),
    supportedResolutions: firstOptionArray(options, OPTION_KEYS.resolution).map(String),
    supportedDurations: firstOptionArray(options, OPTION_KEYS.duration),
    controls,
    advancedParameters,
    invalidParameters,
    inputSchema,
    options,
    priceItems,
    costItems,
    configFingerprint: fingerprintConfig(fingerprintSource),
    updatedAt: updatedAt ? String(updatedAt) : undefined,
  };
};

const isUsableAssetUrl = (value: string) => {
  if (/^asset:\/\/[a-zA-Z0-9_-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const hasCapability = (model: NormalizedGenerationModel, names: string[]) => {
  if (!model.capabilities.length) return true;
  const normalized = new Set(model.capabilities.map(item => item.toLowerCase().replaceAll('-', '_')));
  return names.some(name => normalized.has(name) || normalized.has(name.replaceAll('_to_', '2')));
};

const resolveGenerationType = (model: NormalizedGenerationModel, item: GenerationCase) => {
  if (model.outputModality === 'image') {
    if (item.generationType) return item.generationType;
    return item.imageUrls.length ? 'image_to_image' : 'text_to_image';
  }
  if (item.generationType) return item.generationType;
  if (item.videoUrls?.length || item.extraInputs?.elements) return 'reference_to_video';
  if (item.imageUrls.length >= 2 && supportsGenerationMode(model, 'images_to_video')) {
    return 'images_to_video';
  }
  if (item.imageUrls.length) return 'image_to_video';
  return 'text_to_video';
};

const modeCandidates = (mode: string) => [
  '*',
  mode,
  mode.replaceAll('_to_', '2'),
  mode.replaceAll('_', ''),
];

const RESERVED_EXTRA_INPUT_KEYS = new Set([
  'model_name',
  'prompt',
  'image_urls',
  'audio_url',
  'audios',
  'elements',
  'generation_type',
  'features',
  'extra_params',
]);

const safeExtraInputs = (item: GenerationCase) => Object.fromEntries(
  Object.entries(item.extraInputs || {}).filter(([key]) => !RESERVED_EXTRA_INPUT_KEYS.has(key)),
);

const configuredInputKeys = (model: NormalizedGenerationModel) => {
  const schema = model.inputSchema;
  const keys = new Set<string>();
  if (!schema || typeof schema !== 'object') return keys;
  Object.keys(schema.properties || {}).forEach(key => keys.add(key));
  for (const field of ['required_inputs', 'optional_inputs']) {
    const declaration = schema[field];
    if (Array.isArray(declaration)) declaration.forEach(key => keys.add(String(key)));
    else if (declaration && typeof declaration === 'object') {
      Object.values(declaration).forEach(value => {
        if (Array.isArray(value)) value.forEach(key => keys.add(String(key)));
      });
    }
  }
  const oneOf = schema.required_one_of_inputs;
  if (oneOf && typeof oneOf === 'object') {
    Object.values(oneOf).forEach(value => {
      if (!Array.isArray(value)) return;
      value.flatMap(group => Array.isArray(group) ? group : [group]).forEach(key => keys.add(String(key)));
    });
  }
  if (Array.isArray(schema.supported_inputs)) {
    schema.supported_inputs.forEach((key: unknown) => keys.add(String(key)));
  }
  return keys;
};

const configuredExtraInputs = (model: NormalizedGenerationModel, item: GenerationCase) => {
  const keys = configuredInputKeys(model);
  return Object.fromEntries(Object.entries(safeExtraInputs(item)).filter(([key]) => keys.has(key)));
};

const promptInputFor = (item: GenerationCase) => {
  if (typeof item.prompt === 'string') return item.prompt.trim() || undefined;
  return item.prompt?.length ? item.prompt : undefined;
};

const supportsStructuredAudios = (model: NormalizedGenerationModel) =>
  supportedParams(model.options).has('audios') || configuredInputKeys(model).has('audios');

const audioInputsFor = (model: NormalizedGenerationModel, item: GenerationCase) => {
  const structured = item.audioInputs?.length
    ? item.audioInputs
    : item.audioUrls.map(url => ({ url }));
  if (!structured.length) return {};
  if (item.compilerAudit?.compilerVersion === '3') return { audios: structured };
  if (supportsStructuredAudios(model)) return { audios: structured };
  return { audio_url: structured[0].url };
};

const suppliedInputs = (
  model: NormalizedGenerationModel,
  item: GenerationCase,
  generationType: string,
) => ({
  ...safeExtraInputs(item),
  prompt: promptInputFor(item),
  image_urls: item.imageUrls.length ? item.imageUrls : undefined,
  elements: item.extraInputs?.elements,
  ...audioInputsFor(model, item),
  generation_type: generationType,
});

export const preflightGenerationCase = (
  model: NormalizedGenerationModel,
  item: GenerationCase,
  validation: GenerationModelValidationOverride = {},
): PreflightCaseResult => {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];
  const generationType = resolveGenerationType(model, item);
  const resolvedCase = { ...item, generationType };
  const inputs = suppliedInputs(model, item, generationType);
  const hasReferenceVideos = Boolean(item.videoUrls?.length);
  const hasRawElements = hasConfiguredValue(item.extraInputs?.elements);

  if (!item.compilerAudit
    && (item.generationType === 'image_to_video' || item.generationType === 'images_to_video')
    && (hasReferenceVideos || hasRawElements)) {
    errors.push({
      code: 'CONFLICTING_VIDEO_AND_KEYFRAMES',
      field: 'videoUrls',
      message: 'A case cannot combine start/end keyframes with reference videos or raw elements.',
    });
  }

  for (const [kind, urls] of [
    ['image', item.imageUrls],
    ['audio', item.audioUrls],
    ['video', item.videoUrls || []],
  ] as const) {
    urls.forEach((url, index) => {
      if (item.compilerAudit?.compilerVersion === '3' && isForceableRelativeGenerationAsset(url)) return;
      if (!isUsableAssetUrl(url)) {
        errors.push({
          code: 'INVALID_ASSET_URL',
          field: `${kind}Urls[${index}]`,
          message: `Asset must be an http(s) URL or uploaded asset reference: ${url}`,
        });
      }
    });
  }

  const configuredInputs = configuredInputKeys(model);
  const explicitlySupported = new Set(
    Array.isArray(model.inputSchema?.supported_inputs)
      ? model.inputSchema.supported_inputs.map(String)
      : [],
  );
  for (const key of ['image_urls', 'elements', 'audios']) {
    const value = (inputs as Record<string, unknown>)[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    const supportedAlias = (item.compilerAudit?.compilerVersion !== '3'
      && key === 'audios' && explicitlySupported.has('audio_url'))
      || (key === 'image_urls' && model.outputModality === 'image'
        && explicitlySupported.has('images'));
    if (explicitlySupported.size && !explicitlySupported.has(key) && !supportedAlias) {
      errors.push({
        code: 'UNSUPPORTED_INPUT',
        field: key,
        message: `The live model configuration does not declare input: ${key}.`,
      });
    }
  }
  for (const key of Object.keys(safeExtraInputs(item))) {
    if (configuredInputs.has(key)) continue;
    errors.push({
      code: 'UNSUPPORTED_INPUT',
      field: key,
      message: `The live model configuration does not declare input: ${key}.`,
    });
  }

  const structuredAudiosSupported = supportsStructuredAudios(model);
  const audioInputCount = item.audioInputs?.length || item.audioUrls.length;
  if (audioInputCount > 1 && !structuredAudiosSupported) {
    errors.push({
      code: 'MULTIPLE_AUDIOS_REQUIRE_AUDIOS',
      field: 'audios',
      message: 'Multiple audio references require the structured audios input; this model only accepts one audio_url.',
    });
  }
  if (item.audioInputs?.some(audio => audio.range) && !structuredAudiosSupported) {
    errors.push({
      code: 'AUDIO_RANGE_REQUIRES_AUDIOS',
      field: 'audios',
      message: 'Audio ranges require the structured audios input; this model only accepts a single audio_url.',
    });
  }

  const validateInputCount = (inputKey: string, optionKey: string) => {
    const value = (inputs as Record<string, any>)[inputKey];
    if (value === undefined) return;
    const range = valueArray(model.options[optionKey]).map(Number);
    if (range.length < 2 || !range.every(Number.isFinite)) return;
    const count = Array.isArray(value) ? value.length : 1;
    if (count < range[0] || count > range[1]) {
      errors.push({
        code: 'INPUT_COUNT_OUT_OF_RANGE',
        field: inputKey,
        message: `${inputKey} count ${count} is outside the supported range ${range[0]}-${range[1]}.`,
      });
    }
  };
  validateInputCount('image_urls', 'image_urls_count_range');
  validateInputCount('audios', 'audios_count_range');
  validateInputCount('elements', 'elements_count_range');

  const elementReferenceRange = valueArray(model.options['element.reference_image_urls_count_range']).map(Number);
  const elements = (inputs as Record<string, any>).elements;
  if (Array.isArray(elements) && elementReferenceRange.length >= 2 && elementReferenceRange.every(Number.isFinite)) {
    elements.forEach((element, index) => {
      const references = Array.isArray(element?.reference_image_urls) ? element.reference_image_urls : [];
      if (references.length < elementReferenceRange[0] || references.length > elementReferenceRange[1]) {
        errors.push({
          code: 'INPUT_COUNT_OUT_OF_RANGE',
          field: `elements[${index}].reference_image_urls`,
          message: `Element reference image count ${references.length} is outside the supported range ${elementReferenceRange[0]}-${elementReferenceRange[1]}.`,
        });
      }
    });
  }

  if (model.outputModality === 'image' && !inputs.prompt) {
    errors.push({ code: 'MISSING_REQUIRED_INPUT', field: 'prompt', message: 'Image generation requires a prompt.' });
  }
  if (model.outputModality === 'video' && generationType === 'text_to_video' && !inputs.prompt) {
    errors.push({ code: 'MISSING_REQUIRED_INPUT', field: 'prompt', message: 'Text-to-video generation requires a prompt.' });
  }
  if (inputs.prompt && validation.promptMaxLength) {
    const promptLength = Array.from(String(inputs.prompt)).length;
    if (promptLength > validation.promptMaxLength) {
      errors.push({
        code: 'PROMPT_TOO_LONG',
        field: 'prompt',
        message: `Prompt length ${promptLength} exceeds the supported maximum ${validation.promptMaxLength}.`,
      });
    }
  }
  const effectiveGenerationType = item.compilerAudit?.effectiveGenerationType;
  const validationGenerationTypes = Array.from(new Set([
    generationType,
    ...(effectiveGenerationType ? [effectiveGenerationType] : []),
  ]));

  const schema = model.inputSchema;
  if (schema && typeof schema === 'object') {
    const unsupported = new Set(Array.isArray(schema.unsupported_inputs) ? schema.unsupported_inputs.map(String) : []);
    for (const [key, value] of Object.entries(inputs)) {
      if (value !== undefined && unsupported.has(key)) {
        errors.push({ code: 'UNSUPPORTED_INPUT', field: key, message: `The model configuration rejects input: ${key}.` });
      }
    }
    const required = schema.required_inputs && typeof schema.required_inputs === 'object'
      ? schema.required_inputs as Record<string, string[]>
      : {};
    const requiredOneOf = schema.required_one_of_inputs && typeof schema.required_one_of_inputs === 'object'
      ? schema.required_one_of_inputs as Record<string, string[][]>
      : {};
    const hasResolvedInput = (key: string) => {
      if (key === 'images') return (inputs as Record<string, any>).image_urls !== undefined;
      return (inputs as Record<string, any>)[key] !== undefined
        || item.controls[key] !== undefined;
    };
    for (const mode of Array.from(new Set(validationGenerationTypes.flatMap(modeCandidates)))) {
      for (const key of required[mode] || []) {
        if (!hasResolvedInput(key)) {
          errors.push({ code: 'MISSING_REQUIRED_INPUT', field: key, message: `${generationType} requires input: ${key}.` });
        }
      }
      for (const group of requiredOneOf[mode] || []) {
        if (!group.some(hasResolvedInput)) {
          errors.push({
            code: 'MISSING_REQUIRED_INPUT',
            field: group.join('|'),
            message: `${generationType} requires one of: ${group.join(' / ')}.`,
          });
        }
      }
    }
  }

  if (model.outputModality === 'video') {
    const standardModes = new Set<GenerationMode>([
      'text_to_video',
      'image_to_video',
      'images_to_video',
      'reference_to_video',
    ]);
    const supported = validationGenerationTypes.some(mode =>
      standardModes.has(mode as GenerationMode)
        ? supportsGenerationMode(model, mode as GenerationMode)
        : hasCapability(model, [mode]),
    );
    if (!supported) {
      errors.push({
        code: 'UNSUPPORTED_GENERATION_TYPE',
        field: 'generationType',
        message: `The model does not advertise support for ${generationType}.`,
      });
    }
  }

  for (const control of model.controls) {
    const value = item.controls[control.key];
    if (value === undefined || value === null || value === '') continue;
    if (control.options?.length && !control.options.map(String).includes(String(value))) {
      errors.push({
        code: 'UNSUPPORTED_CONTROL_VALUE',
        field: control.key,
        message: `${control.label} does not support value ${String(value)}.`,
      });
    }
    if (control.type === 'number') {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) {
        errors.push({ code: 'INVALID_CONTROL_VALUE', field: control.key, message: `${control.label} must be numeric.` });
      } else {
        const property = parameterSchemaProperties(model.options)[control.key] || {};
        const minimum = Number(property.minimum ?? property.min);
        const maximum = Number(property.maximum ?? property.max);
        if (Number.isFinite(minimum) && numberValue < minimum) {
          errors.push({ code: 'CONTROL_OUT_OF_RANGE', field: control.key, message: `${control.label} must be at least ${minimum}.` });
        }
        if (Number.isFinite(maximum) && numberValue > maximum) {
          errors.push({ code: 'CONTROL_OUT_OF_RANGE', field: control.key, message: `${control.label} must be at most ${maximum}.` });
        }
      }
    }
  }

  return { valid: errors.length === 0, generationType, errors, warnings, resolvedCase };
};

const compactObject = (value: Record<string, any>) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item !== undefined && item !== null && item !== '' && (!Array.isArray(item) || item.length > 0)));

const IMAGE_FIELDS = new Set([
  'aspect_ratio',
  'resolution',
  'negative_prompt',
  'num_images',
  'guidance_scale',
  'safety_tolerance',
]);
const VIDEO_FIELDS = new Set([
  'duration',
  'aspect_ratio',
  'resolution',
  'generate_audio',
  'negative_prompt',
  'guidance_scale',
  'keep_original_sound',
  'safety_tolerance',
  'preview',
  'watermark',
  'watermark_url',
]);

const MCP_VIDEO_CONTROL_FIELDS = [
  'duration',
  'aspect_ratio',
  'resolution',
  'generate_audio',
  'negative_prompt',
] as const;

export type GenerationProjectionDiff = {
  field: string;
  mcpValue?: unknown;
  aionValue?: unknown;
};

export const buildMcpToolInput = (
  model: NormalizedGenerationModel,
  item: GenerationCase,
) => {
  if (model.outputModality === 'image') {
    return compactObject({
      model_name: model.modelName,
      prompt: promptInputFor(item),
      images: item.imageUrls,
      ...Object.fromEntries(MCP_VIDEO_CONTROL_FIELDS
        .filter(key => item.controls?.[key] !== undefined)
        .map(key => [key, item.controls[key]])),
    });
  }
  const audios = item.audioInputs?.length
    ? item.audioInputs
    : item.audioUrls.map(url => ({ url }));
  return compactObject({
    model_name: model.modelName,
    prompt: promptInputFor(item),
    image_urls: item.imageUrls,
    elements: item.extraInputs?.elements,
    audios,
    ...Object.fromEntries(MCP_VIDEO_CONTROL_FIELDS
      .filter(key => item.controls?.[key] !== undefined)
      .map(key => [key, item.controls[key]])),
  });
};

export const generationRequestProjectionDiff = (
  model: NormalizedGenerationModel,
  mcpToolInput: Record<string, unknown>,
  aionRequest: Record<string, unknown>,
) => {
  const fieldMappings = model.outputModality === 'image'
    ? [
        ['model_name', 'model_name'],
        ['prompt', 'prompt'],
        ['images', 'image_urls'],
        ...MCP_VIDEO_CONTROL_FIELDS.map(key => [key, key]),
      ]
    : [
        ['model_name', 'model_name'],
        ['prompt', 'prompt'],
        ['image_urls', 'image_urls'],
        ['elements', 'elements'],
        ['audios', 'audios'],
        ...MCP_VIDEO_CONTROL_FIELDS.map(key => [key, key]),
      ];
  return fieldMappings.flatMap(([mcpField, aionField]) => {
    const mcpValue = mcpToolInput[mcpField];
    const aionValue = aionRequest[aionField];
    if (stableJson(mcpValue) === stableJson(aionValue)) return [];
    return [{ field: mcpField, mcpValue, aionValue }];
  });
};

export const buildAionGenerationRequest = (
  model: NormalizedGenerationModel,
  item: GenerationCase & { generationType: string },
) => {
  if (item.compilerAudit?.overrideAudit?.finalRequest) {
    return {
      path: model.outputModality === 'image'
        ? '/model/api/v1/model/generate-image'
        : '/model/api/v1/model/generate-video',
      body: item.compilerAudit.overrideAudit.finalRequest,
    };
  }
  const standardFields = model.outputModality === 'image' ? IMAGE_FIELDS : VIDEO_FIELDS;
  const standardControls: Record<string, any> = {};
  const extraParams: Record<string, any> = {};
  const params = supportedParams(model.options);

  for (const [key, value] of Object.entries(item.controls || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (standardFields.has(key)) standardControls[key] = value;
    else extraParams[key] = value;
  }
  const mappedExtraParams = item.extraInputs?.extra_params || {};
  if (item.seedPolicyVersion === 2 && mappedExtraParams.seed !== undefined) {
    throw new Error('Seed cannot be supplied through extra_params; use the dedicated Seed strategy.');
  }
  Object.assign(extraParams, mappedExtraParams);
  if (item.seed !== undefined) {
    if (item.seedPolicyVersion === 2 ? model.supportsSeed : params.has('seed')) extraParams.seed = item.seed;
    else if (item.seedPolicyVersion === 2) {
      throw new Error(`Model ${model.modelName} does not declare Seed support in options.supported_params.`);
    }
  }
  const customInputs = configuredExtraInputs(model, item);
  const audioInputs = audioInputsFor(model, item);

  if (model.outputModality === 'image') {
    return {
      path: '/model/api/v1/model/generate-image',
      body: compactObject({
        ...customInputs,
        model_name: model.modelName,
        prompt: promptInputFor(item),
        image_urls: item.imageUrls,
        ...standardControls,
        features: {},
        extra_params: compactObject(extraParams),
      }),
    };
  }

  return {
    path: '/model/api/v1/model/generate-video',
    body: compactObject({
      ...customInputs,
      generation_type: item.generationType,
      model_name: model.modelName,
      prompt: promptInputFor(item),
      image_urls: item.imageUrls,
      elements: item.extraInputs?.elements,
      ...audioInputs,
      ...standardControls,
      features: { auto_adjust_duration_to_supported: false },
      extra_params: compactObject(extraParams),
    }),
  };
};

export const estimateGenerationCost = (
  model: NormalizedGenerationModel,
  validCasesOrCount: number | GenerationCase[],
) => {
  const cases = Array.isArray(validCasesOrCount) ? validCasesOrCount : [];
  const validCaseCount = Array.isArray(validCasesOrCount) ? validCasesOrCount.length : validCasesOrCount;
  if (!validCaseCount) {
    return { known: true, totalCredits: 0, unitCredits: 0, unitLabel: 'case', source: 'empty' };
  }

  const directRates = model.priceItems.flatMap(item => {
    const unit = String(item.unit || item.billing_unit || item.billingUnit || '').toLowerCase();
    const credits = Number(item.credits ?? item.credit ?? (typeof item.price === 'number' ? item.price : undefined));
    return Number.isFinite(credits) && credits >= 0 && ['generation', 'image', 'images', 'video', 'request'].includes(unit)
      ? [credits]
      : [];
  });
  if (directRates.length) {
    const unitCredits = Math.max(...directRates);
    return {
      known: true,
      totalCredits: unitCredits * validCaseCount,
      unitCredits,
      unitLabel: 'case',
      source: { strategy: 'maximum-direct-rate', priceItems: model.priceItems },
    };
  }

  const outputRates = (units: string[]) => model.priceItems.flatMap(item => {
    const unit = String(item.unit_type || item.unitType || '').toLowerCase();
    const credits = Number(item.price?.output ?? item.output_price ?? item.outputPrice);
    return Number.isFinite(credits) && credits >= 0 && units.includes(unit) ? [credits] : [];
  });
  if (model.outputModality === 'video') {
    const rates = outputRates(['second', 'seconds']);
    const durations = cases.map(item => Number(item.controls?.duration));
    if (rates.length && cases.length && durations.every(duration => Number.isFinite(duration) && duration > 0)) {
      const unitCredits = Math.max(...rates);
      return {
        known: true,
        totalCredits: durations.reduce((sum, duration) => sum + duration, 0) * unitCredits,
        unitCredits,
        unitLabel: 'second (upper rate)',
        source: { strategy: 'maximum-second-rate', priceItems: model.priceItems },
      };
    }
  } else {
    const rates = outputRates(['image', 'images']);
    if (rates.length) {
      const unitCredits = Math.max(...rates);
      const imageCount = cases.length
        ? cases.reduce((sum, item) => sum + Math.max(1, Number(item.controls?.num_images) || 1), 0)
        : validCaseCount;
      return {
        known: true,
        totalCredits: imageCount * unitCredits,
        unitCredits,
        unitLabel: 'image (upper rate)',
        source: { strategy: 'maximum-image-rate', priceItems: model.priceItems },
      };
    }
  }
  return {
    known: false,
    totalCredits: null,
    unitCredits: null,
    unitLabel: 'unknown',
    source: model.priceItems,
  };
};

export type UploadedAssetCandidate = {
  id: string;
  relativePath: string;
  fileName: string;
};

const normalizeAssetPath = (value: string) =>
  value.trim()
    .replace(/^file:\/\//i, '')
    .replace(/^[a-zA-Z]:/, '')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .toLowerCase();

export const matchUploadedAsset = (reference: string, assets: UploadedAssetCandidate[]) => {
  const normalized = normalizeAssetPath(reference);
  const exact = assets.filter(asset => normalizeAssetPath(asset.relativePath) === normalized);
  if (exact.length === 1) return { assetId: exact[0].id };
  if (exact.length > 1) {
    return { errorCode: 'AMBIGUOUS_ASSET', message: `Multiple uploaded assets match relative path: ${reference}` };
  }
  const basename = normalized.split('/').at(-1);
  const byName = assets.filter(asset => normalizeAssetPath(asset.fileName) === basename);
  if (byName.length === 1) return { assetId: byName[0].id };
  if (byName.length > 1) {
    return { errorCode: 'AMBIGUOUS_ASSET', message: `File name is ambiguous; use the CSV relative path: ${reference}` };
  }
  return { errorCode: 'MISSING_ASSET', message: `Uploaded asset was not found: ${reference}` };
};
