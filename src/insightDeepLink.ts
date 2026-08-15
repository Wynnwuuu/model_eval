export type ReviewerScope = 'all' | 'mine';

export interface InsightDeepLinkState {
  projectId: string;
  scope?: string;
  reviewerScope?: ReviewerScope;
  source?: 'dashboard' | 'task';
}

export const normalizeInsightScope = (value?: string | null) => {
  const scope = String(value || '').trim();
  return scope.startsWith('material:') && scope.length > 'material:'.length ? scope : undefined;
};

export const parseInsightSearchParams = (searchParams: URLSearchParams) => ({
  reviewerScope: searchParams.get('reviewer') === 'mine' ? 'mine' as const : 'all' as const,
  ...(normalizeInsightScope(searchParams.get('scope')) ? { scope: normalizeInsightScope(searchParams.get('scope')) } : {}),
  ...(searchParams.get('source') === 'task' ? { source: 'task' as const } : {}),
});

export const appendInsightSearchParams = (
  searchParams: URLSearchParams,
  state: Pick<InsightDeepLinkState, 'scope' | 'reviewerScope' | 'source'>,
) => {
  const scope = normalizeInsightScope(state.scope);
  if (scope) {
    searchParams.set('scope', scope);
  }
  if (state.reviewerScope === 'mine') {
    searchParams.set('reviewer', 'mine');
  }
  if (state.source === 'task') {
    searchParams.set('source', 'task');
  }
  return searchParams;
};

export const buildInsightPath = ({ projectId, scope, reviewerScope = 'all', source }: InsightDeepLinkState) => {
  const searchParams = appendInsightSearchParams(new URLSearchParams(), { scope, reviewerScope, source });
  const suffix = searchParams.toString();
  const path = `/projects/${encodeURIComponent(projectId)}/insights`;
  return suffix ? `${path}?${suffix}` : path;
};
