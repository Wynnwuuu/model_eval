export type GenerationCapacityPhase =
  | 'slow_start'
  | 'stable'
  | 'rate_limited'
  | 'cooling'
  | 'circuit_open';

export type GenerationCapacityEvidenceKind =
  | 'accepted'
  | 'concurrency_limit'
  | 'rate_limit'
  | 'ambiguous_429'
  | 'availability'
  | 'submission_unknown'
  | 'neutral';

export type GenerationVideoAdaptivePolicy = {
  policyVersion: number;
  hardLimit: number;
  initialGlobalLimit: number;
  coldStartLimit: number;
  optimisticWaves: number[];
  idleResetMs: number;
  globalSubmitRatePerSecond: number;
  globalSubmitBurst: number;
  capacityCooldownMs: number;
  ambiguous429WindowMs: number;
  submissionUnknownCooldownMs: number;
  globalSubmissionUnknownCooldownMs: number;
  availabilityFailureWindowMs: number;
  availabilityFailureThreshold: number;
  bucketCircuitMs: number;
  pollMinMs: number;
  pollMaxMs: number;
  submitWorkers: number;
  pollWorkers: number;
};

export type GenerationCapacityState = {
  currentWindow: number;
  acceptedInWave: number;
  phase: GenerationCapacityPhase;
  cooldownUntil?: number;
  circuitOpenUntil?: number;
  lastAmbiguous429At?: number;
  availabilityFailureTimes: number[];
  lastEvidence?: GenerationCapacityEvidenceKind;
  lastEvidenceAt?: number;
  lastActivityAt: number;
  configFingerprint?: string;
  nextSubmitAt?: number;
  submitTokens?: number;
  submitTokenUpdatedAt?: number;
};

export type GenerationCapacityEvidence = {
  kind: GenerationCapacityEvidenceKind;
  observedAt: number;
  activeAtSubmit?: number;
  limitAtSubmit?: number;
  retryAfterMs?: number;
};

export type GenerationCapacityOutcome = {
  status?: string;
  error?: Record<string, unknown> | null;
};

export const DEFAULT_GENERATION_VIDEO_ADAPTIVE_POLICY: GenerationVideoAdaptivePolicy = {
  policyVersion: 5,
  hardLimit: 24,
  initialGlobalLimit: 24,
  coldStartLimit: 8,
  optimisticWaves: [8, 16, 24],
  idleResetMs: 24 * 60 * 60 * 1000,
  globalSubmitRatePerSecond: 2,
  globalSubmitBurst: 2,
  capacityCooldownMs: 60_000,
  ambiguous429WindowMs: 10 * 60 * 1000,
  submissionUnknownCooldownMs: 5 * 60 * 1000,
  globalSubmissionUnknownCooldownMs: 60_000,
  availabilityFailureWindowMs: 2 * 60 * 1000,
  availabilityFailureThreshold: 3,
  bucketCircuitMs: 2 * 60 * 1000,
  pollMinMs: 10_000,
  pollMaxMs: 30_000,
  submitWorkers: 2,
  pollWorkers: 6,
};

const integerKeys = new Set<keyof GenerationVideoAdaptivePolicy>([
  'policyVersion',
  'hardLimit',
  'initialGlobalLimit',
  'coldStartLimit',
  'idleResetMs',
  'globalSubmitBurst',
  'capacityCooldownMs',
  'ambiguous429WindowMs',
  'submissionUnknownCooldownMs',
  'globalSubmissionUnknownCooldownMs',
  'availabilityFailureWindowMs',
  'availabilityFailureThreshold',
  'bucketCircuitMs',
  'pollMinMs',
  'pollMaxMs',
  'submitWorkers',
  'pollWorkers',
]);

const knownPolicyKeys = new Set(Object.keys(DEFAULT_GENERATION_VIDEO_ADAPTIVE_POLICY));

export const parseGenerationVideoAdaptivePolicy = (
  raw: string | undefined,
): GenerationVideoAdaptivePolicy => {
  let overrides: Record<string, unknown> = {};
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be an object');
      overrides = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(`GENERATION_VIDEO_ADAPTIVE_POLICY_JSON must contain a valid JSON object: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const key of Object.keys(overrides)) {
    if (!knownPolicyKeys.has(key)) throw new Error(`GENERATION_VIDEO_ADAPTIVE_POLICY_JSON contains unknown field "${key}".`);
  }
  const policy = {
    ...DEFAULT_GENERATION_VIDEO_ADAPTIVE_POLICY,
    ...overrides,
  } as GenerationVideoAdaptivePolicy;
  for (const key of integerKeys) {
    if (!Number.isInteger(policy[key]) || Number(policy[key]) <= 0) {
      throw new Error(`GENERATION_VIDEO_ADAPTIVE_POLICY_JSON ${key} must be a positive integer.`);
    }
  }
  if (policy.policyVersion !== DEFAULT_GENERATION_VIDEO_ADAPTIVE_POLICY.policyVersion) {
    throw new Error(`GENERATION_VIDEO_ADAPTIVE_POLICY_JSON policyVersion must be ${DEFAULT_GENERATION_VIDEO_ADAPTIVE_POLICY.policyVersion}.`);
  }
  if (!Number.isFinite(policy.globalSubmitRatePerSecond) || policy.globalSubmitRatePerSecond <= 0) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON globalSubmitRatePerSecond must be positive.');
  }
  if (!Array.isArray(policy.optimisticWaves)
    || !policy.optimisticWaves.length
    || policy.optimisticWaves.some(value => !Number.isInteger(value) || value <= 0)
    || policy.optimisticWaves.some((value, index) => index > 0 && value <= policy.optimisticWaves[index - 1])) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON optimisticWaves must be a strictly increasing list of positive integers.');
  }
  if (policy.initialGlobalLimit > policy.hardLimit) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON initialGlobalLimit cannot exceed hardLimit.');
  }
  if (policy.initialGlobalLimit !== policy.hardLimit) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON initialGlobalLimit must equal hardLimit for the fixed platform window.');
  }
  if (policy.optimisticWaves[0] !== policy.coldStartLimit
    || policy.optimisticWaves.at(-1) !== policy.hardLimit
    || policy.optimisticWaves.some(value => value > policy.hardLimit)) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON optimisticWaves must start at coldStartLimit and end at hardLimit.');
  }
  if (policy.pollMinMs > policy.pollMaxMs) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON pollMinMs cannot exceed pollMaxMs.');
  }
  return policy;
};

export const capacityBucketKey = (configId: string, groupId?: string) => {
  const explicitGroup = String(groupId || '').trim();
  if (explicitGroup) return `group:${encodeURIComponent(explicitGroup)}`;
  return `model:${encodeURIComponent(configId.trim() || 'unknown-config')}`;
};

export const createInitialGenerationCapacityState = (
  policy: GenerationVideoAdaptivePolicy,
  now = Date.now(),
  initialWindow = policy.coldStartLimit,
): GenerationCapacityState => {
  const window = Math.max(1, Math.min(policy.hardLimit, Math.floor(initialWindow)));
  return {
    currentWindow: window,
    acceptedInWave: 0,
    phase: window >= policy.hardLimit ? 'stable' : 'slow_start',
    availabilityFailureTimes: [],
    lastActivityAt: now,
    submitTokens: policy.globalSubmitBurst,
    submitTokenUpdatedAt: now,
  };
};

const errorText = (error: Record<string, unknown>) => [
  error.errorType,
  error.error_type,
  error.errorCode,
  error.error_code,
  error.code,
  error.transportCode,
  error.message,
].filter(value => typeof value === 'string').join(' ').toLowerCase();

export const classifyGenerationCapacityEvidence = (
  outcome: GenerationCapacityOutcome,
): { kind: GenerationCapacityEvidenceKind; retryAfterMs?: number } => {
  const status = String(outcome.status || '').toLowerCase();
  if (status === 'submission_unknown') return { kind: 'neutral' };
  if (status !== 'failed') return { kind: 'neutral' };
  const error = outcome.error || {};
  const code = String(error.errorCode || error.error_code || error.code || '').toLowerCase();
  const type = String(error.errorType || error.error_type || '').toLowerCase();
  const httpStatus = Number(error.httpStatus ?? error.http_status ?? 0);
  const retryAfterMs = Number(error.retryAfterMs ?? error.retry_after_ms ?? 0) || undefined;
  const text = errorText(error);

  if (['validation_error', 'content_policy', 'file_not_found', 'model_not_found', 'insufficient_credits', 'billing', 'provider_configuration'].includes(code)
    || code === 'timeout'
    || code === 'generation_timeout'
    || /(?:timed?\s*out|timeout|1200\s*seconds)/i.test(text)) {
    return { kind: 'neutral' };
  }
  if (['concurrency_limit', 'queue_full', 'capacity_exceeded', 'too_many_active'].includes(code)
    || /(?:concurr|queue[_\s-]*(?:full|limit|capacity)|too many active)/i.test(`${type} ${text}`)) {
    return { kind: 'concurrency_limit', retryAfterMs };
  }
  if (['rpm_limit', 'rps_limit', 'qps_limit', 'request_rate_limit'].includes(code)
    || /(?:rpm|rps|qps|request[_\s-]*rate|requests? per|frequency)/i.test(`${type} ${text}`)) {
    return { kind: 'rate_limit', retryAfterMs };
  }
  if (httpStatus === 429 || code === 'rate_limited') {
    return { kind: 'ambiguous_429', retryAfterMs };
  }
  return { kind: 'neutral' };
};

const nextOptimisticWindow = (current: number, policy: GenerationVideoAdaptivePolicy) => {
  if (current < policy.coldStartLimit) return Math.min(policy.coldStartLimit, Math.max(current + 1, current * 2));
  return policy.optimisticWaves.find(value => value > current) || policy.hardLimit;
};

export const requiredGenerationCapacityAcceptances = (
  state: GenerationCapacityState,
  policy: GenerationVideoAdaptivePolicy,
) => {
  if (state.currentWindow >= policy.hardLimit) return 0;
  const next = nextOptimisticWindow(state.currentWindow, policy);
  return Math.max(1, Math.min(8, next - state.currentWindow));
};

export const markGenerationCapacitySubmissionAccepted = (
  state: GenerationCapacityState,
  now: number,
  policy: GenerationVideoAdaptivePolicy,
): GenerationCapacityState => {
  const base: GenerationCapacityState = {
    ...state,
    availabilityFailureTimes: [],
    lastEvidence: 'accepted',
    lastEvidenceAt: now,
    lastActivityAt: now,
    cooldownUntil: state.cooldownUntil && state.cooldownUntil > now ? state.cooldownUntil : undefined,
    circuitOpenUntil: state.circuitOpenUntil && state.circuitOpenUntil > now ? state.circuitOpenUntil : undefined,
  };
  if (base.currentWindow >= policy.hardLimit) return { ...base, acceptedInWave: 0, phase: 'stable' };
  const acceptedInWave = base.acceptedInWave + 1;
  const required = requiredGenerationCapacityAcceptances(base, policy);
  if (acceptedInWave < required) return { ...base, acceptedInWave, phase: 'slow_start' };
  const currentWindow = nextOptimisticWindow(base.currentWindow, policy);
  return {
    ...base,
    currentWindow,
    acceptedInWave: 0,
    phase: currentWindow >= policy.hardLimit ? 'stable' : 'slow_start',
  };
};

const halveWindow = (state: GenerationCapacityState) => Math.max(1, Math.floor(state.currentWindow / 2));

const reduceGenerationCapacity = (
  state: GenerationCapacityState,
  evidence: GenerationCapacityEvidence,
  policy: GenerationVideoAdaptivePolicy,
  cooldownMs = policy.capacityCooldownMs,
): GenerationCapacityState => ({
  ...state,
  currentWindow: halveWindow(state),
  acceptedInWave: 0,
  phase: 'cooling',
  cooldownUntil: evidence.observedAt + Math.max(cooldownMs, evidence.retryAfterMs || 0),
  lastEvidence: evidence.kind,
  lastEvidenceAt: evidence.observedAt,
  lastActivityAt: evidence.observedAt,
});

export const applyGenerationCapacityEvidence = (
  state: GenerationCapacityState,
  evidence: GenerationCapacityEvidence,
  policy: GenerationVideoAdaptivePolicy,
): GenerationCapacityState => {
  if (evidence.kind === 'accepted') {
    return markGenerationCapacitySubmissionAccepted(state, evidence.observedAt, policy);
  }
  const base: GenerationCapacityState = {
    ...state,
    availabilityFailureTimes: state.availabilityFailureTimes
      .filter(value => value >= evidence.observedAt - policy.availabilityFailureWindowMs),
    lastEvidence: evidence.kind,
    lastEvidenceAt: evidence.observedAt,
    lastActivityAt: evidence.observedAt,
  };
  if (evidence.kind === 'neutral') return base;
  if (evidence.kind === 'concurrency_limit') return reduceGenerationCapacity(base, evidence, policy);
  if (evidence.kind === 'rate_limit') {
    return {
      ...base,
      phase: 'rate_limited',
      cooldownUntil: evidence.observedAt + Math.max(policy.capacityCooldownMs, evidence.retryAfterMs || 0),
    };
  }
  if (evidence.kind === 'ambiguous_429') {
    const repeated = Boolean(base.lastAmbiguous429At
      && evidence.observedAt - base.lastAmbiguous429At <= policy.ambiguous429WindowMs);
    const paused: GenerationCapacityState = {
      ...base,
      phase: 'rate_limited',
      lastAmbiguous429At: evidence.observedAt,
      cooldownUntil: evidence.observedAt + Math.max(policy.capacityCooldownMs, evidence.retryAfterMs || 0),
    };
    return repeated ? reduceGenerationCapacity(paused, evidence, policy) : paused;
  }
  if (evidence.kind === 'availability' || evidence.kind === 'submission_unknown') return base;
  return base;
};

export const admitGenerationCapacity = (
  state: GenerationCapacityState,
  active: number,
  now = Date.now(),
): { admitted: boolean; reason?: string; state: GenerationCapacityState } => {
  if (state.circuitOpenUntil && state.circuitOpenUntil > now) {
    return { admitted: false, reason: 'circuit_open', state };
  }
  if (state.cooldownUntil && state.cooldownUntil > now) {
    return { admitted: false, reason: state.phase === 'rate_limited' ? 'rate_limited' : 'cooling', state };
  }
  if (active >= state.currentWindow) return { admitted: false, reason: 'window_full', state };
  return { admitted: true, state };
};

export const consumeGenerationSubmitToken = (
  state: GenerationCapacityState,
  ratePerMinute: number,
  burst: number,
  now = Date.now(),
): { allowed: boolean; retryAt?: number; state: GenerationCapacityState } => {
  const safeRate = Math.max(0.01, ratePerMinute);
  const safeBurst = Math.max(1, Math.floor(burst));
  const previousAt = state.submitTokenUpdatedAt || now;
  const previousTokens = state.submitTokens ?? safeBurst;
  const replenished = Math.min(
    safeBurst,
    previousTokens + Math.max(0, now - previousAt) * (safeRate / 60_000),
  );
  if (replenished < 1) {
    const waitMs = Math.ceil((1 - replenished) / (safeRate / 60_000));
    return {
      allowed: false,
      retryAt: now + waitMs,
      state: { ...state, submitTokens: replenished, submitTokenUpdatedAt: now, nextSubmitAt: now + waitMs },
    };
  }
  return {
    allowed: true,
    state: {
      ...state,
      submitTokens: replenished - 1,
      submitTokenUpdatedAt: now,
      nextSubmitAt: undefined,
      lastActivityAt: now,
    },
  };
};

export const refreshGenerationCapacityState = (
  state: GenerationCapacityState,
  configFingerprint: string | undefined,
  now: number,
  policy: GenerationVideoAdaptivePolicy,
): GenerationCapacityState => {
  const changed = Boolean(state.configFingerprint && configFingerprint && state.configFingerprint !== configFingerprint);
  const idle = now - state.lastActivityAt > policy.idleResetMs;
  if (!changed && !idle) {
    const cooldownUntil = state.cooldownUntil && state.cooldownUntil > now ? state.cooldownUntil : undefined;
    const circuitOpenUntil = state.circuitOpenUntil && state.circuitOpenUntil > now
      ? state.circuitOpenUntil
      : undefined;
    const phase = circuitOpenUntil
      ? 'circuit_open'
      : cooldownUntil
        ? state.phase
        : state.currentWindow >= policy.hardLimit ? 'stable' : 'slow_start';
    return {
      ...state,
      cooldownUntil,
      circuitOpenUntil,
      phase,
      configFingerprint: configFingerprint || state.configFingerprint,
    };
  }
  return {
    ...state,
    currentWindow: policy.coldStartLimit,
    acceptedInWave: 0,
    phase: 'slow_start',
    cooldownUntil: undefined,
    circuitOpenUntil: undefined,
    availabilityFailureTimes: [],
    lastActivityAt: now,
    configFingerprint: configFingerprint || state.configFingerprint,
  };
};
