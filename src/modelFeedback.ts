import { getModelOutputsForItem } from './rankingUtils';
import { getVoteReviewerKey } from './taskResults';
import type { EvaluationItem, EvaluationMethod, ModelOutput, VoteRecord } from './types';
import { isSkippedVote } from './voteUtils';

export const MODEL_FEEDBACK_MAX_LENGTH = 1000;

export type ModelFeedbackDraft = Record<string, string>;
export type ModelFeedbackCandidate = ModelOutput;

export interface ModelFeedbackEntry {
  modelId: string;
  modelName: string;
  itemId: string;
  reviewer: string;
  reviewerKey: string;
  timestamp?: number;
  reason: string;
}

export interface ModelFeedbackSummary {
  modelId: string;
  modelName: string;
  feedbackCount: number;
  caseCount: number;
  reviewerCount: number;
  entries: ModelFeedbackEntry[];
}

const normalizeText = (value: unknown) =>
  String(value || '').trim().slice(0, MODEL_FEEDBACK_MAX_LENGTH);

const withCurrentModelName = (
  output: ModelOutput,
  modelById: Map<string, { id: string; name: string }>,
): ModelFeedbackCandidate => ({
  ...output,
  modelName: modelById.get(output.modelId)?.name || output.modelName || output.modelId,
});

export const resolveModelFeedbackCandidates = (
  item: EvaluationItem | undefined,
  models: Array<{ id: string; name: string }> = [],
  method: EvaluationMethod = 'ab_preference',
): ModelFeedbackCandidate[] => {
  if (!item) return [];
  const modelById = new Map(models.map(model => [model.id, model]));

  if (method === 'pairwise' && item.pairContext) {
    const { pairContext } = item;
    return [
      {
        modelId: pairContext.modelAId,
        modelName: modelById.get(pairContext.modelAId)?.name || pairContext.modelAName || pairContext.modelAId,
        url: item.modelA_Url,
      },
      {
        modelId: pairContext.modelBId,
        modelName: modelById.get(pairContext.modelBId)?.name || pairContext.modelBName || pairContext.modelBId,
        url: item.modelB_Url,
      },
    ];
  }

  const outputs = getModelOutputsForItem(item, models).map(output => withCurrentModelName(output, modelById));
  if (method === 'ab_preference' || method === 'pairwise') return outputs.slice(0, 2);
  return outputs;
};

export const getModelFeedbackDraft = (vote?: Pick<VoteRecord, 'rubricResponses'>): ModelFeedbackDraft =>
  Object.values(vote?.rubricResponses || {}).reduce<ModelFeedbackDraft>((draft, response) => {
    const modelId = String(response.modelId || '').trim();
    const reason = normalizeText(response.reason);
    if (modelId && reason) draft[modelId] = reason;
    return draft;
  }, {});

export const getVoteModelFeedbackDetails = (vote?: Pick<VoteRecord, 'rubricResponses'>): string[] =>
  Object.entries(vote?.rubricResponses || {}).flatMap(([responseKey, response]) => {
    const reason = normalizeText(response.reason);
    if (!reason) return [];
    return [`${response.modelName || response.modelId || responseKey}：${reason}`];
  });

const normalizedDraftEntries = (draft: ModelFeedbackDraft = {}) =>
  Object.entries(draft)
    .map(([modelId, reason]) => [modelId, normalizeText(reason)] as const)
    .filter(([, reason]) => Boolean(reason))
    .sort(([left], [right]) => left.localeCompare(right));

export const hasModelFeedbackChanged = (
  vote: Pick<VoteRecord, 'rubricResponses'> | undefined,
  draft: ModelFeedbackDraft,
) => JSON.stringify(normalizedDraftEntries(getModelFeedbackDraft(vote)))
  !== JSON.stringify(normalizedDraftEntries(draft));

const hasResponseContentOtherThanReason = (
  response?: NonNullable<VoteRecord['rubricResponses']>[string],
) => Boolean(
  response
  && (Object.keys(response.scores || {}).length > 0 || Object.keys(response.answers || {}).length > 0),
);

export const applyModelFeedbackToVote = (
  vote: VoteRecord,
  candidates: ModelFeedbackCandidate[],
  draft: ModelFeedbackDraft,
): VoteRecord => {
  const nextResponses = { ...(vote.rubricResponses || {}) };

  candidates.forEach(candidate => {
    const existing = nextResponses[candidate.modelId];
    const reason = normalizeText(draft[candidate.modelId]);
    if (reason || hasResponseContentOtherThanReason(existing)) {
      nextResponses[candidate.modelId] = {
        modelId: candidate.modelId,
        modelName: candidate.modelName,
        scores: { ...(existing?.scores || {}) },
        ...(existing?.answers ? { answers: { ...existing.answers } } : {}),
        ...(reason ? { reason } : {}),
      };
    } else {
      delete nextResponses[candidate.modelId];
    }
  });

  const nextResponseValue = Object.keys(nextResponses).length ? nextResponses : undefined;
  const isScoreVote = vote.method === 'direct_score' || vote.method === 'rubric_score';
  const combinedReason = isScoreVote
    ? Object.values(nextResponses).map(response => normalizeText(response.reason)).filter(Boolean).join(' | ')
    : undefined;

  return {
    ...vote,
    rubricResponses: nextResponseValue,
    ...(isScoreVote ? { reason: combinedReason || undefined } : {}),
  };
};

export const buildModelFeedbackSummaries = ({
  votes,
  models = [],
}: {
  votes: VoteRecord[];
  models?: Array<{ id: string; name: string }>;
}): ModelFeedbackSummary[] => {
  type WorkingSummary = ModelFeedbackSummary & { cases: Set<string>; reviewers: Set<string>; order: number };
  const currentModelById = new Map(models.map(model => [model.id, model]));
  const summaries = new Map<string, WorkingSummary>();

  const ensureSummary = (modelId: string, fallbackName: string, order = Number.MAX_SAFE_INTEGER) => {
    const current = currentModelById.get(modelId);
    const existing = summaries.get(modelId);
    if (existing) return existing;
    const created: WorkingSummary = {
      modelId,
      modelName: current?.name || fallbackName || modelId,
      feedbackCount: 0,
      caseCount: 0,
      reviewerCount: 0,
      entries: [],
      cases: new Set<string>(),
      reviewers: new Set<string>(),
      order,
    };
    summaries.set(modelId, created);
    return created;
  };

  models.forEach((model, index) => ensureSummary(model.id, model.name, index));

  votes.filter(vote => !isSkippedVote(vote)).forEach(vote => {
    const reviewerKey = getVoteReviewerKey(vote);
    Object.entries(vote.rubricResponses || {}).forEach(([responseKey, response]) => {
      const reason = normalizeText(response.reason);
      if (!reason) return;
      const modelId = String(response.modelId || responseKey).trim();
      if (!modelId) return;
      const summary = ensureSummary(modelId, response.modelName || modelId);
      const caseId = vote.itemSnapshot?.originalItemId || vote.pairContext?.originalItemId || vote.itemId;
      summary.entries.push({
        modelId,
        modelName: summary.modelName,
        itemId: caseId,
        reviewer: vote.user || '匿名评委',
        reviewerKey,
        timestamp: vote.timestamp,
        reason,
      });
      summary.cases.add(caseId);
      summary.reviewers.add(reviewerKey);
    });
  });

  return Array.from(summaries.values())
    .map(summary => ({
      modelId: summary.modelId,
      modelName: summary.modelName,
      feedbackCount: summary.entries.length,
      caseCount: summary.cases.size,
      reviewerCount: summary.reviewers.size,
      entries: summary.entries.sort((left, right) =>
        (left.timestamp || 0) - (right.timestamp || 0) || left.itemId.localeCompare(right.itemId)
      ),
      order: summary.order,
    }))
    .sort((left, right) => left.order - right.order || left.modelName.localeCompare(right.modelName))
    .map(({ order: _order, ...summary }) => summary);
};
