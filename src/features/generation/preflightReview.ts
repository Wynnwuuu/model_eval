import type {
  GenerationCaseReview,
  GenerationContractFinding,
  GenerationPreflightCase,
  DatasetSchemaField,
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

const promptFindingIds = (item: GenerationPreflightCase) => new Set(
  ((item.resolvedCase.compilerAudit?.contractFindings || []) as GenerationContractFinding[])
    .filter(finding => finding.field === 'prompt' || finding.proposal?.kind === 'prompt_rewrite')
    .map(finding => finding.id),
);

const isPromptFindingId = (id: string, ids: Set<string>) =>
  ids.has(id) || id.startsWith('plugin-prompt-');

const hasPromptReview = (item: GenerationPreflightCase, review: GenerationCaseReview) => {
  const ids = promptFindingIds(item);
  return Boolean(
    review.promptColumnOverride
    || review.promptOverride !== undefined
    || review.inputOverride?.content?.prompt
    || review.acceptedFindingIds?.some(id => isPromptFindingId(id, ids))
    || review.rejectedFindingIds?.some(id => isPromptFindingId(id, ids)),
  );
};

const withoutPromptReview = (
  item: GenerationPreflightCase,
  review: GenerationCaseReview,
): GenerationCaseReview => {
  const next = JSON.parse(JSON.stringify(review)) as GenerationCaseReview;
  const ids = promptFindingIds(item);
  delete next.promptOverride;
  if (next.inputOverride?.content?.prompt) delete next.inputOverride.content.prompt;
  if (next.inputOverride
    && !Object.keys(next.inputOverride.content || {}).length
    && !Object.keys(next.inputOverride.parameters || {}).length) {
    delete next.inputOverride;
  }
  const accepted = (next.acceptedFindingIds || []).filter(id => !isPromptFindingId(id, ids));
  const rejected = (next.rejectedFindingIds || []).filter(id => !isPromptFindingId(id, ids));
  if (accepted.length) next.acceptedFindingIds = accepted;
  else delete next.acceptedFindingIds;
  if (rejected.length) next.rejectedFindingIds = rejected;
  else delete next.rejectedFindingIds;
  return next;
};

export const applyBulkPromptColumnReview = ({
  cases,
  reviews,
  column,
}: {
  cases: GenerationPreflightCase[];
  reviews: Record<string, GenerationCaseReview>;
  column: string;
}): {
  reviews: Record<string, GenerationCaseReview>;
  targetIds: string[];
  overwrittenPromptReviewCount: number;
  expertConflictIds: string[];
  missingStableIdCount: number;
} => {
  const targets = cases.filter(item => item.errors.some(issue => issue.code === 'PROMPT_TOO_LONG'));
  const missingStableIdCount = targets.filter(item => !String(item.resolvedCase.datasetItemId || '')).length;
  const targetIds = Array.from(new Set(targets
    .map(item => String(item.resolvedCase.datasetItemId || ''))
    .filter(Boolean)));
  const effectiveReview = (item: GenerationPreflightCase) => {
    const id = String(item.resolvedCase.datasetItemId || '');
    return reviews[id] || item.resolvedCase.compilerAudit?.review || {};
  };
  const expertConflictIds = targets.flatMap(item => {
    const id = String(item.resolvedCase.datasetItemId || '');
    return id && effectiveReview(item).finalAionRequest ? [id] : [];
  });
  const overwrittenPromptReviewCount = targets.filter(item => {
    const id = String(item.resolvedCase.datasetItemId || '');
    return id ? hasPromptReview(item, effectiveReview(item)) : false;
  }).length;
  if (expertConflictIds.length || missingStableIdCount || !column.trim()) {
    return { reviews, targetIds, overwrittenPromptReviewCount, expertConflictIds, missingStableIdCount };
  }

  const next = { ...reviews };
  targets.forEach(item => {
    const datasetItemId = String(item.resolvedCase.datasetItemId || '');
    if (!datasetItemId) return;
    next[datasetItemId] = {
      ...withoutPromptReview(item, effectiveReview(item)),
      promptColumnOverride: { version: 1, column },
    };
  });
  return { reviews: next, targetIds, overwrittenPromptReviewCount, expertConflictIds, missingStableIdCount };
};

export const generationPromptReplacementColumns = ({
  headers,
  inputSchema,
  primaryPromptColumn,
  outputColumns,
  referenceColumns,
}: {
  headers: string[];
  inputSchema: DatasetSchemaField[];
  primaryPromptColumn?: string;
  outputColumns: string[];
  referenceColumns?: string[];
}) => {
  const fields = new Map(inputSchema.map(field => [field.key, field]));
  const outputs = new Set(outputColumns);
  const references = new Set(referenceColumns || []);
  return headers.filter(column => {
    if (!column || column === primaryPromptColumn || column === '_originalData' || column.startsWith('__')) return false;
    if (outputs.has(column) || references.has(column)) return false;
    const field = fields.get(column);
    if (!field) return true;
    if (field.type !== 'text') return false;
    return !['output', 'system', 'media', 'reference', 'case_id', 'dimension', 'rubric']
      .includes(String(field.role || ''));
  });
};
