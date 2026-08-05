export type GenerationMode =
  | 'text_to_image'
  | 'image_to_image'
  | 'images_to_image'
  | 'text_to_video'
  | 'image_to_video'
  | 'images_to_video'
  | 'reference_to_video';

export type GenerationImageRole = 'reference' | 'start' | 'end';

type GenerationModeSource = {
  id?: string;
  modelName?: string;
  outputModality: string;
  capabilities?: string[];
  inputSchema?: Record<string, any>;
  options?: Record<string, any>;
};

export type GenerationReferenceVideoSupport =
  | {
      supported: true;
      strategy: 'array_field' | 'single_field' | 'elements';
      field: 'reference_video_urls' | 'video_urls' | 'video_url' | 'elements';
      min: number;
      max?: number;
      source: 'explicit_input' | 'element_range' | 'hailuo_h3_contract';
    }
  | {
      supported: false;
      strategy?: undefined;
      field?: undefined;
      min?: undefined;
      max?: undefined;
      source: 'not_declared';
    };

const MODE_ALIASES: Record<GenerationMode, string[]> = {
  text_to_image: ['text_to_image', 'text2image'],
  image_to_image: ['image_to_image', 'image2image'],
  images_to_image: ['images_to_image', 'images2image'],
  text_to_video: ['text_to_video', 'text2video'],
  image_to_video: ['image_to_video', 'image2video'],
  images_to_video: ['images_to_video', 'images2video', 'keyframe_to_video', 'keyframe2video'],
  reference_to_video: ['reference_to_video', 'reference2video', 'ref_to_video', 'ref2video'],
};

const normalizeModeName = (value: unknown) =>
  String(value || '').trim().toLowerCase().replaceAll('-', '_');

const schemaModeNames = (schema?: Record<string, any>) => {
  const names = new Set<string>();
  if (!schema || typeof schema !== 'object') return names;
  for (const field of ['required_inputs', 'optional_inputs', 'required_one_of_inputs']) {
    const declaration = schema[field];
    if (!declaration || Array.isArray(declaration) || typeof declaration !== 'object') continue;
    Object.keys(declaration).forEach(key => names.add(normalizeModeName(key)));
  }
  return names;
};

const declaredModeNames = (model: GenerationModeSource) => {
  const names = schemaModeNames(model.inputSchema);
  (model.capabilities || []).forEach(capability => names.add(normalizeModeName(capability)));
  return names;
};

const collectInputKeys = (model: GenerationModeSource) => {
  const keys = new Set<string>();
  const options = model.options || {};
  const supported = options.supported_params || options.supportedParams;
  if (Array.isArray(supported)) supported.forEach((key: unknown) => keys.add(String(key)));

  const schema = model.inputSchema;
  if (!schema || typeof schema !== 'object') return keys;
  Object.keys(schema.properties || {}).forEach(key => keys.add(String(key)));
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
      value.flatMap(group => Array.isArray(group) ? group : [group])
        .forEach(key => keys.add(String(key)));
    });
  }
  if (Array.isArray(schema.supported_inputs)) {
    schema.supported_inputs.forEach((key: unknown) => keys.add(String(key)));
  }
  return keys;
};

const numericRange = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const range = value.slice(0, 2).map(Number);
  return range.every(Number.isFinite) ? range as [number, number] : undefined;
};

const configuredRange = (options: Record<string, any>, keys: string[]) => {
  for (const key of keys) {
    const range = numericRange(options[key]);
    if (range) return range;
  }
  return undefined;
};

export const modelDeclaresGenerationInput = (
  model: GenerationModeSource | undefined,
  key: string,
) => Boolean(model && collectInputKeys(model).has(key));

export const getGenerationReferenceVideoSupport = (
  model?: GenerationModeSource,
): GenerationReferenceVideoSupport => {
  if (!model || model.outputModality !== 'video') {
    return { supported: false, source: 'not_declared' };
  }

  const options = model.options || {};
  const inputs = collectInputKeys(model);
  for (const field of ['reference_video_urls', 'video_urls'] as const) {
    if (!inputs.has(field)) continue;
    const range = configuredRange(options, [
      `${field}_count_range`,
      field === 'reference_video_urls' ? 'reference_videos_count_range' : 'videos_count_range',
    ]);
    return {
      supported: true,
      strategy: 'array_field',
      field,
      min: range?.[0] ?? 0,
      ...(range ? { max: range[1] } : {}),
      source: 'explicit_input',
    };
  }

  if (inputs.has('video_url')) {
    return {
      supported: true,
      strategy: 'single_field',
      field: 'video_url',
      min: 0,
      max: 1,
      source: 'explicit_input',
    };
  }

  const elementRange = configuredRange(options, [
    'element.video_url_count_range',
    'element_video_url_count_range',
  ]);
  if (inputs.has('elements') && elementRange) {
    return {
      supported: true,
      strategy: 'elements',
      field: 'elements',
      min: elementRange[0],
      max: elementRange[1],
      source: 'element_range',
    };
  }

  const modelName = String(model.modelName || model.id || '').toLowerCase();
  if (inputs.has('elements') && /(^|\/)hailuo-h3(?:$|[-_/])/.test(modelName)) {
    return {
      supported: true,
      strategy: 'elements',
      field: 'elements',
      min: 0,
      max: 3,
      source: 'hailuo_h3_contract',
    };
  }

  return { supported: false, source: 'not_declared' };
};

export const supportsGenerationMode = (
  model: GenerationModeSource,
  mode: GenerationMode,
) => {
  const declared = declaredModeNames(model);
  const aliases = MODE_ALIASES[mode].map(normalizeModeName);
  if (aliases.some(alias => declared.has(alias))) return true;

  const knownAliases = new Set(Object.values(MODE_ALIASES).flat().map(normalizeModeName));
  const hasExplicitModeDeclarations = Array.from(declared).some(name => knownAliases.has(name));
  return !hasExplicitModeDeclarations;
};

export const getSupportedGenerationImageRoles = (
  model?: GenerationModeSource,
): GenerationImageRole[] => {
  if (!model) return [];
  if (model.outputModality === 'image') {
    return supportsGenerationMode(model, 'image_to_image')
      || supportsGenerationMode(model, 'images_to_image')
      ? ['reference']
      : [];
  }

  const roles: GenerationImageRole[] = [];
  if (supportsGenerationMode(model, 'reference_to_video')) roles.push('reference');
  if (supportsGenerationMode(model, 'image_to_video') || supportsGenerationMode(model, 'images_to_video')) {
    roles.push('start');
  }
  if (supportsGenerationMode(model, 'images_to_video')) roles.push('end');
  return roles;
};
