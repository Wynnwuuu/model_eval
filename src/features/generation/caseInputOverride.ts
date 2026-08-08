import type {
  GenerationCaseInputOverrideV1,
  GenerationPreflightIssue,
} from '../../types.js';

export type GenerationCaseParameterDestination = 'control' | 'extra_params' | 'omit_only';

export interface GenerationCaseInputOverrideAudit {
  version: 1;
  override: GenerationCaseInputOverrideV1;
  sourceInput: Record<string, unknown>;
  appliedContentFields: string[];
  appliedParameterFields: string[];
  effectiveInput: Record<string, unknown>;
}

const VIDEO_CONTENT_FIELDS = new Set(['prompt', 'image_urls', 'elements', 'audios']);
const IMAGE_CONTENT_FIELDS = new Set(['prompt', 'images']);
const RESERVED_PARAMETER_FIELDS = new Set([
  'model_name',
  'generation_type',
  'features',
  'extra_params',
  'seed',
  'result_file_dir',
  'preview_file_dir',
  'callback',
  'callback_url',
  'webhook',
  'webhook_url',
]);

const clone = <T>(value: T): T => (
  value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
);

const issue = (code: string, field: string, message: string): GenerationPreflightIssue => ({
  code,
  field,
  message,
});

const validOperation = (value: unknown): value is { action: 'set'; value: unknown } | { action: 'omit' } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = (value as { action?: unknown }).action;
  if (action === 'omit') return true;
  return action === 'set' && Object.prototype.hasOwnProperty.call(value, 'value');
};

export const applyGenerationCaseInputOverride = ({
  input,
  override,
  outputModality,
  parameterDestinations,
}: {
  input: Record<string, unknown>;
  override?: GenerationCaseInputOverrideV1;
  outputModality: 'image' | 'video';
  parameterDestinations: Record<string, GenerationCaseParameterDestination>;
}): {
  input: Record<string, unknown>;
  issues: GenerationPreflightIssue[];
  audit?: GenerationCaseInputOverrideAudit;
} => {
  if (!override) return { input, issues: [] };
  const issues: GenerationPreflightIssue[] = [];
  const effectiveInput = clone(input);
  const appliedContentFields: string[] = [];
  const appliedParameterFields: string[] = [];
  if (override.version !== 1) {
    return {
      input: effectiveInput,
      issues: [issue('INVALID_CASE_INPUT_OVERRIDE', 'inputOverride.version', 'Only case input override version 1 is supported.')],
    };
  }

  const allowedContentFields = outputModality === 'video' ? VIDEO_CONTENT_FIELDS : IMAGE_CONTENT_FIELDS;
  for (const [field, operation] of Object.entries(override.content || {})) {
    if (!allowedContentFields.has(field)) {
      issues.push(issue(
        'CASE_OVERRIDE_FIELD_NOT_ALLOWED',
        `inputOverride.content.${field}`,
        `${field} cannot be overridden for a ${outputModality} generation case.`,
      ));
      continue;
    }
    if (!validOperation(operation)) {
      issues.push(issue('INVALID_CASE_INPUT_OVERRIDE', `inputOverride.content.${field}`, `${field} requires a set or omit operation.`));
      continue;
    }
    if (operation.action === 'omit') delete effectiveInput[field];
    else effectiveInput[field] = clone(operation.value);
    appliedContentFields.push(field);
  }

  for (const [field, operation] of Object.entries(override.parameters || {})) {
    const destination = parameterDestinations[field];
    if (RESERVED_PARAMETER_FIELDS.has(field) || !destination) {
      issues.push(issue(
        'CASE_OVERRIDE_PARAMETER_NOT_ALLOWED',
        `inputOverride.parameters.${field}`,
        `${field} is not a declared editable parameter for the selected model.`,
      ));
      continue;
    }
    if (!validOperation(operation)) {
      issues.push(issue('INVALID_CASE_INPUT_OVERRIDE', `inputOverride.parameters.${field}`, `${field} requires a set or omit operation.`));
      continue;
    }
    if (destination === 'omit_only' && operation.action === 'set') {
      issues.push(issue(
        'CASE_OVERRIDE_PARAMETER_NOT_ALLOWED',
        `inputOverride.parameters.${field}`,
        `${field} is not supported by the selected model and can only be omitted.`,
      ));
      continue;
    }
    if (destination === 'control' || destination === 'omit_only') {
      if (operation.action === 'omit') delete effectiveInput[field];
      else effectiveInput[field] = clone(operation.value);
    } else {
      const current = effectiveInput.extra_params;
      const extraParams = current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
      if (operation.action === 'omit') delete extraParams[field];
      else extraParams[field] = clone(operation.value);
      if (Object.keys(extraParams).length) effectiveInput.extra_params = extraParams;
      else delete effectiveInput.extra_params;
    }
    appliedParameterFields.push(field);
  }

  return {
    input: effectiveInput,
    issues,
    audit: {
      version: 1,
      override: clone(override),
      sourceInput: clone(input),
      appliedContentFields,
      appliedParameterFields,
      effectiveInput: clone(effectiveInput),
    },
  };
};
