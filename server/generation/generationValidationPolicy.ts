import type { NormalizedGenerationModel } from './generationPlanning.ts';

export type GenerationModelValidationOverride = {
  promptMaxLength?: number;
};

export type GenerationModelValidationOverrides = Record<string, GenerationModelValidationOverride>;

const normalizeModelName = (value: string) => value.trim().toLowerCase();

export const parseGenerationModelValidationOverrides = (
  raw: string | undefined,
): GenerationModelValidationOverrides => {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GENERATION_MODEL_VALIDATION_OVERRIDES_JSON must contain valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GENERATION_MODEL_VALIDATION_OVERRIDES_JSON must be an object.');
  }
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([name, value]) => {
    const modelName = normalizeModelName(name);
    if (!modelName) throw new Error('Generation validation override model names cannot be empty.');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Generation validation override "${name}" must be an object.`);
    }
    const promptMaxLengthValue = (value as Record<string, unknown>).promptMaxLength;
    if (promptMaxLengthValue === undefined) return [modelName, {}];
    const promptMaxLength = Number(promptMaxLengthValue);
    if (!Number.isInteger(promptMaxLength) || promptMaxLength <= 0) {
      throw new Error(`Generation validation override "${name}" promptMaxLength must be a positive integer.`);
    }
    return [modelName, { promptMaxLength }];
  }));
};

const positiveInteger = (value: unknown) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};

export const structuredPromptMaxLength = (model: NormalizedGenerationModel) => {
  const schema = model.inputSchema || {};
  const optionSchema = model.options?.parameter_schema
    || model.options?.params_schema
    || model.options?.parameters_schema
    || {};
  const candidates = [
    schema?.properties?.prompt?.maxLength,
    schema?.properties?.prompt?.max_length,
    schema?.prompt?.maxLength,
    schema?.prompt?.max_length,
    optionSchema?.properties?.prompt?.maxLength,
    optionSchema?.properties?.prompt?.max_length,
    model.options?.prompt_max_length,
    model.options?.promptMaxLength,
  ];
  return candidates.map(positiveInteger).find(value => value !== undefined);
};

export const generationValidationForModel = (
  model: NormalizedGenerationModel,
  overrides: GenerationModelValidationOverrides,
): GenerationModelValidationOverride => {
  const structuredLimit = structuredPromptMaxLength(model);
  const fallback = overrides[normalizeModelName(model.modelName)] || {};
  return {
    ...(structuredLimit ? { promptMaxLength: structuredLimit } : fallback.promptMaxLength
      ? { promptMaxLength: fallback.promptMaxLength }
      : {}),
  };
};
