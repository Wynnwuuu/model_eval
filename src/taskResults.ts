import type { EvalTask, TaskVoteGroup, VoteRecord } from './types';

const FALLBACK_REVIEWER = 'Anonymous';

const cleanIdentity = (value?: string) => String(value || '').trim();

export const buildTaskResultsPath = (taskId: string) =>
  `/tasks/${encodeURIComponent(taskId)}/results`;

export const getTaskResultTargetId = (
  taskIds: string[],
  selectedTaskId?: string,
): string | undefined => {
  const uniqueTaskIds = Array.from(new Set(taskIds.map(cleanIdentity).filter(Boolean)));
  const selected = cleanIdentity(selectedTaskId);
  return selected && uniqueTaskIds.includes(selected) ? selected : uniqueTaskIds[0];
};

export const getLegacyTaskInsightsRedirect = (
  pathname: string,
  _searchParams?: URLSearchParams,
): { taskId: string; redirectTo: string } | null => {
  const path = pathname.replace(/\/+$/, '') || '/';
  const match = path.match(/^\/tasks\/([^/]+)\/insights$/);
  if (!match) return null;

  const taskId = decodeURIComponent(match[1]);
  return { taskId, redirectTo: buildTaskResultsPath(taskId) };
};

export const hasSubmittedTaskResults = (task: Pick<EvalTask, 'progress'>): boolean =>
  Object.values(task.progress || {}).some(value => Number(value) > 0);

export interface TaskResultEntryState {
  visible: boolean;
  enabled: boolean;
  label: '查看评测结果' | '尚无已提交结果';
}

export const getTaskResultEntryState = (
  task: Pick<EvalTask, 'status' | 'progress'>,
): TaskResultEntryState => {
  const enabled = task.status !== 'draft' && hasSubmittedTaskResults(task);
  return {
    visible: task.status === 'active' || task.status === 'completed',
    enabled,
    label: enabled ? '查看评测结果' : '尚无已提交结果',
  };
};

export const getVoteReviewerKey = (vote: Pick<VoteRecord, 'reviewerKey' | 'user'>): string =>
  cleanIdentity(vote.reviewerKey) || cleanIdentity(vote.user) || FALLBACK_REVIEWER;

export const getTaskVoteGroupReviewerKey = (
  group: Pick<TaskVoteGroup, 'userId' | 'email' | 'user' | 'displayName'>,
): string =>
  cleanIdentity(group.userId)
  || cleanIdentity(group.email)
  || cleanIdentity(group.user)
  || cleanIdentity(group.displayName)
  || FALLBACK_REVIEWER;

export const isTaskVoteGroupForReviewer = (
  group: Pick<TaskVoteGroup, 'userId' | 'email' | 'user' | 'displayName'>,
  reviewer: { id?: string; email?: string; displayName?: string },
): boolean => {
  const groupStableKeys = [group.userId, group.email].map(cleanIdentity).filter(Boolean);
  const reviewerStableKeys = [reviewer.id, reviewer.email].map(cleanIdentity).filter(Boolean);
  if (groupStableKeys.length && reviewerStableKeys.length) {
    return groupStableKeys.some(key => reviewerStableKeys.includes(key));
  }

  const groupLegacyKeys = [group.user, group.displayName].map(cleanIdentity).filter(Boolean);
  const reviewerLegacyKeys = [reviewer.id, reviewer.email, reviewer.displayName].map(cleanIdentity).filter(Boolean);
  return groupLegacyKeys.some(key => reviewerLegacyKeys.includes(key));
};

export const withTaskVoteGroupReviewer = (group: TaskVoteGroup): VoteRecord[] => {
  const reviewerKey = getTaskVoteGroupReviewerKey(group);
  const displayName = cleanIdentity(group.displayName)
    || cleanIdentity(group.user)
    || cleanIdentity(group.email)
    || FALLBACK_REVIEWER;

  return (group.votes || []).map(vote => ({
    ...vote,
    user: cleanIdentity(vote.user) || displayName,
    reviewerKey: cleanIdentity(vote.reviewerKey) || reviewerKey,
  }));
};

export const countUniqueReviewers = (votes: Array<Pick<VoteRecord, 'reviewerKey' | 'user'>>): number =>
  new Set(votes.map(getVoteReviewerKey)).size;
