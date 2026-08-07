import type {
  GenerationCaseReview,
  GenerationContractFinding,
} from '../../types.js';
import {
  pluginMixedInputFinding,
  reviewedPluginPromptFindings,
  VIDMUSE_PLUGIN_RULE_SNAPSHOT,
} from './vidmusePluginContracts.js';

export const VIDMUSE_INPUT_COMPILER_VERSION = '1';
export const VIDMUSE_INPUT_COMPILER_VERSION_V2 = '2';
export const VIDMUSE_INPUT_COMPILER_VERSION_V3 = '3';

export type VidMuseGenerationIssue = {
  code: string;
  message: string;
  field?: string;
};

export type VidMuseVideoMultiPromptItem = {
  prompt: string;
  duration: number;
};

export type VidMuseVideoElement = {
  reference_image_urls?: string[];
  frontal_image_url?: string;
  video_url?: string;
  element_id?: number;
};

export type VidMuseAudioInput = {
  url: string;
  range?: [number, number];
};

export type VidMusePrompt = string | VidMuseVideoMultiPromptItem[];
export type VidMuseMappingMode = 'assisted' | 'mcp';
export type VidMusePromptFormat = 'text' | 'multi_prompt_json' | 'typed';
export type VidMuseCompatibilityMode = 'strict' | 'reference_fallback';

export type VidMuseCompilerModel = {
  modelName: string;
  outputModality: 'image' | 'video';
  capabilities?: string[];
  inputSchema?: Record<string, unknown>;
  options?: Record<string, unknown>;
};

export type VidMuseCanonicalInput = Record<string, unknown> & {
  prompt?: VidMusePrompt;
  image_urls?: string[];
  images?: string[];
  elements?: VidMuseVideoElement[];
  audios?: VidMuseAudioInput[];
};

export type VidMuseInputBindings = {
  images: Array<{ index: number; url: string }>;
  elements: Array<{ index: number; element: VidMuseVideoElement }>;
  audios: Array<{ index: number; audio: VidMuseAudioInput }>;
};

export type VidMuseCompileResult = {
  compilerVersion: string;
  profileId?: 'seedance-2' | 'hailuo-h3' | 'wan3';
  input: VidMuseCanonicalInput;
  originalInput: VidMuseCanonicalInput;
  generationType: string;
  effectiveGenerationType?: string;
  compatibilityApplied: boolean;
  bindings: VidMuseInputBindings;
  errors: VidMuseGenerationIssue[];
  warnings: VidMuseGenerationIssue[];
  contractFindings?: GenerationContractFinding[];
  appliedFindingIds?: string[];
  reviewedFindingIds?: string[];
  contractSource?: {
    mcpRevision: number;
    pluginSnapshot: typeof VIDMUSE_PLUGIN_RULE_SNAPSHOT;
  };
};

type AssistedInput = {
  prompt?: unknown;
  startImageUrls?: string[];
  endImageUrls?: string[];
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudios?: unknown[];
  existingElements?: unknown;
  extraInputs?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseJson = (value: string) => {
  try {
    return { value: JSON.parse(value) as unknown };
  } catch {
    return { error: true as const };
  }
};

const parseStructuredValue = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('[') && !trimmed.startsWith('{'))) return value;
  const parsed = parseJson(trimmed);
  return parsed.error ? value : parsed.value;
};

const flattenAudioInputs = (values: unknown[]): unknown[] => values.flatMap(value => {
  const parsed = parseStructuredValue(value);
  if (Array.isArray(parsed)) return flattenAudioInputs(parsed);
  if (typeof parsed === 'string' && parsed.trim()) return [{ url: parsed.trim() }];
  return parsed == null || parsed === '' ? [] : [parsed];
});

const normalizeElementsForAssistedInput = (value: unknown): unknown[] => {
  const parsed = parseStructuredValue(value);
  if (Array.isArray(parsed)) return parsed;
  return parsed == null || parsed === '' ? [] : [parsed];
};

export const buildAssistedVidMuseInput = (input: AssistedInput): VidMuseCanonicalInput => ({
  ...(input.extraInputs || {}),
  prompt: input.prompt as VidMusePrompt | undefined,
  image_urls: [...(input.startImageUrls || []), ...(input.endImageUrls || [])],
  elements: [
    ...normalizeElementsForAssistedInput(input.existingElements),
    ...(input.referenceImageUrls || []).map(frontal_image_url => ({ frontal_image_url })),
    ...(input.referenceVideoUrls || []).map(video_url => ({ video_url })),
  ] as VidMuseVideoElement[],
  audios: flattenAudioInputs(input.referenceAudios || []) as VidMuseAudioInput[],
});

const addIssue = (
  issues: VidMuseGenerationIssue[],
  code: string,
  field: string,
  message: string,
) => {
  if (issues.some(issue => issue.code === code && issue.field === field && issue.message === message)) return;
  issues.push({ code, field, message });
};

export const isForceableRelativeGenerationAsset = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^online-mining\/[A-Za-z0-9._~!$&'()+,;=@%/-]+$/i.test(trimmed)
    && !/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)
    && !trimmed.includes('\\');
};

const isUsableAssetUrl = (value: unknown, allowRelative = false) =>
  typeof value === 'string' && (
    /^(?:https?:\/\/|asset:\/\/)[^\s]+$/i.test(value.trim())
    || (allowRelative && isForceableRelativeGenerationAsset(value))
  );

const normalizeUrlArray = (
  value: unknown,
  field: string,
  errors: VidMuseGenerationIssue[],
  allowSingleString: boolean,
  allowRelative = false,
) => {
  if (value == null || value === '') return [] as string[];
  let parsed = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [] as string[];
    if (trimmed.startsWith('[')) {
      const result = parseJson(trimmed);
      if (result.error) {
        addIssue(errors, 'INVALID_STRUCTURED_INPUT', field, `${field} must contain a valid JSON array.`);
        return [] as string[];
      }
      parsed = result.value;
    } else if (allowSingleString) {
      parsed = [trimmed];
    }
  }
  if (!Array.isArray(parsed)) {
    addIssue(errors, 'INVALID_STRUCTURED_INPUT', field, `${field} must be an array.`);
    return [] as string[];
  }
  return parsed.flatMap((entry, index) => {
    if (!isUsableAssetUrl(entry, allowRelative)) {
      addIssue(errors, 'INVALID_ASSET_URL', `${field}[${index}]`, `${field} entries must be HTTP(S) or uploaded asset URLs.`);
      return [];
    }
    return [String(entry).trim()];
  });
};

const normalizePrompt = (
  value: unknown,
  errors: VidMuseGenerationIssue[],
  options: { contractVersion: 1 | 2 | 3; format?: VidMusePromptFormat },
): VidMusePrompt | undefined => {
  if (value == null || value === '') return undefined;
  let parsed = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (options.contractVersion >= 2 && options.format === 'text') return trimmed;
    if (options.contractVersion >= 2 && options.format === 'multi_prompt_json') {
      const result = parseJson(trimmed);
      if (result.error) {
        addIssue(errors, 'INVALID_PROMPT_JSON', 'prompt', 'Multi-shot Prompt must contain a valid JSON array.');
        return undefined;
      }
      parsed = result.value;
    } else if (options.contractVersion >= 2 && options.format === 'typed') {
      if (!trimmed.startsWith('[')) return trimmed;
      const result = parseJson(trimmed);
      if (result.error) {
        addIssue(errors, 'INVALID_PROMPT_JSON', 'prompt', 'Typed Prompt must contain valid JSON when it uses an array value.');
        return undefined;
      }
      parsed = result.value;
    } else {
      if (!trimmed.startsWith('[')) return trimmed;
      const result = parseJson(trimmed);
      if (result.error) return trimmed;
      parsed = result.value;
    }
  } else if (options.contractVersion >= 2 && options.format === 'text') {
    addIssue(errors, 'INVALID_PROMPT', 'prompt', 'Plain-text Prompt must be a string.');
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    addIssue(errors, 'INVALID_PROMPT', 'prompt', 'Prompt must be text or an array of multi-shot prompt items.');
    return undefined;
  }
  const prompts: VidMuseVideoMultiPromptItem[] = [];
  parsed.forEach((entry, index) => {
    if (!isRecord(entry)) {
      addIssue(errors, 'INVALID_PROMPT_ITEM', `prompt[${index}]`, 'Each multi-shot prompt item must be an object.');
      return;
    }
    const unknownKeys = Object.keys(entry).filter(key => !['prompt', 'duration'].includes(key));
    if (unknownKeys.length) {
      addIssue(errors, 'UNKNOWN_PROMPT_FIELD', `prompt[${index}]`, `Unsupported prompt fields: ${unknownKeys.join(', ')}.`);
    }
    const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : '';
    const duration = Number(entry.duration);
    const validDuration = Number.isFinite(duration) && duration > 0
      && (options.contractVersion >= 2 || Number.isInteger(duration));
    if (!prompt || !validDuration) {
      addIssue(errors, 'INVALID_PROMPT_ITEM', `prompt[${index}]`, `Each multi-shot item requires non-empty prompt text and a positive ${options.contractVersion >= 2 ? 'finite' : 'integer'} duration.`);
      return;
    }
    prompts.push({ prompt, duration });
  });
  return prompts;
};

const normalizeStructuredArray = (
  value: unknown,
  field: 'elements' | 'audios',
  errors: VidMuseGenerationIssue[],
) => {
  if (value == null || value === '') return [] as unknown[];
  let parsed = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [] as unknown[];
    const result = parseJson(trimmed);
    if (result.error) {
      addIssue(errors, 'INVALID_STRUCTURED_INPUT', field, `${field} must contain a valid JSON array.`);
      return [] as unknown[];
    }
    parsed = result.value;
  }
  if (!Array.isArray(parsed)) {
    addIssue(errors, 'INVALID_STRUCTURED_INPUT', field, `${field} must be an array.`);
    return [] as unknown[];
  }
  return parsed;
};

const normalizeElements = (
  value: unknown,
  errors: VidMuseGenerationIssue[],
  allowRelative = false,
) =>
  normalizeStructuredArray(value, 'elements', errors).flatMap((entry, index) => {
    if (!isRecord(entry)) {
      addIssue(errors, 'INVALID_ELEMENT', `elements[${index}]`, 'Each element must be an object.');
      return [];
    }
    const allowed = ['reference_image_urls', 'frontal_image_url', 'video_url', 'element_id'];
    const unknownKeys = Object.keys(entry).filter(key => !allowed.includes(key));
    if (unknownKeys.length) {
      addIssue(errors, 'UNKNOWN_ELEMENT_FIELD', `elements[${index}]`, `Unsupported element fields: ${unknownKeys.join(', ')}.`);
    }
    const references = normalizeUrlArray(entry.reference_image_urls, `elements[${index}].reference_image_urls`, errors, false, allowRelative);
    const frontal = entry.frontal_image_url == null || entry.frontal_image_url === ''
      ? undefined
      : isUsableAssetUrl(entry.frontal_image_url, allowRelative)
        ? String(entry.frontal_image_url).trim()
        : undefined;
    if (entry.frontal_image_url && !frontal) {
      addIssue(errors, 'INVALID_ASSET_URL', `elements[${index}].frontal_image_url`, 'Element frontal image must be an HTTP(S) or uploaded asset URL.');
    }
    const video = entry.video_url == null || entry.video_url === ''
      ? undefined
      : isUsableAssetUrl(entry.video_url, allowRelative)
        ? String(entry.video_url).trim()
        : undefined;
    if (entry.video_url && !video) {
      addIssue(errors, 'INVALID_ASSET_URL', `elements[${index}].video_url`, 'Element video must be an HTTP(S) or uploaded asset URL.');
    }
    const elementId = entry.element_id == null || entry.element_id === '' ? undefined : Number(entry.element_id);
    if (entry.element_id != null && (!Number.isInteger(elementId) || Number(elementId) < 0)) {
      addIssue(errors, 'INVALID_ELEMENT_ID', `elements[${index}].element_id`, 'element_id must be a non-negative integer.');
    }
    const imageMode = Boolean(frontal || references.length);
    const modeCount = Number(imageMode) + Number(Boolean(video)) + Number(elementId !== undefined && Number.isInteger(elementId));
    if (modeCount !== 1) {
      addIssue(errors, 'INVALID_ELEMENT_MODE', `elements[${index}]`, 'Each element must use exactly one image, video, or existing element-ID mode.');
    }
    return [{
      ...(references.length ? { reference_image_urls: references } : {}),
      ...(frontal ? { frontal_image_url: frontal } : {}),
      ...(video ? { video_url: video } : {}),
      ...(elementId !== undefined && Number.isInteger(elementId) ? { element_id: elementId } : {}),
    } as VidMuseVideoElement];
  });

const normalizeAudios = (
  value: unknown,
  errors: VidMuseGenerationIssue[],
  options: { preserveRangePrecision: boolean; allowRelative?: boolean },
) =>
  normalizeStructuredArray(value, 'audios', errors).flatMap((entry, index) => {
    if (!isRecord(entry)) {
      addIssue(errors, 'INVALID_AUDIO_INPUT', `audios[${index}]`, 'Each audio input must be an object with a URL.');
      return [];
    }
    const unknownKeys = Object.keys(entry).filter(key => !['url', 'range'].includes(key));
    if (unknownKeys.length) {
      addIssue(errors, 'UNKNOWN_AUDIO_FIELD', `audios[${index}]`, `Unsupported audio fields: ${unknownKeys.join(', ')}.`);
    }
    if (!isUsableAssetUrl(entry.url, options.allowRelative)) {
      addIssue(errors, 'INVALID_ASSET_URL', `audios[${index}].url`, 'Audio URL must be an HTTP(S) or uploaded asset URL.');
      return [];
    }
    let range: [number, number] | undefined;
    if (entry.range != null) {
      const values = Array.isArray(entry.range) ? entry.range.map(Number) : [];
      if (values.length !== 2 || !values.every(Number.isFinite) || values[0] < 0 || values[1] <= values[0]) {
        addIssue(errors, 'INVALID_AUDIO_RANGE', `audios[${index}].range`, 'Audio range must be [start, end] with 0 <= start < end.');
      } else {
        range = options.preserveRangePrecision
          ? [values[0], values[1]]
          : [Math.round(values[0] * 100) / 100, Math.round(values[1] * 100) / 100];
      }
    }
    return [{ url: String(entry.url).trim(), ...(range ? { range } : {}) } as VidMuseAudioInput];
  });

const promptTexts = (prompt?: VidMusePrompt) => typeof prompt === 'string'
  ? [prompt]
  : (prompt || []).map(item => item.prompt);

const mapPromptText = (prompt: VidMusePrompt | undefined, mapper: (value: string) => string) => {
  if (typeof prompt === 'string') return mapper(prompt);
  if (Array.isArray(prompt)) return prompt.map(item => ({ ...item, prompt: mapper(item.prompt) }));
  return prompt;
};

const detectProfile = (modelName: string): VidMuseCompileResult['profileId'] => {
  const normalized = modelName.toLowerCase();
  if (normalized.includes('seedance')) return 'seedance-2';
  if (normalized.includes('hailuo-h3') || /hailuo.*h3/.test(normalized)) return 'hailuo-h3';
  if (normalized.includes('wan3') || normalized.includes('wan3.0') || /wan[-_/]?3/.test(normalized)) return 'wan3';
  return undefined;
};

const cloneInput = (value: VidMuseCanonicalInput): VidMuseCanonicalInput =>
  JSON.parse(JSON.stringify(value)) as VidMuseCanonicalInput;

const mediaCategoryCount = (input: VidMuseCanonicalInput) => [
  (input.image_urls || input.images || []).length > 0,
  (input.elements || []).length > 0,
  (input.audios || []).length > 0,
].filter(Boolean).length;

const validatePromptBindings = (
  input: VidMuseCanonicalInput,
  errors: VidMuseGenerationIssue[],
  warnings: VidMuseGenerationIssue[],
  contractVersion: 1 | 2 | 3,
  supportedKinds?: Array<'image' | 'Element' | 'audio'>,
) => {
  const allLimits = contractVersion === 2
    ? {
        Image: (input.image_urls || input.images || []).length,
        Element: (input.elements || []).length,
      }
    : {
        image: (input.image_urls || input.images || []).length,
        Element: (input.elements || []).length,
        audio: (input.audios || []).length,
      };
  const limits = Object.fromEntries(Object.entries(allLimits).filter(([kind]) =>
    !supportedKinds || supportedKinds.includes(kind as 'image' | 'Element' | 'audio')));
  const seen = Object.fromEntries(
    Object.keys(limits).map(kind => [kind, new Set<number>()]),
  ) as Record<string, Set<number>>;
  const pattern = contractVersion === 2
    ? /@(Image|Element)(\d+)/g
    : /@(image|Element|audio)(\d+)/g;
  for (const text of promptTexts(input.prompt)) {
    for (const match of text.matchAll(pattern)) {
      const kind = match[1];
      if (!(kind in limits)) continue;
      const index = Number(match[2]);
      seen[kind].add(index);
      if (index < 1 || index > limits[kind]) {
        addIssue(errors, 'PROMPT_REFERENCE_OUT_OF_RANGE', 'prompt', `${match[0]} does not match any submitted ${kind} input.`);
      }
    }
  }
  Object.keys(limits).forEach(kind => {
    for (let index = 1; index <= limits[kind]; index += 1) {
      if (seen[kind].has(index)) continue;
      const token = `@${kind}${index}`;
      addIssue(
        warnings,
        'UNREFERENCED_PROMPT_ASSET',
        'prompt',
        `${token} is submitted but not referenced by the prompt.`,
      );
    }
  });
};

const reviewedPromptTokenKinds = (model: VidMuseCompilerModel) => {
  if (model.outputModality !== 'video') return [] as Array<'image' | 'Element' | 'audio'>;
  const supportedInputs = [
    ...(Array.isArray(model.inputSchema?.supported_inputs) ? model.inputSchema.supported_inputs : []),
    ...(Array.isArray(model.options?.supported_params) ? model.options.supported_params : []),
  ].map(value => String(value).trim());
  const declared = new Set(supportedInputs);
  return [
    ...(declared.has('image_urls') ? ['image' as const] : []),
    ...(declared.has('elements') ? ['Element' as const] : []),
    ...(declared.has('audios') ? ['audio' as const] : []),
  ];
};

const modeDeclaration = (
  schema: Record<string, unknown> | undefined,
  field: 'required_inputs' | 'required_one_of_inputs',
  mode: string,
) => {
  const declaration = schema?.[field];
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) return [] as unknown[];
  const record = declaration as Record<string, unknown>;
  return Array.isArray(record[mode]) ? record[mode] as unknown[] : [];
};

const explicitlySupportsAudioOnlyReference = (model: VidMuseCompilerModel) => {
  const required = modeDeclaration(model.inputSchema, 'required_inputs', 'reference_to_video').map(String);
  const oneOf = modeDeclaration(model.inputSchema, 'required_one_of_inputs', 'reference_to_video');
  const audioKeys = new Set(['audios', 'audio_url']);
  const requiresNonAudioMedia = required.some(key => ['image_urls', 'images', 'elements', 'video_url'].includes(key));
  const audioAlternative = oneOf.some(group => {
    const keys = (Array.isArray(group) ? group : [group]).map(String);
    return keys.length > 0 && keys.every(key => audioKeys.has(key));
  });
  return !requiresNonAudioMedia && (required.some(key => audioKeys.has(key)) || audioAlternative);
};

const relativeAssetFindings = (input: VidMuseCanonicalInput): GenerationContractFinding[] => {
  const references = [
    ...(input.image_urls || input.images || []),
    ...(input.elements || []).flatMap(element => [
      element.frontal_image_url,
      element.video_url,
      ...(element.reference_image_urls || []),
    ]),
    ...(input.audios || []).map(audio => audio.url),
  ].filter(isForceableRelativeGenerationAsset);
  return references.map((reference, index) => ({
    id: `mcp-relative-asset-${index + 1}`,
    ruleId: 'mcp.asset.relative-reference',
    code: 'RELATIVE_ASSET_REQUIRES_REVIEW',
    field: 'audios',
    message: `Relative asset ${String(reference)} cannot be verified by ManuEval and will be sent unchanged only with a force confirmation.`,
    source: 'mcp_revision_1813',
    sourceVersion: '1813',
    disposition: 'force_required',
  }));
};

const findingReviewState = (review?: GenerationCaseReview): {
  accepted: Set<string>;
  rejected: Set<string>;
} => ({
  accepted: new Set(review?.acceptedFindingIds || []),
  rejected: new Set(review?.rejectedFindingIds || []),
});

export const compileVidMuseGenerationInput = ({
  model,
  input: rawInput,
  compatibilityMode = 'strict',
  contractVersion = 1,
  promptFormat,
  review,
}: {
  model: VidMuseCompilerModel;
  input: Record<string, unknown>;
  compatibilityMode?: VidMuseCompatibilityMode;
  contractVersion?: 1 | 2 | 3;
  promptFormat?: VidMusePromptFormat;
  review?: GenerationCaseReview;
}): VidMuseCompileResult => {
  const errors: VidMuseGenerationIssue[] = [];
  const warnings: VidMuseGenerationIssue[] = [];
  const effectiveRawInput: Record<string, unknown> = review?.promptOverride !== undefined
    ? { ...rawInput, prompt: review.promptOverride }
    : rawInput;
  for (const reserved of ['model_name', 'generation_type']) {
    if (effectiveRawInput[reserved] != null && effectiveRawInput[reserved] !== '') {
      addIssue(errors, 'RESERVED_MCP_INPUT', reserved, `${reserved} is controlled by the generation batch and cannot be mapped from a dataset.`);
    }
  }

  const prompt = normalizePrompt(effectiveRawInput.prompt, errors, { contractVersion, format: promptFormat });
  const imageField = model.outputModality === 'image' ? 'images' : 'image_urls';
  const imageValue = model.outputModality === 'image'
    ? effectiveRawInput.images ?? effectiveRawInput.image_urls
    : effectiveRawInput.image_urls;
  const allowRelative = contractVersion === 3;
  const imageUrls = normalizeUrlArray(imageValue, imageField, errors, true, allowRelative);
  const elements = model.outputModality === 'video'
    ? normalizeElements(effectiveRawInput.elements, errors, allowRelative)
    : [];
  const audios = model.outputModality === 'video'
    ? normalizeAudios(effectiveRawInput.audios, errors, {
        preserveRangePrecision: contractVersion >= 2,
        allowRelative,
      })
    : [];
  const input: VidMuseCanonicalInput = {
    ...Object.fromEntries(Object.entries(effectiveRawInput).filter(([key, value]) =>
      !['model_name', 'generation_type', 'prompt', 'image_urls', 'images', 'elements', 'audios'].includes(key)
      && value !== undefined && value !== null && value !== '')),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(model.outputModality === 'image' ? { images: imageUrls } : { image_urls: imageUrls, elements, audios }),
  };
  const originalInput = cloneInput(input);
  const profileId = contractVersion === 3 ? undefined : detectProfile(model.modelName);
  let compatibilityApplied = false;

  const hasFrames = model.outputModality === 'video' && imageUrls.length > 0;
  const hasReferenceMedia = elements.length > 0 || audios.length > 0;
  const separatesFrames = profileId === 'seedance-2' || profileId === 'hailuo-h3';
  const contractFindings: GenerationContractFinding[] = [];
  const appliedFindingIds: string[] = [];
  const reviewState = findingReviewState(review);
  if (contractVersion >= 2 && model.outputModality === 'video' && imageUrls.length > 2) {
    addIssue(errors, 'MCP_KEYFRAME_COUNT_EXCEEDED', 'image_urls', 'VidMuse MCP image_urls is the keyframe channel and accepts at most a first and last frame.');
  }
  if (contractVersion === 3) {
    contractFindings.push(...relativeAssetFindings(input));
    contractFindings.push(...reviewedPluginPromptFindings({
      prompt: input.prompt,
      imageCount: imageUrls.length,
      elementCount: elements.length,
    }));
    if (hasFrames && hasReferenceMedia) {
      contractFindings.push(pluginMixedInputFinding({ input, prompt: input.prompt }));
    }

    for (const finding of contractFindings) {
      const accepted = reviewState.accepted.has(finding.id);
      const rejected = reviewState.rejected.has(finding.id);
      if (accepted && finding.proposal?.kind === 'prompt_rewrite') {
        input.prompt = finding.proposal.prompt as VidMusePrompt | undefined;
        appliedFindingIds.push(finding.id);
      }
      if (accepted && finding.proposal?.kind === 'keyframes_to_elements' && finding.proposal.compiledInput) {
        Object.keys(input).forEach(key => delete input[key]);
        Object.assign(input, cloneInput(finding.proposal.compiledInput as VidMuseCanonicalInput));
        compatibilityApplied = true;
        appliedFindingIds.push(finding.id);
      }
      if (finding.disposition === 'force_required') {
        addIssue(errors, finding.code, finding.field || 'input', finding.message);
      } else if (!accepted && !rejected) {
        addIssue(errors, 'CONTRACT_REVIEW_REQUIRED', finding.field || 'input', finding.message);
      } else if (rejected && finding.proposal?.kind === 'keyframes_to_elements') {
        addIssue(errors, 'GENERATION_TYPE_REVIEW_REQUIRED', 'generation_type', 'The mixed-input proposal was rejected, so a reviewed final Aion request is required before this case has a generation mode.');
      }
    }
  } else if (contractVersion === 2 && hasFrames && hasReferenceMedia) {
    addIssue(errors, 'MCP_INPUT_MODE_CONFLICT', 'image_urls', 'Keyframes cannot be combined with reference elements or audios in one VidMuse MCP generation mode.');
  } else if (contractVersion === 1 && hasFrames && hasReferenceMedia && separatesFrames) {
    if (compatibilityMode !== 'reference_fallback') {
      addIssue(errors, 'MODEL_INPUT_CONFLICT', 'image_urls', `${model.modelName} cannot combine keyframes with elements or audios.`);
    } else {
      const baseIndex = elements.length;
      input.elements = [
        ...elements,
        ...imageUrls.map(frontal_image_url => ({ frontal_image_url })),
      ];
      input.image_urls = [];
      input.prompt = mapPromptText(prompt, value => value.replace(/@image(\d+)/g, (token, rawIndex) => {
        const index = Number(rawIndex);
        return index >= 1 && index <= imageUrls.length ? `@Element${baseIndex + index}` : token;
      }));
      compatibilityApplied = true;
      const referencedElements = new Set(
        promptTexts(input.prompt).flatMap(value =>
          Array.from(value.matchAll(/@Element(\d+)/g), match => Number(match[1]))),
      );
      const unreferencedFrames = imageUrls
        .map((_, index) => baseIndex + index + 1)
        .filter(index => !referencedElements.has(index));
      if (unreferencedFrames.length) {
        addIssue(
          warnings,
          'COMPATIBILITY_FRAME_USAGE_UNCLEAR',
          'prompt',
          `Converted frame reference(s) ${unreferencedFrames.map(index => `@Element${index}`).join(', ')} are not explicitly used by the prompt.`,
        );
      }
      addIssue(warnings, 'COMPATIBILITY_REFERENCE_FALLBACK', 'image_urls', 'Keyframes were converted to reference elements; the request no longer uses true keyframe constraints.');
    }
  }

  if (contractVersion === 1
    && (profileId === 'seedance-2' || profileId === 'hailuo-h3')
    && Array.isArray(input.elements)) {
    input.elements.forEach((element, index) => {
      const imageCount = Number(Boolean(element.frontal_image_url)) + (element.reference_image_urls?.length || 0);
      if (imageCount > 1) {
        addIssue(errors, 'MODEL_ELEMENT_IMAGE_LIMIT', `elements[${index}]`, `${model.modelName} supports one image per reference element.`);
      }
    });
  }
  if (contractVersion === 1 && profileId === 'seedance-2' && Array.isArray(input.prompt)) {
    addIssue(errors, 'MODEL_PROMPT_SHAPE_UNSUPPORTED', 'prompt', 'Seedance multi-shot input must be compiled into one prompt string.');
  }
  if (contractVersion === 1
    && (profileId === 'hailuo-h3' || profileId === 'wan3')
    && (input.audios || []).length
    && !(input.image_urls || []).length
    && !(input.elements || []).length) {
    addIssue(errors, 'AUDIO_ONLY_NOT_SUPPORTED', 'audios', `${model.modelName} does not accept reference audio without image or video reference media.`);
  }
  if (contractVersion === 1 && !profileId && mediaCategoryCount(input) > 1) {
    addIssue(warnings, 'UNVERIFIED_MODEL_COMBINATION', 'model_name', 'This multi-modal combination passed the generic contract but has no ManuEval model-specific compatibility profile.');
  }

  if (contractVersion <= 2) {
    validatePromptBindings(input, errors, warnings, contractVersion);
  } else {
    const supportedTokenKinds = reviewedPromptTokenKinds(model);
    if (supportedTokenKinds.length) {
      validatePromptBindings(input, errors, warnings, contractVersion, supportedTokenKinds);
    }
  }
  const finalImages = input.image_urls || input.images || [];
  const finalElements = input.elements || [];
  const finalAudios = input.audios || [];
  const unresolvedMixedInput = model.outputModality === 'video'
    && finalImages.length > 0
    && (finalElements.length > 0 || finalAudios.length > 0);
  const unresolvedAudioOnly = model.outputModality === 'video'
    && !finalImages.length
    && !finalElements.length
    && finalAudios.length > 0
    && !explicitlySupportsAudioOnlyReference(model);
  if (contractVersion === 3 && unresolvedAudioOnly) {
    const finding: GenerationContractFinding = {
      id: 'aion-audio-only-mode-review',
      ruleId: 'aion.config.audio-only-reference',
      code: 'AUDIO_ONLY_MODE_REVIEW_REQUIRED',
      field: 'audios',
      message: 'The live structured model contract does not explicitly establish audio-only reference generation. Review and force a final Aion request to continue.',
      source: 'aion_live_config',
      sourceVersion: model.modelName,
      disposition: 'force_required',
    };
    contractFindings.push(finding);
    addIssue(errors, finding.code, finding.field || 'audios', finding.message);
  }
  const overrideGenerationType = typeof review?.finalAionRequest?.generation_type === 'string'
    ? review.finalAionRequest.generation_type.trim()
    : '';
  const generationType = overrideGenerationType || (model.outputModality === 'image'
    ? finalImages.length ? 'image_to_image' : 'text_to_image'
    : unresolvedMixedInput || unresolvedAudioOnly
      ? 'manual_review'
    : finalElements.length || finalAudios.length
      ? 'reference_to_video'
      : finalImages.length >= 2
        ? 'images_to_video'
        : finalImages.length === 1
          ? 'image_to_video'
          : 'text_to_video');
  const effectiveGenerationType = contractVersion === 2
    && generationType === 'images_to_video'
    && (profileId === 'hailuo-h3' || profileId === 'wan3')
    ? 'image_to_video'
    : undefined;

  return {
    compilerVersion: contractVersion === 3
      ? VIDMUSE_INPUT_COMPILER_VERSION_V3
      : contractVersion === 2
        ? VIDMUSE_INPUT_COMPILER_VERSION_V2
        : VIDMUSE_INPUT_COMPILER_VERSION,
    profileId,
    input,
    originalInput,
    generationType,
    ...(effectiveGenerationType ? { effectiveGenerationType } : {}),
    compatibilityApplied,
    bindings: {
      images: finalImages.map((url, index) => ({ index: index + 1, url })),
      elements: finalElements.map((element, index) => ({ index: index + 1, element })),
      audios: finalAudios.map((audio, index) => ({ index: index + 1, audio })),
    },
    errors,
    warnings,
    ...(contractVersion === 3 ? {
      contractFindings,
      appliedFindingIds,
      reviewedFindingIds: Array.from(new Set([
        ...reviewState.accepted,
        ...reviewState.rejected,
      ])).filter(findingId => contractFindings.some(finding => finding.id === findingId)),
      contractSource: {
        mcpRevision: 1813,
        pluginSnapshot: VIDMUSE_PLUGIN_RULE_SNAPSHOT,
      },
    } : {}),
  };
};

export const parseVidMuseDatasetJson = (text: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('JSON file is not valid.');
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : null;
  if (!rows) throw new Error('JSON root or items must be an array of case objects.');
  if (rows.some(row => !isRecord(row))) throw new Error('Every JSON dataset item must be an object.');
  const normalizedRows = rows as Record<string, unknown>[];
  const headers = Array.from(new Set(normalizedRows.flatMap(row => Object.keys(row))));
  return { rows: normalizedRows, headers };
};
