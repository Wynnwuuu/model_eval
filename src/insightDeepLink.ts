export type InsightStatusFilter = 'all' | 'draft' | 'active' | 'completed';

export interface InsightDeepLinkState {
  projectId: string;
  statusFilter?: InsightStatusFilter;
  scope?: string;
}

const isStatusFilter = (value: string | null): value is Exclude<InsightStatusFilter, 'all'> =>
  value === 'draft' || value === 'active' || value === 'completed';

export const normalizeInsightScope = (value?: string | null) => {
  const scope = String(value || '').trim();
  return scope.startsWith('group:') || scope.startsWith('material:') ? scope : undefined;
};

export const parseInsightSearchParams = (searchParams: URLSearchParams) => ({
  statusFilter: isStatusFilter(searchParams.get('status')) ? searchParams.get('status') as Exclude<InsightStatusFilter, 'all'> : 'all' as const,
  ...(normalizeInsightScope(searchParams.get('scope')) ? { scope: normalizeInsightScope(searchParams.get('scope')) } : {}),
});

export const appendInsightSearchParams = (
  searchParams: URLSearchParams,
  state: Pick<InsightDeepLinkState, 'statusFilter' | 'scope'>,
) => {
  if (state.statusFilter && state.statusFilter !== 'all') {
    searchParams.set('status', state.statusFilter);
  }
  const scope = normalizeInsightScope(state.scope);
  if (scope) {
    searchParams.set('scope', scope);
  }
  return searchParams;
};

export const buildInsightPath = ({ projectId, statusFilter = 'all', scope }: InsightDeepLinkState) => {
  const searchParams = appendInsightSearchParams(new URLSearchParams(), { statusFilter, scope });
  const suffix = searchParams.toString();
  const path = `/projects/${encodeURIComponent(projectId)}/insights`;
  return suffix ? `${path}?${suffix}` : path;
};
