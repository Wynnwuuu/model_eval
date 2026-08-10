export type GenerationModelConcurrencyLimit = {
  min: number;
  initial: number;
  max: number;
};

export type GenerationVideoModelLimits = {
  default: GenerationModelConcurrencyLimit;
  models: Record<string, GenerationModelConcurrencyLimit>;
};

export type GenerationCapacityOutcome = {
  status?: string;
  error?: Record<string, unknown> | null;
  finishedAt?: number;
};

export type GenerationConcurrencyMode =
  | 'initial'
  | 'ramping'
  | 'maximum'
  | 'minimum';

export type GenerationConcurrencyPolicy = GenerationModelConcurrencyLimit & {
  effectiveLimit: number;
  sampleSize: number;
  capacityFailures: number;
  capacityFailureRate: number;
  successStreak: number;
  lastCapacityFailureAt?: number;
  mode: GenerationConcurrencyMode;
  reason: string;
};

export const GENERATION_POLICY_WINDOW_HOURS = 24;
export const GENERATION_POLICY_SAMPLE_SIZE = 24;
export const GENERATION_POLICY_SUCCESSES_PER_STEP = 3;
export const GENERATION_POLICY_CACHE_MS = 10_000;

export const DEFAULT_GENERATION_VIDEO_MODEL_LIMITS: GenerationVideoModelLimits = {
  default: { min: 1, initial: 1, max: 4 },
  models: {},
};

const normalizeModelName = (value: string) => value.trim().toLowerCase();

const validateLimit = (
  value: unknown,
  label: string,
): GenerationModelConcurrencyLimit => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object with integer min, initial, and max values.`);
  }
  const min = Number((value as Record<string, unknown>).min);
  const rawInitial = (value as Record<string, unknown>).initial;
  const initial = rawInitial === undefined ? min : Number(rawInitial);
  const max = Number((value as Record<string, unknown>).max);
  if (!Number.isInteger(min) || min <= 0
    || !Number.isInteger(initial) || initial <= 0
    || !Number.isInteger(max) || max <= 0) {
    throw new Error(`${label} minimum, initial, and maximum must be positive integers.`);
  }
  if (min > initial || initial > max) {
    throw new Error(`${label} minimum cannot exceed initial, and initial cannot exceed maximum.`);
  }
  return { min, initial, max };
};

export const parseGenerationVideoModelLimits = (
  raw: string | undefined,
  globalLimit: number,
): GenerationVideoModelLimits => {
  if (!Number.isInteger(globalLimit) || globalLimit <= 0) {
    throw new Error('The global video concurrency limit must be a positive integer.');
  }
  let parsed: unknown = DEFAULT_GENERATION_VIDEO_MODEL_LIMITS;
  if (raw?.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('GENERATION_VIDEO_MODEL_LIMITS_JSON must contain valid JSON.');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('GENERATION_VIDEO_MODEL_LIMITS_JSON must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  const defaultLimit = validateLimit(record.default, 'Default video model limit');
  const rawModels = record.models;
  if (!rawModels || typeof rawModels !== 'object' || Array.isArray(rawModels)) {
    throw new Error('GENERATION_VIDEO_MODEL_LIMITS_JSON models must be an object.');
  }
  const models = Object.fromEntries(Object.entries(rawModels as Record<string, unknown>).map(([name, value]) => {
    const normalizedName = normalizeModelName(name);
    if (!normalizedName) throw new Error('Video model limit names cannot be empty.');
    return [normalizedName, validateLimit(value, `Video model limit "${name}"`)];
  }));
  return { default: defaultLimit, models };
};

export const resolveGenerationVideoModelLimit = (
  config: GenerationVideoModelLimits,
  modelName: string,
): GenerationModelConcurrencyLimit => (
  config.models[normalizeModelName(modelName)] || config.default
);

const capacityErrorText = (error: Record<string, unknown>) => {
  const values = [
    error.code,
    error.message,
    error.detail,
    error.providerStatus,
    error.provider_status,
  ];
  return values.filter(value => typeof value === 'string').join(' ').toLowerCase();
};

export const classifyGenerationCapacityOutcome = (
  outcome: GenerationCapacityOutcome,
): 'success' | 'capacity_failure' | null => {
  const status = String(outcome.status || '').toLowerCase();
  if (status === 'succeeded' || status === 'completed') return 'success';
  if (status === 'submission_unknown') return 'capacity_failure';
  if (status !== 'failed') return null;

  const error = outcome.error || {};
  const code = String(error.code || '').toUpperCase();
  const httpStatus = Number(error.httpStatus ?? error.http_status ?? 0);
  const text = capacityErrorText(error);

  if ([
    'GENERATION_TIMEOUT',
    'AION_SUBMISSION_UNKNOWN',
    'INTERRUPTED_SUBMISSION',
    'MISSING_PROVIDER_TASK_ID',
  ].includes(code)) {
    return 'capacity_failure';
  }
  if ([429, 502, 503, 504].includes(httpStatus)) return 'capacity_failure';
  if (
    /(?:timed?\s*out|timeout|1200\s*seconds|too many requests|rate.?limit|overload|capacity|service unavailable|temporarily unavailable|provider busy|server busy)/i.test(text)
  ) {
    return 'capacity_failure';
  }
  return null;
};

export const computeGenerationConcurrencyPolicy = (
  limit: GenerationModelConcurrencyLimit,
  outcomes: GenerationCapacityOutcome[],
): GenerationConcurrencyPolicy => {
  const validOutcomes = outcomes
    .map(outcome => ({ kind: classifyGenerationCapacityOutcome(outcome), finishedAt: outcome.finishedAt }))
    .filter((value): value is { kind: 'success' | 'capacity_failure'; finishedAt: number | undefined } => Boolean(value.kind))
    .slice(0, GENERATION_POLICY_SAMPLE_SIZE);
  const sampleSize = validOutcomes.length;
  const capacityFailures = validOutcomes.filter(value => value.kind === 'capacity_failure').length;
  const capacityFailureRate = sampleSize ? capacityFailures / sampleSize : 0;
  const latestFailureIndex = validOutcomes.findIndex(value => value.kind === 'capacity_failure');
  const successStreak = latestFailureIndex === -1 ? validOutcomes.length : latestFailureIndex;
  const lastCapacityFailure = validOutcomes.find(value => value.kind === 'capacity_failure');
  const baseLimit = lastCapacityFailure ? limit.min : limit.initial;
  const effectiveLimit = Math.min(
    limit.max,
    baseLimit + Math.floor(successStreak / GENERATION_POLICY_SUCCESSES_PER_STEP),
  );

  if (!sampleSize) {
    return {
      ...limit,
      effectiveLimit: limit.initial,
      sampleSize,
      capacityFailures,
      capacityFailureRate,
      successStreak,
      mode: 'initial',
      reason: 'No recent capacity evidence; using the configured initial limit.',
    };
  }
  const common = {
    ...limit,
    effectiveLimit,
    sampleSize,
    capacityFailures,
    capacityFailureRate,
    successStreak,
    ...(lastCapacityFailure?.finishedAt ? { lastCapacityFailureAt: lastCapacityFailure.finishedAt } : {}),
  };
  if (effectiveLimit >= limit.max) {
    return {
      ...common,
      mode: 'maximum' as const,
      reason: `Reached the configured maximum after ${successStreak} consecutive successes.`,
    };
  }
  if (lastCapacityFailure && effectiveLimit === limit.min) {
    return {
      ...common,
      mode: 'minimum' as const,
      reason: 'A recent capacity failure reset the model to its configured minimum.',
    };
  }
  return {
    ...common,
    mode: 'ramping',
    reason: `${successStreak} consecutive successes; one slot is restored per ${GENERATION_POLICY_SUCCESSES_PER_STEP}.`,
  };
};
