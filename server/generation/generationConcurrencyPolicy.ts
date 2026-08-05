export type GenerationModelConcurrencyLimit = {
  min: number;
  max: number;
};

export type GenerationVideoModelLimits = {
  default: GenerationModelConcurrencyLimit;
  models: Record<string, GenerationModelConcurrencyLimit>;
};

export type GenerationCapacityOutcome = {
  status?: string;
  error?: Record<string, unknown> | null;
};

export type GenerationConcurrencyMode =
  | 'insufficient_sample'
  | 'maximum'
  | 'reduced'
  | 'minimum';

export type GenerationConcurrencyPolicy = GenerationModelConcurrencyLimit & {
  effectiveLimit: number;
  sampleSize: number;
  capacityFailures: number;
  capacityFailureRate: number;
  mode: GenerationConcurrencyMode;
  reason: string;
};

export const GENERATION_POLICY_WINDOW_HOURS = 24;
export const GENERATION_POLICY_SAMPLE_SIZE = 12;
export const GENERATION_POLICY_MIN_SAMPLES = 6;
export const GENERATION_POLICY_CACHE_MS = 10_000;

export const DEFAULT_GENERATION_VIDEO_MODEL_LIMITS: GenerationVideoModelLimits = {
  default: { min: 2, max: 4 },
  models: {
    'wan/wan3.0-video': { min: 2, max: 6 },
    'minimax/hailuo-h3': { min: 2, max: 8 },
    'seedance-2.0-fast': { min: 2, max: 8 },
    'seedance-2.0-pro': { min: 2, max: 8 },
  },
};

const normalizeModelName = (value: string) => value.trim().toLowerCase();

const validateLimit = (
  value: unknown,
  label: string,
): GenerationModelConcurrencyLimit => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object with integer min and max values.`);
  }
  const min = Number((value as Record<string, unknown>).min);
  const max = Number((value as Record<string, unknown>).max);
  if (!Number.isInteger(min) || min <= 0 || !Number.isInteger(max) || max <= 0) {
    throw new Error(`${label} minimum and maximum must be positive integers.`);
  }
  if (min > max) {
    throw new Error(`${label} minimum cannot exceed maximum.`);
  }
  return { min, max };
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
    .map(classifyGenerationCapacityOutcome)
    .filter((value): value is 'success' | 'capacity_failure' => Boolean(value))
    .slice(0, GENERATION_POLICY_SAMPLE_SIZE);
  const sampleSize = validOutcomes.length;
  const capacityFailures = validOutcomes.filter(value => value === 'capacity_failure').length;
  const capacityFailureRate = sampleSize ? capacityFailures / sampleSize : 0;

  if (sampleSize < GENERATION_POLICY_MIN_SAMPLES) {
    return {
      ...limit,
      effectiveLimit: limit.max,
      sampleSize,
      capacityFailures,
      capacityFailureRate,
      mode: 'insufficient_sample',
      reason: 'Insufficient valid recent outcomes; using the configured maximum.',
    };
  }
  if (capacityFailureRate < 0.3) {
    return {
      ...limit,
      effectiveLimit: limit.max,
      sampleSize,
      capacityFailures,
      capacityFailureRate,
      mode: 'maximum',
      reason: 'Recent capacity failure rate is below 30%.',
    };
  }
  if (capacityFailureRate < 0.6) {
    return {
      ...limit,
      effectiveLimit: Math.max(limit.min, limit.max - 2),
      sampleSize,
      capacityFailures,
      capacityFailureRate,
      mode: 'reduced',
      reason: 'Recent capacity failure rate is between 30% and 60%.',
    };
  }
  return {
    ...limit,
    effectiveLimit: limit.min,
    sampleSize,
    capacityFailures,
    capacityFailureRate,
    mode: 'minimum',
    reason: 'Recent capacity failure rate is at least 60%.',
  };
};
