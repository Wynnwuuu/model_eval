import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { FeishuCallbackScreen } from '../components/FeishuCallbackScreen';
import { LoginScreen } from '../components/LoginScreen';
import { ModelEvalApp } from '../components/ModelEvalApp';
import { AppRoute, RouteContext } from '../types';
import {
  buildGenerationRoutePath,
  parseGenerationRouteContext,
} from '../features/generation/workspaceNavigation';
import {
  buildInsightPath,
  parseInsightSearchParams,
} from '../insightDeepLink';
import { buildTaskResultsPath, getLegacyTaskInsightsRedirect } from '../taskResults';

const buildRoutePath = (route: AppRoute, context: RouteContext = {}) => {
  if (route === 'generation') return buildGenerationRoutePath(context);
  const search = new URLSearchParams();

  if (context.materialStatusFilter) {
    search.set('status', context.materialStatusFilter);
  }
  if (context.taskDatasetId) {
    search.set('datasetId', context.taskDatasetId);
  }
  (context.taskModelColumns || []).forEach(column => search.append('modelColumn', column));
  if (route === 'tasks' && context.taskBuilderMode === 'create' && context.projectId) {
    search.set('projectId', context.projectId);
  }

  const suffix = search.toString();
  const withSearch = (path: string) => suffix ? `${path}?${suffix}` : path;

  switch (route) {
    case 'overview':
      return '/';
    case 'projects':
      return context.projectId ? `/projects/${encodeURIComponent(context.projectId)}` : '/projects';
    case 'datasets':
      return context.datasetId ? `/datasets/${context.datasetId}` : '/datasets';
    case 'templates':
      return context.templateId ? `/templates/${context.templateId}` : '/templates';
    case 'tasks':
      if (context.taskId || context.materialId) {
        return withSearch(`/tasks/${context.taskId || context.materialId}`);
      }
      if (context.taskBuilderMode === 'create') {
        return withSearch('/tasks/new');
      }
      return withSearch(context.projectId ? `/projects/${context.projectId}/tasks` : '/tasks');
    case 'evaluation':
      return context.taskId ? `/tasks/${context.taskId}/evaluate` : '/evaluation';
    case 'insights':
      if (context.projectId) return buildInsightPath({
        projectId: context.projectId,
        scope: context.insightScope,
        reviewerScope: context.insightReviewerScope,
        source: context.source === 'task' ? 'task' : undefined,
      });
      if (context.taskId || context.materialId) return buildTaskResultsPath(context.taskId || context.materialId || '');
      return withSearch('/insights');
    case 'history':
      return '/history';
    case 'voting':
      return context.taskId ? `/tasks/${context.taskId}/evaluate` : '/evaluation/run';
    case 'results':
      return context.taskId ? buildTaskResultsPath(context.taskId) : '/evaluation/results';
    default:
      return '/';
  }
};

const isStatusFilter = (value: string | null): value is NonNullable<RouteContext['materialStatusFilter']> =>
  value === 'draft' || value === 'active' || value === 'completed';

const withSearchContext = (context: RouteContext, searchParams: URLSearchParams): RouteContext => {
  const status = searchParams.get('status');
  const insightState = parseInsightSearchParams(searchParams);
  const projectId = searchParams.get('projectId') || context.projectId;
  const taskDatasetId = searchParams.get('datasetId') || context.taskDatasetId;
  const generationBatchId = searchParams.get('batch') || context.generationBatchId;
  const taskModelColumns = searchParams.getAll('modelColumn').filter(Boolean);

  return {
    ...context,
    projectId,
    insightScope: insightState.scope || context.insightScope,
    insightReviewerScope: insightState.reviewerScope,
    source: insightState.source || context.source,
    taskDatasetId,
    generationBatchId,
    taskModelColumns: taskModelColumns.length ? taskModelColumns : context.taskModelColumns,
    materialStatusFilter: isStatusFilter(status) ? status : context.materialStatusFilter,
  };
};

const routeFromPath = (pathname: string, searchParams: URLSearchParams): { route: AppRoute; context?: RouteContext; redirectTo?: string } => {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (path === '/') return { route: 'overview' };
  if (path === '/overview') return { route: 'overview', redirectTo: '/' };
  if (path === '/dashboard') return { route: 'projects', redirectTo: '/projects' };
  if (path === '/dataset_repo') return { route: 'datasets', redirectTo: '/datasets' };
  if (path === '/template_repo') return { route: 'templates', redirectTo: '/templates' };
  if (path === '/task_builder') return { route: 'tasks', context: { taskBuilderMode: 'create' }, redirectTo: '/tasks/new' };

  if (path === '/projects') return { route: 'projects' };
  const projectTasks = path.match(/^\/projects\/([^/]+)\/tasks$/);
  if (projectTasks) return { route: 'tasks', context: { projectId: projectTasks[1], source: 'dashboard', taskBuilderMode: 'list' } };
  const projectInsights = path.match(/^\/projects\/([^/]+)\/insights$/);
  if (projectInsights) return { route: 'insights', context: { projectId: decodeURIComponent(projectInsights[1]), source: 'dashboard' } };
  const projectDetail = path.match(/^\/projects\/([^/]+)$/);
  if (projectDetail) return { route: 'projects', context: { projectId: decodeURIComponent(projectDetail[1]), source: 'dashboard' } };

  if (path === '/datasets') return { route: 'datasets' };
  const generationContext = parseGenerationRouteContext(path, searchParams);
  if (generationContext) {
    const canonicalPath = buildGenerationRoutePath(generationContext);
    const currentPath = `${path}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    return {
      route: 'generation',
      context: generationContext,
      ...(canonicalPath !== currentPath ? { redirectTo: canonicalPath } : {}),
    };
  }
  const datasetDetail = path.match(/^\/datasets\/([^/]+)$/);
  if (datasetDetail) return { route: 'datasets', context: { datasetId: datasetDetail[1], source: 'dataset' } };

  if (path === '/templates') return { route: 'templates' };
  const templateDetail = path.match(/^\/templates\/([^/]+)$/);
  if (templateDetail) return { route: 'templates', context: { templateId: templateDetail[1] } };

  if (path === '/tasks') return { route: 'tasks', context: { taskBuilderMode: 'list' } };
  if (path === '/tasks/new') return { route: 'tasks', context: { taskBuilderMode: 'create' } };
  const taskEvaluate = path.match(/^\/tasks\/([^/]+)\/evaluate$/);
  if (taskEvaluate) return { route: 'voting', context: { taskId: taskEvaluate[1], materialId: taskEvaluate[1], source: 'task' } };
  const taskResults = path.match(/^\/tasks\/([^/]+)\/results$/);
  if (taskResults) {
    const taskId = decodeURIComponent(taskResults[1]);
    return { route: 'results', context: { taskId, materialId: taskId, source: 'task' } };
  }
  const legacyTaskInsights = getLegacyTaskInsightsRedirect(path, searchParams);
  if (legacyTaskInsights) {
    return {
      route: 'results',
      context: {
        taskId: legacyTaskInsights.taskId,
        materialId: legacyTaskInsights.taskId,
        source: 'task',
      },
      redirectTo: legacyTaskInsights.redirectTo,
    };
  }
  const taskDetail = path.match(/^\/tasks\/([^/]+)$/);
  if (taskDetail) return { route: 'tasks', context: { taskId: taskDetail[1], materialId: taskDetail[1], source: 'task', taskBuilderMode: 'list' } };

  if (path === '/evaluation') return { route: 'evaluation' };
  if (path === '/evaluation/run') return { route: 'voting' };
  if (path === '/evaluation/results') return { route: 'results' };
  if (path === '/insights') return { route: 'insights' };
  if (path === '/history') return { route: 'history' };

  return { route: 'overview', redirectTo: '/' };
};

export default function AppRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isFeishuCallback = location.pathname === '/feishu-callback' || searchParams.has('code');
  const routeState = useMemo(
    () => {
      const next = routeFromPath(location.pathname, searchParams);
      return {
        ...next,
        context: withSearchContext(next.context || {}, searchParams),
      };
    },
    [location.pathname, searchParams],
  );

  useEffect(() => {
    if (!isFeishuCallback && routeState.redirectTo && routeState.redirectTo !== `${location.pathname}${location.search}`) {
      navigate(routeState.redirectTo, { replace: true });
    }
  }, [isFeishuCallback, location.pathname, location.search, navigate, routeState.redirectTo]);

  if (isFeishuCallback) {
    return <FeishuCallbackScreen />;
  }

  if (location.pathname === '/login') {
    return <LoginScreen />;
  }

  return (
    <ModelEvalApp
      initialRoute={routeState.route}
      initialContext={routeState.context}
      onRouteChange={(nextRoute, nextContext = {}) => {
        const nextPath = buildRoutePath(nextRoute, nextContext);
        const currentPath = `${location.pathname}${location.search}`;
        if (nextPath !== currentPath) {
          navigate(nextPath);
        }
      }}
    />
  );
}
