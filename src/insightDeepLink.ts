export type ReviewerScope = 'all' | 'mine';

export interface InsightDeepLinkState {
  projectId: string;
  scope?: string;
  reviewerScope?: ReviewerScope;
}

export const normalizeInsightScope = (value?: string | null) => {
  const scope = String(value || '').trim();
  return scope.startsWith('material:') && scope.length > 'material:'.length ? scope : undefined;
};

export const parseInsightSearchParams = (searchParams: URLSearchParams) => ({
  reviewerScope: searchParams.get('reviewer') === 'mine' ? 'mine' as const : 'all' as const,
  ...(normalizeInsightScope(searchParams.get('scope')) ? { scope: normalizeInsightScope(searchParams.get('scope')) } : {}),
});

export const appendInsightSearchParams = (
  searchParams: URLSearchParams,
  state: Pick<InsightDeepLinkState, 'scope' | 'reviewerScope'>,
) => {
  const scope = normalizeInsightScope(state.scope);
  if (scope) {
    searchParams.set('scope', scope);
  }
  if (state.reviewerScope === 'mine') {
    searchParams.set('reviewer', 'mine');
  }
  return searchParams;
};

export const buildInsightPath = ({ projectId, scope, reviewerScope = 'all' }: InsightDeepLinkState) => {
  const searchParams = appendInsightSearchParams(new URLSearchParams(), { scope, reviewerScope });
  const suffix = searchParams.toString();
  const path = `/projects/${encodeURIComponent(projectId)}/insights`;
  return suffix ? `${path}?${suffix}` : path;
};
