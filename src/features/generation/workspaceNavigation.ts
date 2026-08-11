import type { RouteContext } from '../../types.js';

export type GenerationWorkspaceView = 'tasks' | 'new';

export const isGenerationWorkspaceView = (value: unknown): value is GenerationWorkspaceView =>
  value === 'tasks' || value === 'new';

export const resolveGenerationWorkspaceView = ({
  requestedView,
  datasetId,
  batchId,
}: {
  requestedView?: unknown;
  datasetId?: string;
  batchId?: string;
}): GenerationWorkspaceView => {
  if (batchId) return 'tasks';
  if (isGenerationWorkspaceView(requestedView)) return requestedView;
  return datasetId ? 'new' : 'tasks';
};

export const resolveWorkspaceDataset = <T extends { id: string }>(
  datasets: T[],
  selectedDatasetId: string,
  allowFirstDatasetFallback: boolean,
) => datasets.find(dataset => dataset.id === selectedDatasetId)
  || (allowFirstDatasetFallback ? datasets[0] : undefined);

export const shouldClearGenerationWorkspaceDataset = <T extends { id: string }>(
  datasets: T[],
  selectedDatasetId: string,
) => Boolean(
  selectedDatasetId
  && datasets.length > 0
  && !datasets.some(dataset => dataset.id === selectedDatasetId),
);

export const buildGenerationRoutePath = (context: RouteContext = {}) => {
  const generationBatchId = context.generationBatchId?.trim();
  const view = resolveGenerationWorkspaceView({
    requestedView: context.generationView,
    datasetId: context.datasetId,
    batchId: generationBatchId,
  });
  const search = new URLSearchParams({ view });
  if (generationBatchId) search.set('batch', generationBatchId);
  const path = view === 'new' && context.datasetId
    ? `/datasets/${context.datasetId}/generation`
    : '/generation';
  return `${path}?${search.toString()}`;
};

export const parseGenerationRouteContext = (
  pathname: string,
  searchParams: URLSearchParams,
): RouteContext | null => {
  const path = pathname.replace(/\/+$/, '') || '/';
  const datasetMatch = path.match(/^\/datasets\/([^/]+)\/generation$/);
  if (path !== '/generation' && !datasetMatch) return null;

  const generationBatchId = searchParams.get('batch')?.trim() || undefined;
  const datasetId = datasetMatch?.[1];
  const generationView = resolveGenerationWorkspaceView({
    requestedView: searchParams.get('view'),
    datasetId,
    batchId: generationBatchId,
  });

  return {
    generationView,
    ...(generationView === 'new' && datasetId ? { datasetId, source: 'dataset' as const } : {}),
    ...(generationBatchId ? { generationBatchId } : {}),
  };
};
