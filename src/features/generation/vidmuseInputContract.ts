export const VIDMUSE_INPUT_COMPILER_VERSION = '1';

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
export type VidMuseCompatibilityMode = 'strict' | 'reference_fallback';

export type VidMuseCompilerModel = {
  modelName: string;
  outputModality: 'image' | 'video';
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
  compatibilityApplied: boolean;
  bindings: VidMuseInputBindings;
  errors: VidMuseGenerationIssue[];
  warnings: VidMuseGenerationIssue[];
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
) => issues.push({ code, field, message });

const isUsableAssetUrl = (value: unknown) =>
  typeof value === 'string' && /^(?:https?:\/\/|asset:\/\/)[^\s]+$/i.test(value.trim());

const normalizeUrlArray = (
  value: unknown,
  field: string,
  errors: VidMuseGenerationIssue[],
  allowSingleString: boolean,
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
    if (!isUsableAssetUrl(entry)) {
      addIssue(errors, 'INVALID_ASSET_URL', `${field}[${index}]`, `${field} entries must be HTTP(S) or uploaded asset URLs.`);
      return [];
    }
    return [String(entry).trim()];
  });
};

const normalizePrompt = (value: unknown, errors: VidMuseGenerationIssue[]): VidMusePrompt | undefined => {
  if (value == null || value === '') return undefined;
  let parsed = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (!trimmed.startsWith('[')) return trimmed;
    const result = parseJson(trimmed);
    if (result.error) return trimmed;
    parsed = result.value;
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
    if (!prompt || !Number.isInteger(duration) || duration <= 0) {
      addIssue(errors, 'INVALID_PROMPT_ITEM', `prompt[${index}]`, 'Each multi-shot item requires non-empty prompt text and a positive integer duration.');
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

const normalizeElements = (value: unknown, errors: VidMuseGenerationIssue[]) =>
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
    const references = normalizeUrlArray(entry.reference_image_urls, `elements[${index}].reference_image_urls`, errors, false);
    const frontal = entry.frontal_image_url == null || entry.frontal_image_url === ''
      ? undefined
      : isUsableAssetUrl(entry.frontal_image_url)
        ? String(entry.frontal_image_url).trim()
        : undefined;
    if (entry.frontal_image_url && !frontal) {
      addIssue(errors, 'INVALID_ASSET_URL', `elements[${index}].frontal_image_url`, 'Element frontal image must be an HTTP(S) or uploaded asset URL.');
    }
    const video = entry.video_url == null || entry.video_url === ''
      ? undefined
      : isUsableAssetUrl(entry.video_url)
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

const normalizeAudios = (value: unknown, errors: VidMuseGenerationIssue[]) =>
  normalizeStructuredArray(value, 'audios', errors).flatMap((entry, index) => {
    if (!isRecord(entry)) {
      addIssue(errors, 'INVALID_AUDIO_INPUT', `audios[${index}]`, 'Each audio input must be an object with a URL.');
      return [];
    }
    const unknownKeys = Object.keys(entry).filter(key => !['url', 'range'].includes(key));
    if (unknownKeys.length) {
      addIssue(errors, 'UNKNOWN_AUDIO_FIELD', `audios[${index}]`, `Unsupported audio fields: ${unknownKeys.join(', ')}.`);
    }
    if (!isUsableAssetUrl(entry.url)) {
      addIssue(errors, 'INVALID_ASSET_URL', `audios[${index}].url`, 'Audio URL must be an HTTP(S) or uploaded asset URL.');
      return [];
    }
    let range: [number, number] | undefined;
    if (entry.range != null) {
      const values = Array.isArray(entry.range) ? entry.range.map(Number) : [];
      if (values.length !== 2 || !values.every(Number.isFinite) || values[0] < 0 || values[1] <= values[0]) {
        addIssue(errors, 'INVALID_AUDIO_RANGE', `audios[${index}].range`, 'Audio range must be [start, end] with 0 <= start < end.');
      } else {
        range = [Math.round(values[0] * 100) / 100, Math.round(values[1] * 100) / 100];
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
) => {
  const limits = {
    image: (input.image_urls || input.images || []).length,
    Element: (input.elements || []).length,
    audio: (input.audios || []).length,
  };
  const seen = { image: new Set<number>(), Element: new Set<number>(), audio: new Set<number>() };
  for (const text of promptTexts(input.prompt)) {
    for (const match of text.matchAll(/@(image|Element|audio)(\d+)/g)) {
      const kind = match[1] as keyof typeof limits;
      const index = Number(match[2]);
      seen[kind].add(index);
      if (index < 1 || index > limits[kind]) {
        addIssue(errors, 'PROMPT_REFERENCE_OUT_OF_RANGE', 'prompt', `${match[0]} does not match any submitted ${kind} input.`);
      }
    }
  }
  (Object.keys(limits) as Array<keyof typeof limits>).forEach(kind => {
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

export const compileVidMuseGenerationInput = ({
  model,
  input: rawInput,
  compatibilityMode = 'strict',
}: {
  model: VidMuseCompilerModel;
  input: Record<string, unknown>;
  compatibilityMode?: VidMuseCompatibilityMode;
}): VidMuseCompileResult => {
  const errors: VidMuseGenerationIssue[] = [];
  const warnings: VidMuseGenerationIssue[] = [];
  for (const reserved of ['model_name', 'generation_type']) {
    if (rawInput[reserved] != null && rawInput[reserved] !== '') {
      addIssue(errors, 'RESERVED_MCP_INPUT', reserved, `${reserved} is controlled by the generation batch and cannot be mapped from a dataset.`);
    }
  }

  const prompt = normalizePrompt(rawInput.prompt, errors);
  const imageField = model.outputModality === 'image' ? 'images' : 'image_urls';
  const imageValue = model.outputModality === 'image'
    ? rawInput.images ?? rawInput.image_urls
    : rawInput.image_urls;
  const imageUrls = normalizeUrlArray(imageValue, imageField, errors, true);
  const elements = model.outputModality === 'video' ? normalizeElements(rawInput.elements, errors) : [];
  const audios = model.outputModality === 'video' ? normalizeAudios(rawInput.audios, errors) : [];
  const input: VidMuseCanonicalInput = {
    ...Object.fromEntries(Object.entries(rawInput).filter(([key, value]) =>
      !['model_name', 'generation_type', 'prompt', 'image_urls', 'images', 'elements', 'audios'].includes(key)
      && value !== undefined && value !== null && value !== '')),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(model.outputModality === 'image' ? { images: imageUrls } : { image_urls: imageUrls, elements, audios }),
  };
  const originalInput = cloneInput(input);
  const profileId = detectProfile(model.modelName);
  let compatibilityApplied = false;

  const hasFrames = model.outputModality === 'video' && imageUrls.length > 0;
  const hasReferenceMedia = elements.length > 0 || audios.length > 0;
  const separatesFrames = profileId === 'seedance-2' || profileId === 'hailuo-h3';
  if (hasFrames && hasReferenceMedia && separatesFrames) {
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

  if ((profileId === 'seedance-2' || profileId === 'hailuo-h3') && Array.isArray(input.elements)) {
    input.elements.forEach((element, index) => {
      const imageCount = Number(Boolean(element.frontal_image_url)) + (element.reference_image_urls?.length || 0);
      if (imageCount > 1) {
        addIssue(errors, 'MODEL_ELEMENT_IMAGE_LIMIT', `elements[${index}]`, `${model.modelName} supports one image per reference element.`);
      }
    });
  }
  if (profileId === 'seedance-2' && Array.isArray(input.prompt)) {
    addIssue(errors, 'MODEL_PROMPT_SHAPE_UNSUPPORTED', 'prompt', 'Seedance multi-shot input must be compiled into one prompt string.');
  }
  if ((profileId === 'hailuo-h3' || profileId === 'wan3')
    && (input.audios || []).length
    && !(input.image_urls || []).length
    && !(input.elements || []).length) {
    addIssue(errors, 'AUDIO_ONLY_NOT_SUPPORTED', 'audios', `${model.modelName} does not accept reference audio without image or video reference media.`);
  }
  if (!profileId && mediaCategoryCount(input) > 1) {
    addIssue(warnings, 'UNVERIFIED_MODEL_COMBINATION', 'model_name', 'This multi-modal combination passed the generic contract but has no ManuEval model-specific compatibility profile.');
  }

  validatePromptBindings(input, errors, warnings);
  const finalImages = input.image_urls || input.images || [];
  const finalElements = input.elements || [];
  const finalAudios = input.audios || [];
  const generationType = model.outputModality === 'image'
    ? finalImages.length ? 'image_to_image' : 'text_to_image'
    : finalElements.length || finalAudios.length
      ? 'reference_to_video'
      : finalImages.length >= 2
        ? 'images_to_video'
        : finalImages.length === 1
          ? 'image_to_video'
          : 'text_to_video';

  return {
    compilerVersion: VIDMUSE_INPUT_COMPILER_VERSION,
    profileId,
    input,
    originalInput,
    generationType,
    compatibilityApplied,
    bindings: {
      images: finalImages.map((url, index) => ({ index: index + 1, url })),
      elements: finalElements.map((element, index) => ({ index: index + 1, element })),
      audios: finalAudios.map((audio, index) => ({ index: index + 1, audio })),
    },
    errors,
    warnings,
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
