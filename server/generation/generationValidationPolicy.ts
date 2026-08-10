import type { GenerationPromptLengthAudit } from '../../src/types.ts';
import type { NormalizedGenerationModel } from './generationPlanning.ts';

export type PromptLengthUnit = 'unicode_code_points';
export type PromptLengthRuleSource =
  | 'aion_input_schema'
  | 'aion_parameter_schema'
  | 'aion_options'
  | 'manueval_compatibility';

export type PromptLengthOverride = {
  unit: PromptLengthUnit;
  string?: { maxLength: number };
  array?:
    | { scope: 'array_item'; maxLength: number }
    | {
        scope: 'array_joined';
        maxLength: number;
        separator: string;
        trimItems: boolean;
        omitEmptyItems: boolean;
      };
};

export type PromptLengthContract = {
  unit: PromptLengthUnit;
  string?: { maxLength: number; source: PromptLengthRuleSource };
  array?:
    | { scope: 'array_item'; maxLength: number; source: PromptLengthRuleSource }
    | {
        scope: 'array_joined';
        maxLength: number;
        separator: string;
        trimItems: boolean;
        omitEmptyItems: boolean;
        source: PromptLengthRuleSource;
      };
};

export type GenerationModelValidationOverride = {
  /** Legacy compatibility: applies only to string Prompts. */
  promptMaxLength?: number;
  promptLength?: PromptLengthOverride;
};

export type GenerationModelValidationOverrides = Record<string, GenerationModelValidationOverride>;

export type GenerationModelValidationPolicy = {
  /** Direct-call compatibility for historical tests and snapshots; string only. */
  promptMaxLength?: number;
  promptLength?: PromptLengthContract;
};

const normalizeModelName = (value: string) => value.trim().toLowerCase();

const positiveInteger = (value: unknown) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};

const objectValue = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined;

const requiredPositiveInteger = (value: unknown, field: string) => {
  const parsed = positiveInteger(value);
  if (!parsed) throw new Error(`${field} must be a positive integer.`);
  return parsed;
};

const parsePromptLengthOverride = (value: unknown, field: string): PromptLengthOverride => {
  const raw = objectValue(value);
  if (!raw) throw new Error(`${field} must be an object.`);
  if (raw.unit !== 'unicode_code_points') {
    throw new Error(`${field}.unit must be unicode_code_points.`);
  }

  const stringRule = raw.string === undefined ? undefined : objectValue(raw.string);
  if (raw.string !== undefined && !stringRule) throw new Error(`${field}.string must be an object.`);
  const arrayRule = raw.array === undefined ? undefined : objectValue(raw.array);
  if (raw.array !== undefined && !arrayRule) throw new Error(`${field}.array must be an object.`);
  if (!stringRule && !arrayRule) throw new Error(`${field} must declare string or array rules.`);

  let parsedArray: PromptLengthOverride['array'];
  if (arrayRule) {
    const maxLength = requiredPositiveInteger(arrayRule.maxLength, `${field}.array.maxLength`);
    if (arrayRule.scope === 'array_item') {
      parsedArray = { scope: 'array_item', maxLength };
    } else if (arrayRule.scope === 'array_joined') {
      if (typeof arrayRule.separator !== 'string') {
        throw new Error(`${field}.array.separator must be a string for array_joined.`);
      }
      if (typeof arrayRule.trimItems !== 'boolean' || typeof arrayRule.omitEmptyItems !== 'boolean') {
        throw new Error(`${field}.array trimItems and omitEmptyItems must be booleans for array_joined.`);
      }
      parsedArray = {
        scope: 'array_joined',
        maxLength,
        separator: arrayRule.separator,
        trimItems: arrayRule.trimItems,
        omitEmptyItems: arrayRule.omitEmptyItems,
      };
    } else {
      throw new Error(`${field}.array.scope must be array_item or array_joined.`);
    }
  }

  return {
    unit: 'unicode_code_points',
    ...(stringRule ? {
      string: { maxLength: requiredPositiveInteger(stringRule.maxLength, `${field}.string.maxLength`) },
    } : {}),
    ...(parsedArray ? { array: parsedArray } : {}),
  };
};

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
    const record = objectValue(value);
    if (!record) throw new Error(`Generation validation override "${name}" must be an object.`);

    const promptMaxLength = record.promptMaxLength === undefined
      ? undefined
      : requiredPositiveInteger(
          record.promptMaxLength,
          `Generation validation override "${name}" promptMaxLength`,
        );
    const promptLength = record.promptLength === undefined
      ? undefined
      : parsePromptLengthOverride(
          record.promptLength,
          `Generation validation override "${name}" promptLength`,
        );
    return [modelName, {
      ...(promptMaxLength ? { promptMaxLength } : {}),
      ...(promptLength ? { promptLength } : {}),
    }];
  }));
};

type SchemaPromptLimits = {
  string?: number;
  arrayItem?: number;
};

const largest = (values: Array<number | undefined>) => {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length ? Math.max(...defined) : undefined;
};

const stringLimitFromSchema = (value: unknown): number | undefined => {
  const schema = objectValue(value);
  if (!schema || schema.type === 'array' || schema.type === 'object') return undefined;
  return largest([
    positiveInteger(schema.maxLength),
    positiveInteger(schema.max_length),
    ...['oneOf', 'anyOf'].flatMap(key => (
      Array.isArray(schema[key]) ? schema[key].map(stringLimitFromSchema) : []
    )),
  ]);
};

const itemPromptLimitFromSchema = (value: unknown): number | undefined => {
  const schema = objectValue(value);
  if (!schema) return undefined;
  const promptProperty = objectValue(schema.properties)?.prompt;
  return largest([
    promptProperty ? stringLimitFromSchema(promptProperty) : undefined,
    schema.type === 'string' ? stringLimitFromSchema(schema) : undefined,
    ...['oneOf', 'anyOf'].flatMap(key => (
      Array.isArray(schema[key]) ? schema[key].map(itemPromptLimitFromSchema) : []
    )),
  ]);
};

const arrayItemLimitFromSchema = (value: unknown): number | undefined => {
  const schema = objectValue(value);
  if (!schema) return undefined;
  return largest([
    schema.items ? itemPromptLimitFromSchema(schema.items) : undefined,
    ...['oneOf', 'anyOf'].flatMap(key => (
      Array.isArray(schema[key]) ? schema[key].map(arrayItemLimitFromSchema) : []
    )),
  ]);
};

const promptLimitsFromSchema = (value: unknown): SchemaPromptLimits => ({
  string: stringLimitFromSchema(value),
  arrayItem: arrayItemLimitFromSchema(value),
});

const promptSchemaFrom = (schema: unknown) => {
  const record = objectValue(schema);
  if (!record) return undefined;
  return objectValue(record.properties)?.prompt ?? record.prompt;
};

const parameterSchemaFrom = (options: Record<string, any>) =>
  [options.parameter_schema, options.params_schema, options.parameters_schema]
    .find(candidate => objectValue(candidate));

export const structuredPromptMaxLength = (model: NormalizedGenerationModel) => {
  const inputLimit = promptLimitsFromSchema(promptSchemaFrom(model.inputSchema)).string;
  if (inputLimit) return inputLimit;
  const parameterLimit = promptLimitsFromSchema(promptSchemaFrom(parameterSchemaFrom(model.options))).string;
  if (parameterLimit) return parameterLimit;
  return largest([
    positiveInteger(model.options?.prompt_max_length),
    positiveInteger(model.options?.promptMaxLength),
  ]);
};

const ruleWithSource = <T extends Record<string, unknown>>(
  rule: T,
  source: PromptLengthRuleSource,
) => ({ ...rule, source });

export const generationValidationForModel = (
  model: NormalizedGenerationModel,
  overrides: GenerationModelValidationOverrides,
): GenerationModelValidationPolicy => {
  const inputLimits = promptLimitsFromSchema(promptSchemaFrom(model.inputSchema));
  const parameterLimits = promptLimitsFromSchema(promptSchemaFrom(parameterSchemaFrom(model.options)));
  const optionStringLimit = largest([
    positiveInteger(model.options?.prompt_max_length),
    positiveInteger(model.options?.promptMaxLength),
  ]);
  const fallback = overrides[normalizeModelName(model.modelName)] || {};
  const fallbackString = fallback.promptLength?.string?.maxLength ?? fallback.promptMaxLength;
  const stringRule = inputLimits.string
    ? ruleWithSource({ maxLength: inputLimits.string }, 'aion_input_schema')
    : parameterLimits.string
      ? ruleWithSource({ maxLength: parameterLimits.string }, 'aion_parameter_schema')
      : optionStringLimit
        ? ruleWithSource({ maxLength: optionStringLimit }, 'aion_options')
        : fallbackString
          ? ruleWithSource({ maxLength: fallbackString }, 'manueval_compatibility')
          : undefined;
  const arrayRule = inputLimits.arrayItem
    ? ruleWithSource({ scope: 'array_item' as const, maxLength: inputLimits.arrayItem }, 'aion_input_schema')
    : parameterLimits.arrayItem
      ? ruleWithSource({ scope: 'array_item' as const, maxLength: parameterLimits.arrayItem }, 'aion_parameter_schema')
      : fallback.promptLength?.array
        ? ruleWithSource(fallback.promptLength.array, 'manueval_compatibility')
        : undefined;
  if (!stringRule && !arrayRule) return {};
  return {
    promptLength: {
      unit: 'unicode_code_points',
      ...(stringRule ? { string: stringRule } : {}),
      ...(arrayRule ? { array: arrayRule } : {}),
    },
  };
};

const codePointLength = (value: string) => Array.from(value).length;

const effectivePromptContract = (policy: GenerationModelValidationPolicy): PromptLengthContract | undefined => {
  if (policy.promptLength) return policy.promptLength;
  const legacyLimit = positiveInteger(policy.promptMaxLength);
  return legacyLimit ? {
    unit: 'unicode_code_points',
    string: { maxLength: legacyLimit, source: 'manueval_compatibility' },
  } : undefined;
};

export const evaluatePromptLength = (
  prompt: unknown,
  policy: GenerationModelValidationPolicy,
): GenerationPromptLengthAudit[] => {
  const contract = effectivePromptContract(policy);
  if (typeof prompt === 'string') {
    if (!contract?.string) return [];
    return [{
      measuredLength: codePointLength(prompt),
      maximumLength: contract.string.maxLength,
      unit: contract.unit,
      scope: 'string',
      source: contract.string.source,
    }];
  }
  if (!Array.isArray(prompt)) return [];
  const promptTexts = prompt.map(item => {
    const record = objectValue(item);
    return typeof record?.prompt === 'string' ? record.prompt : '';
  });
  if (!contract?.array) {
    return [{
      measuredLength: promptTexts.reduce((total, value) => total + codePointLength(value), 0),
      unit: 'unicode_code_points',
      scope: 'array_unverified',
    }];
  }
  const arrayContract = contract.array;
  if (arrayContract.scope === 'array_item') {
    return promptTexts.map((value, itemIndex) => ({
      measuredLength: codePointLength(value),
      maximumLength: arrayContract.maxLength,
      unit: contract.unit,
      scope: 'array_item' as const,
      source: arrayContract.source,
      itemIndex,
    }));
  }
  let values = arrayContract.trimItems ? promptTexts.map(value => value.trim()) : promptTexts;
  if (arrayContract.omitEmptyItems) values = values.filter(Boolean);
  const joined = values.join(arrayContract.separator);
  return [{
    measuredLength: codePointLength(joined),
    maximumLength: arrayContract.maxLength,
    unit: contract.unit,
    scope: 'array_joined',
    source: arrayContract.source,
  }];
};
