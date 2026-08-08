import type {
  GenerationCaseReview,
  GenerationPreflightCase,
} from '../../types.js';

export const GENERATION_FORCEABLE_PREFLIGHT_CODES = new Set([
  'CONTRACT_REVIEW_REQUIRED',
  'GENERATION_TYPE_REVIEW_REQUIRED',
  'RELATIVE_ASSET_REQUIRES_REVIEW',
  'AUDIO_ONLY_MODE_REVIEW_REQUIRED',
  'UNSUPPORTED_INPUT',
  'UNSUPPORTED_GENERATION_TYPE',
  'MISSING_REQUIRED_INPUT',
  'INPUT_COUNT_OUT_OF_RANGE',
  'MULTIPLE_AUDIOS_REQUIRE_AUDIOS',
  'AUDIO_RANGE_REQUIRES_AUDIOS',
  'MCP_AION_PROJECTION_MISMATCH',
  'UNSUPPORTED_PRESET_PARAMETER',
  'MEDIA_TYPE_MISMATCH',
  'NON_PUBLIC_ASSET_URL',
]);

export const GENERATION_FINAL_JSON_REQUIRED_CODES = new Set([
  'GENERATION_TYPE_REVIEW_REQUIRED',
  'AUDIO_ONLY_MODE_REVIEW_REQUIRED',
  'UNSUPPORTED_GENERATION_TYPE',
  'UNSUPPORTED_PRESET_PARAMETER',
]);

export const generationForceRequiresFinalJson = (codes: Iterable<string>) =>
  Array.from(codes).some(code => GENERATION_FINAL_JSON_REQUIRED_CODES.has(code));

export const generationForceBypassableCodes = ({
  errorCodes,
  selectedRuleCodes,
  hasFinalAionRequest,
}: {
  errorCodes: Iterable<string>;
  selectedRuleCodes?: Iterable<string>;
  hasFinalAionRequest: boolean;
}) => {
  const selected = selectedRuleCodes ? new Set(selectedRuleCodes) : undefined;
  return Array.from(new Set(errorCodes)).filter(code =>
    GENERATION_FORCEABLE_PREFLIGHT_CODES.has(code)
    && (!selected || selected.has(code))
    && (hasFinalAionRequest || !GENERATION_FINAL_JSON_REQUIRED_CODES.has(code)));
};

export const generationPendingForceCodes = ({
  errorCodes,
  selectedRuleCodes,
  bypassedCodes,
}: {
  errorCodes: Iterable<string>;
  selectedRuleCodes?: Iterable<string>;
  bypassedCodes: Iterable<string>;
}) => {
  const selected = selectedRuleCodes
    ? new Set(selectedRuleCodes)
    : new Set(Array.from(errorCodes).filter(code => GENERATION_FORCEABLE_PREFLIGHT_CODES.has(code)));
  const bypassed = new Set(bypassedCodes);
  return Array.from(selected).filter(code => !bypassed.has(code));
};

export const applyBulkGenerationForceReview = ({
  cases,
  reviews,
  errorCode,
  reason,
  duplicateBillingRiskConfirmed,
}: {
  cases: GenerationPreflightCase[];
  reviews: Record<string, GenerationCaseReview>;
  errorCode: string;
  reason: string;
  duplicateBillingRiskConfirmed: boolean;
}) => {
  if (!GENERATION_FORCEABLE_PREFLIGHT_CODES.has(errorCode)) return reviews;
  const next = { ...reviews };
  cases.forEach(item => {
    if (!item.errors.some(issue => issue.code === errorCode)) return;
    const datasetItemId = String(item.resolvedCase.datasetItemId || '');
    if (!datasetItemId) return;
    const current = next[datasetItemId] || {};
    const currentCodes = current.force?.ruleCodes;
    next[datasetItemId] = {
      ...current,
      force: {
        reason,
        duplicateBillingRiskConfirmed,
        ruleCodes: currentCodes
          ? Array.from(new Set([...currentCodes, errorCode]))
          : [errorCode],
      },
    };
  });
  return next;
};
