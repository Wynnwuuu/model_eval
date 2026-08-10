export type GenerationCapacityPhase =
  | 'slow_start'
  | 'stable'
  | 'congestion_avoidance'
  | 'rate_limited'
  | 'cooling'
  | 'circuit_open';

export type GenerationCapacityEvidenceKind =
  | 'success'
  | 'concurrency_limit'
  | 'rate_limit'
  | 'ambiguous_429'
  | 'availability'
  | 'submission_unknown'
  | 'timeout'
  | 'neutral';

export type GenerationVideoAdaptivePolicy = {
  policyVersion: number;
  hardLimit: number;
  initialGlobalLimit: number;
  coldStartLimit: number;
  warmStartLimit: number;
  idleResetMs: number;
  historyWindowMs: number;
  saturationRatio: number;
  slowStartTargets: number[];
  maxSuccessesPerWave: number;
  globalSubmitRatePerSecond: number;
  globalSubmitBurst: number;
  bucketInitialRatePerMinute: number;
  bucketMaxRatePerMinute: number;
  ambiguous429WindowMs: number;
  submissionUnknownCooldownMs: number;
  availabilityFailureWindowMs: number;
  availabilityFailureThreshold: number;
  bucketCircuitMs: number;
  timeoutMinCount: number;
  timeoutFailureRate: number;
  timeoutSampleSize: number;
  pollMinMs: number;
  pollMaxMs: number;
  submitWorkers: number;
  pollWorkers: number;
  shadowMs: number;
};

export type GenerationCapacityState = {
  currentWindow: number;
  verifiedWindow: number;
  recoveryThreshold: number;
  saturatedSuccesses: number;
  submitRatePerMinute: number;
  phase: GenerationCapacityPhase;
  probeInFlight: boolean;
  congestionSeen: boolean;
  cooldownUntil?: number;
  circuitOpenUntil?: number;
  lastAmbiguous429At?: number;
  availabilityFailureTimes: number[];
  recentSaturatedOutcomes: Array<'success' | 'timeout'>;
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
  policyVersion: 2,
  hardLimit: 48,
  initialGlobalLimit: 12,
  coldStartLimit: 2,
  warmStartLimit: 4,
  idleResetMs: 24 * 60 * 60 * 1000,
  historyWindowMs: 7 * 24 * 60 * 60 * 1000,
  saturationRatio: 0.75,
  slowStartTargets: [2, 4, 8, 16, 32, 48],
  maxSuccessesPerWave: 8,
  globalSubmitRatePerSecond: 1,
  globalSubmitBurst: 2,
  bucketInitialRatePerMinute: 20,
  bucketMaxRatePerMinute: 60,
  ambiguous429WindowMs: 10 * 60 * 1000,
  submissionUnknownCooldownMs: 5 * 60 * 1000,
  availabilityFailureWindowMs: 2 * 60 * 1000,
  availabilityFailureThreshold: 3,
  bucketCircuitMs: 2 * 60 * 1000,
  timeoutMinCount: 2,
  timeoutFailureRate: 0.3,
  timeoutSampleSize: 20,
  pollMinMs: 10_000,
  pollMaxMs: 30_000,
  submitWorkers: 2,
  pollWorkers: 6,
  shadowMs: 10 * 60 * 1000,
};

const integerKeys = new Set<keyof GenerationVideoAdaptivePolicy>([
  'policyVersion',
  'hardLimit',
  'initialGlobalLimit',
  'coldStartLimit',
  'warmStartLimit',
  'idleResetMs',
  'historyWindowMs',
  'maxSuccessesPerWave',
  'globalSubmitBurst',
  'bucketInitialRatePerMinute',
  'bucketMaxRatePerMinute',
  'ambiguous429WindowMs',
  'submissionUnknownCooldownMs',
  'availabilityFailureWindowMs',
  'availabilityFailureThreshold',
  'bucketCircuitMs',
  'timeoutMinCount',
  'timeoutSampleSize',
  'pollMinMs',
  'pollMaxMs',
  'submitWorkers',
  'pollWorkers',
  'shadowMs',
]);

const ratioKeys = new Set<keyof GenerationVideoAdaptivePolicy>([
  'saturationRatio',
  'timeoutFailureRate',
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
  for (const key of ratioKeys) {
    if (!Number.isFinite(policy[key]) || Number(policy[key]) <= 0 || Number(policy[key]) > 1) {
      throw new Error(`GENERATION_VIDEO_ADAPTIVE_POLICY_JSON ${key} must be greater than zero and at most one.`);
    }
  }
  if (!Number.isFinite(policy.globalSubmitRatePerSecond) || policy.globalSubmitRatePerSecond <= 0) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON globalSubmitRatePerSecond must be positive.');
  }
  if (!Array.isArray(policy.slowStartTargets)
    || !policy.slowStartTargets.length
    || policy.slowStartTargets.some(value => !Number.isInteger(value) || value <= 0)
    || policy.slowStartTargets.some((value, index) => index > 0 && value <= policy.slowStartTargets[index - 1])) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON slowStartTargets must be a strictly increasing list of positive integers.');
  }
  if (policy.initialGlobalLimit > policy.hardLimit) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON initialGlobalLimit cannot exceed hardLimit.');
  }
  if (policy.coldStartLimit > policy.warmStartLimit || policy.warmStartLimit > policy.hardLimit) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON requires coldStartLimit <= warmStartLimit <= hardLimit.');
  }
  if (policy.bucketInitialRatePerMinute > policy.bucketMaxRatePerMinute) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON bucketInitialRatePerMinute cannot exceed bucketMaxRatePerMinute.');
  }
  if (policy.pollMinMs > policy.pollMaxMs) {
    throw new Error('GENERATION_VIDEO_ADAPTIVE_POLICY_JSON pollMinMs cannot exceed pollMaxMs.');
  }
  return policy;
};

export const generationGlobalCapacityPolicy = (
  policy: GenerationVideoAdaptivePolicy,
): GenerationVideoAdaptivePolicy => ({
  ...policy,
  slowStartTargets: Array.from(new Set([
    policy.initialGlobalLimit,
    Math.min(policy.hardLimit, policy.initialGlobalLimit * 2),
    policy.hardLimit,
  ])).sort((left, right) => left - right),
});

export const capacityBucketKey = (configId: string, generationType: string) =>
  `${encodeURIComponent(configId.trim() || 'unknown-config')}::${generationType.trim() || 'unknown_generation'}`;

export const createInitialGenerationCapacityState = (
  policy: GenerationVideoAdaptivePolicy,
  now = Date.now(),
  initialWindow = policy.coldStartLimit,
): GenerationCapacityState => {
  const window = Math.max(1, Math.min(policy.hardLimit, Math.floor(initialWindow)));
  return {
    currentWindow: window,
    verifiedWindow: window,
    recoveryThreshold: window,
    saturatedSuccesses: 0,
    submitRatePerMinute: policy.bucketInitialRatePerMinute,
    phase: 'slow_start',
    probeInFlight: false,
    congestionSeen: false,
    availabilityFailureTimes: [],
    recentSaturatedOutcomes: [],
    lastActivityAt: now,
    submitTokens: 1,
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
  if (status === 'succeeded' || status === 'completed') return { kind: 'success' };
  if (status === 'submission_unknown') return { kind: 'submission_unknown' };
  if (status !== 'failed') return { kind: 'neutral' };
  const error = outcome.error || {};
  const code = String(error.errorCode || error.error_code || error.code || '').toLowerCase();
  const type = String(error.errorType || error.error_type || '').toLowerCase();
  const httpStatus = Number(error.httpStatus ?? error.http_status ?? 0);
  const retryable = error.retryable === true || String(error.retryable).toLowerCase() === 'true';
  const retryAfterMs = Number(error.retryAfterMs ?? error.retry_after_ms ?? 0) || undefined;
  const text = errorText(error);

  if (['aion_submission_unknown', 'interrupted_submission', 'missing_provider_task_id', 'reconciliation_expired'].includes(code)) {
    return { kind: 'submission_unknown', retryAfterMs };
  }
  if (['validation_error', 'content_policy', 'file_not_found', 'model_not_found', 'insufficient_credits', 'billing', 'provider_configuration'].includes(code)) {
    return { kind: 'neutral' };
  }
  if (code === 'timeout' || code === 'generation_timeout' || /(?:^|\s)(?:timed?\s*out|timeout|1200\s*seconds)(?:\s|$)/i.test(text)) {
    return { kind: 'timeout', retryAfterMs };
  }
  if (httpStatus === 429 || code === 'rate_limited') {
    if (/(?:concurr|queue[_\s-]*(?:full|limit|capacity)|too many active)/i.test(`${type} ${text}`)) {
      return { kind: 'concurrency_limit', retryAfterMs };
    }
    if (/(?:rpm|rps|qps|request[_\s-]*rate|requests? per|frequency)/i.test(`${type} ${text}`)) {
      return { kind: 'rate_limit', retryAfterMs };
    }
    return { kind: 'ambiguous_429', retryAfterMs };
  }
  if (['provider_unavailable', 'upstream_failure', 'provider_account_unavailable'].includes(code)
    || httpStatus >= 500
    || retryable
    || /(?:econn|network|socket|service unavailable|temporarily unavailable)/i.test(text)) {
    return { kind: 'availability', retryAfterMs };
  }
  return { kind: 'neutral' };
};

const isSaturated = (
  evidence: GenerationCapacityEvidence,
  policy: GenerationVideoAdaptivePolicy,
) => {
  const active = Math.max(0, Number(evidence.activeAtSubmit || 0));
  const limit = Math.max(1, Number(evidence.limitAtSubmit || 1));
  return active >= Math.ceil(limit * policy.saturationRatio);
};

const nextSlowStartTarget = (current: number, policy: GenerationVideoAdaptivePolicy) =>
  policy.slowStartTargets.find(target => target > current) || policy.hardLimit;

const shrinkToBoundary = (state: GenerationCapacityState, activeAtSubmit?: number) => {
  const discoveredBoundary = Number.isFinite(activeAtSubmit) && Number(activeAtSubmit) > 0
    ? Math.max(1, Math.floor(Number(activeAtSubmit)) - 1)
    : Math.max(1, Math.floor(state.currentWindow / 2));
  return Math.max(1, Math.min(state.currentWindow, discoveredBoundary));
};

const applyConcurrencyReduction = (
  state: GenerationCapacityState,
  evidence: GenerationCapacityEvidence,
  policy: GenerationVideoAdaptivePolicy,
  boundary = shrinkToBoundary(state, evidence.activeAtSubmit),
): GenerationCapacityState => ({
  ...state,
  currentWindow: boundary,
  verifiedWindow: Math.min(state.verifiedWindow, boundary),
  recoveryThreshold: Math.max(state.recoveryThreshold, state.verifiedWindow),
  saturatedSuccesses: 0,
  phase: 'cooling',
  probeInFlight: false,
  congestionSeen: true,
  cooldownUntil: evidence.observedAt + Math.max(60_000, evidence.retryAfterMs || 0),
  lastEvidence: evidence.kind,
  lastEvidenceAt: evidence.observedAt,
  lastActivityAt: evidence.observedAt,
});

export const applyGenerationCapacityEvidence = (
  state: GenerationCapacityState,
  evidence: GenerationCapacityEvidence,
  policy: GenerationVideoAdaptivePolicy,
): GenerationCapacityState => {
  const base: GenerationCapacityState = {
    ...state,
    availabilityFailureTimes: state.availabilityFailureTimes
      .filter(value => value >= evidence.observedAt - policy.availabilityFailureWindowMs),
    lastEvidence: evidence.kind,
    lastEvidenceAt: evidence.observedAt,
    lastActivityAt: evidence.observedAt,
  };
  if (evidence.kind === 'neutral') return base;
  if (evidence.kind === 'concurrency_limit') {
    return applyConcurrencyReduction(base, evidence, policy);
  }
  if (evidence.kind === 'rate_limit') {
    return {
      ...base,
      phase: 'rate_limited',
      submitRatePerMinute: Math.max(1, Math.floor(base.submitRatePerMinute / 2)),
      cooldownUntil: evidence.observedAt + Math.max(60_000, evidence.retryAfterMs || 0),
    };
  }
  if (evidence.kind === 'ambiguous_429') {
    const repeated = Boolean(base.lastAmbiguous429At
      && evidence.observedAt - base.lastAmbiguous429At <= policy.ambiguous429WindowMs);
    const rateLimited = {
      ...base,
      phase: 'rate_limited' as const,
      submitRatePerMinute: Math.max(1, Math.floor(base.submitRatePerMinute / 2)),
      lastAmbiguous429At: evidence.observedAt,
      cooldownUntil: evidence.observedAt + Math.max(60_000, evidence.retryAfterMs || 0),
    };
    return repeated
      ? applyConcurrencyReduction(
          rateLimited,
          evidence,
          policy,
          Math.max(1, Math.floor(rateLimited.currentWindow / 2)),
        )
      : rateLimited;
  }
  if (evidence.kind === 'availability') {
    const failures = [...base.availabilityFailureTimes, evidence.observedAt];
    if (failures.length < policy.availabilityFailureThreshold) {
      return { ...base, availabilityFailureTimes: failures };
    }
    return {
      ...base,
      availabilityFailureTimes: failures,
      phase: 'circuit_open',
      circuitOpenUntil: evidence.observedAt + Math.max(policy.bucketCircuitMs, evidence.retryAfterMs || 0),
      probeInFlight: false,
    };
  }
  if (evidence.kind === 'submission_unknown') {
    const boundary = Math.max(1, Math.floor(base.currentWindow / 2));
    return {
      ...applyConcurrencyReduction(base, evidence, policy, boundary),
      cooldownUntil: evidence.observedAt + policy.submissionUnknownCooldownMs,
    };
  }

  const saturated = isSaturated(evidence, policy);
  const recentSaturatedOutcomes = saturated && (evidence.kind === 'success' || evidence.kind === 'timeout')
    ? [...base.recentSaturatedOutcomes, evidence.kind].slice(-policy.timeoutSampleSize)
    : base.recentSaturatedOutcomes;
  if (evidence.kind === 'timeout') {
    const timeoutCount = recentSaturatedOutcomes.filter(value => value === 'timeout').length;
    const timeoutRate = recentSaturatedOutcomes.length ? timeoutCount / recentSaturatedOutcomes.length : 0;
    if (saturated && timeoutCount >= policy.timeoutMinCount && timeoutRate >= policy.timeoutFailureRate) {
      return {
        ...applyConcurrencyReduction(
          { ...base, recentSaturatedOutcomes },
          evidence,
          policy,
          Math.max(1, Math.floor(base.currentWindow / 2)),
        ),
        recentSaturatedOutcomes,
      };
    }
    return { ...base, recentSaturatedOutcomes };
  }

  if (!saturated) return { ...base, recentSaturatedOutcomes };
  const saturatedSuccesses = base.saturatedSuccesses + 1;
  const required = Math.max(2, Math.min(base.currentWindow, policy.maxSuccessesPerWave));
  if (saturatedSuccesses < required || base.currentWindow >= policy.hardLimit) {
    return {
      ...base,
      recentSaturatedOutcomes,
      saturatedSuccesses,
      phase: base.currentWindow >= policy.hardLimit ? 'stable' : base.phase,
    };
  }
  const target = base.congestionSeen
    ? Math.min(policy.hardLimit, base.currentWindow + 1)
    : Math.min(policy.hardLimit, nextSlowStartTarget(base.currentWindow, policy));
  return {
    ...base,
    currentWindow: target,
    recentSaturatedOutcomes,
    saturatedSuccesses: 0,
    submitRatePerMinute: Math.min(
      policy.bucketMaxRatePerMinute,
      Math.max(base.submitRatePerMinute + 1, Math.ceil(base.submitRatePerMinute * 1.25)),
    ),
    phase: target >= policy.hardLimit ? 'stable' : base.congestionSeen ? 'congestion_avoidance' : 'slow_start',
  };
};

export const admitGenerationCapacityProbe = (
  state: GenerationCapacityState,
  active: number,
  now = Date.now(),
): { admitted: boolean; probing: boolean; reason?: string; state: GenerationCapacityState } => {
  if (state.circuitOpenUntil && state.circuitOpenUntil > now) {
    return { admitted: false, probing: false, reason: 'circuit_open', state };
  }
  if (state.cooldownUntil && state.cooldownUntil > now) {
    return { admitted: false, probing: false, reason: 'cooling', state };
  }
  if (active >= state.currentWindow) {
    return { admitted: false, probing: false, reason: 'window_full', state };
  }
  if (active < state.verifiedWindow) {
    return { admitted: true, probing: false, state };
  }
  if (state.probeInFlight || state.verifiedWindow >= state.currentWindow) {
    return { admitted: false, probing: false, reason: 'probe_pending', state };
  }
  return {
    admitted: true,
    probing: true,
    state: { ...state, probeInFlight: true, lastActivityAt: now },
  };
};

export const markGenerationCapacityProbeAccepted = (
  state: GenerationCapacityState,
  now = Date.now(),
): GenerationCapacityState => ({
  ...state,
  verifiedWindow: state.probeInFlight
    ? Math.min(state.currentWindow, state.verifiedWindow + 1)
    : state.verifiedWindow,
  recoveryThreshold: state.probeInFlight
    ? Math.max(state.recoveryThreshold, Math.min(state.currentWindow, state.verifiedWindow + 1))
    : state.recoveryThreshold,
  probeInFlight: false,
  lastActivityAt: now,
});

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
      state: {
        ...state,
        submitTokens: replenished,
        submitTokenUpdatedAt: now,
        nextSubmitAt: now + waitMs,
      },
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
    return { ...state, configFingerprint: configFingerprint || state.configFingerprint };
  }
  const resetWindow = Math.max(1, Math.min(state.currentWindow, policy.warmStartLimit));
  return {
    ...state,
    currentWindow: resetWindow,
    verifiedWindow: Math.min(state.verifiedWindow, resetWindow),
    saturatedSuccesses: 0,
    phase: 'slow_start',
    probeInFlight: false,
    cooldownUntil: undefined,
    circuitOpenUntil: undefined,
    lastActivityAt: now,
    configFingerprint: configFingerprint || state.configFingerprint,
  };
};
