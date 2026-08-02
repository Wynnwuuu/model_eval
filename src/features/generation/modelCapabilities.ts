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
  outputModality: 'image' | 'video';
  capabilities?: string[];
  inputSchema?: Record<string, any>;
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
