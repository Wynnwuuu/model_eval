
import React, { useState, useEffect, useRef } from 'react';
import SetupScreen from './SetupScreen';
import VotingScreen from './VotingScreen';
import ArenaRankVotingScreen from './ArenaRankVotingScreen';
import ScoreEvaluationScreen from './ScoreEvaluationScreen';
import ResultsScreen from './ResultsScreen';
import BenchmarkPreviewScreen from './BenchmarkPreviewScreen';
import { ConfirmModal } from './ConfirmModal';
import AppShell from './AppShell';
import OverviewPage from '../pages/overview/OverviewPage';
import ProjectListPage from '../pages/projects/ProjectListPage';
import DatasetListPage from '../pages/datasets/DatasetListPage';
import TemplateListPage from '../pages/templates/TemplateListPage';
import TaskListPage from '../pages/tasks/TaskListPage';
import InsightDashboardPage from '../pages/insights/InsightDashboardPage';
import HistoryPage from '../pages/history/HistoryPage';
import { AppRoute, EvalParadigm, EvaluationConfig, EvaluationItem, HistorySession, HistorySessionSummary, RankingEntry, RouteContext, TaskVoteGroup, VoteRecord, VoteType, EvaluationProject } from '../types';
import { isTaskVoteGroupForReviewer } from '../taskResults';
import { auth, getCurrentReviewerIdentity, getCurrentUserDisplayName, signInWithGoogle, logout, shouldUseCloudAuth } from '../auth';
import { getDefaultEvaluationConfig, getMethodFromParadigm, getParadigmFromMethod, isPairwiseMethod, isPreviewMethod, isRankMethod, isScoreMethod } from '../evaluationMethods';
import { saveTaskUserVotes, loadTaskEvaluation, loadTaskVoteGroups } from '../features/tasks/api';
import { createVoteItemSnapshot } from '../taskItemSnapshot';
import { applyArenaAssignmentToItem, assignArenaBattle, buildArenaSessionItems } from '../arenaSampling';
import { RouteContent, RouteErrorBoundary } from './RouteErrorBoundary';
import {
  buildPendingArenaCheckpoint,
  createEvaluationClientStore,
  migrateLegacyEvaluationStorage,
  resolveEvaluationPersistenceMode,
  validatePendingArenaCheckpoint,
  type LegacyEvaluationSession,
} from '../evaluationClientStore';
import { subscribeBrowserStorageIssues, type BrowserStorageIssue } from '../safeBrowserStorage';
import { USE_SHARED_DATA_SOURCE } from '../runtimeConfig';
import { TaskEvaluationLoadError } from '../features/tasks/loadTaskEvaluation';
import {
  applyModelFeedbackToVote,
  hasModelFeedbackChanged,
  resolveModelFeedbackCandidates,
  type ModelFeedbackDraft,
} from '../modelFeedback';

interface ModelEvalAppProps {
  initialRoute?: AppRoute;
  initialContext?: RouteContext;
  onRouteChange?: (route: AppRoute, context?: RouteContext) => void;
}

export function ModelEvalApp({ initialRoute = 'overview', initialContext = {}, onRouteChange }: ModelEvalAppProps) {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(initialRoute);
  const [routeContext, setRouteContext] = useState<RouteContext>(initialContext);
  const [items, setItems] = useState<EvaluationItem[]>([]);
  const [votes, setVotes] = useState<VoteRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userName, setUserName] = useState('');
  const [modelNames, setModelNames] = useState({ a: 'Model A', b: 'Model B' });
  const [taskModels, setTaskModels] = useState<{ id: string; name: string }[]>([
    { id: 'model-a', name: 'Model A' },
    { id: 'model-b', name: 'Model B' }
  ]);
  const [taskParadigm, setTaskParadigm] = useState<EvalParadigm>('Arena');
  const [taskEvaluationConfig, setTaskEvaluationConfig] = useState<EvaluationConfig>(getDefaultEvaluationConfig('ab_preference'));
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [user, setUser] = useState(null);
  
  // History State
  const [history, setHistory] = useState<HistorySessionSummary[]>([]);
  const [activeProject, setActiveProject] = useState<EvaluationProject | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskBuilderMode, setTaskBuilderMode] = useState<'create' | 'list'>('create');
  const [routeTaskLoading, setRouteTaskLoading] = useState(false);
  const [routeTaskError, setRouteTaskError] = useState<string | null>(null);
  const [routeTaskErrorKind, setRouteTaskErrorKind] = useState<TaskEvaluationLoadError['code'] | null>(null);
  const [hydratedTaskId, setHydratedTaskId] = useState<string | null>(null);
  const [routeTaskLoadAttempt, setRouteTaskLoadAttempt] = useState(0);
  const [allUserVoteGroups, setAllUserVoteGroups] = useState<TaskVoteGroup[]>([]);
  const [teamVotesLoading, setTeamVotesLoading] = useState(false);
  const [teamVotesError, setTeamVotesError] = useState<string | null>(null);
  const [voteSaving, setVoteSaving] = useState(false);
  const [voteSaveError, setVoteSaveError] = useState<string | null>(null);
  const [casePhase, setCasePhase] = useState<'evaluating' | 'revealed'>('evaluating');
  const [revealAfterSubmit, setRevealAfterSubmit] = useState(false);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [storageIssue, setStorageIssue] = useState<BrowserStorageIssue | null>(null);
  const [clientStorageWarning, setClientStorageWarning] = useState<string | null>(null);
  const [datasetEditDraftDirty, setDatasetEditDraftDirty] = useState(false);
  const clientStoreRef = useRef<ReturnType<typeof createEvaluationClientStore> | null>(null);
  if (!clientStoreRef.current) clientStoreRef.current = createEvaluationClientStore();
  const clientStore = clientStoreRef.current;
  const offlineWriteRef = useRef<{ sessionId: string; revision: number; chain: Promise<void> }>({
    sessionId: '',
    revision: 0,
    chain: Promise.resolve(),
  });
  const loadedRouteTaskIdRef = useRef<string | null>(null);
  const revealPreferenceSessionRef = useRef<string | null>(null);

  // Confirm Modal State
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const goToRoute = (route: AppRoute, context: RouteContext = {}) => {
    if (datasetEditDraftDirty && route !== currentRoute) {
      const shouldLeave = window.confirm('当前评测集有尚未保存的批量修改。离开页面将放弃这些修改，是否继续？');
      if (!shouldLeave) return;
      setDatasetEditDraftDirty(false);
    }
    const nextContext: RouteContext = route === 'tasks'
      ? { taskBuilderMode: 'list', ...context }
      : context;

    if (route === 'tasks') {
      setTaskBuilderMode(nextContext.taskBuilderMode || 'list');
    }

    setRouteContext(nextContext);
    setCurrentRoute(route);
    onRouteChange?.(route, nextContext);
  };

  const openTaskResults = (taskId?: string | null, projectId?: string) => {
    if (!taskId) {
      goToRoute('results');
      return;
    }
    const resolvedProjectId = projectId || activeProject?.id || routeContext.projectId;
    const context: RouteContext = {
      projectId: resolvedProjectId,
      taskId,
      materialId: taskId,
      insightScope: `material:${taskId}`,
      insightReviewerScope: 'all',
      source: 'task',
    };
    goToRoute(resolvedProjectId ? 'insights' : 'results', context);
  };

  const mergeCurrentUserVoteGroup = (groups: TaskVoteGroup[], nextVotes: VoteRecord[], nextUserName = userName) => {
    const reviewer = getCurrentReviewerIdentity();
    const userKey = reviewer.id || nextUserName || 'Anonymous';
    const displayName = reviewer.displayName || nextUserName || 'Anonymous';
    const merged = groups.filter(group => !isTaskVoteGroupForReviewer(group, {
      id: userKey,
      email: reviewer.email,
      displayName,
    }));
    merged.push({
      user: displayName,
      userId: userKey,
      displayName,
      email: reviewer.email,
      votes: nextVotes.map(vote => ({ ...vote, user: vote.user || displayName })),
    });
    return merged;
  };

  const getSchedulingVotes = (nextVotes: VoteRecord[], groups = allUserVoteGroups, nextUserName = userName) =>
    mergeCurrentUserVoteGroup(groups, nextVotes, nextUserName)
      .flatMap(group => group.votes || []);

  const isSampledArena = isPairwiseMethod(taskEvaluationConfig)
    && taskEvaluationConfig.pairwiseMode === 'arena_sampled';
  const arenaValidVoteCount = votes.filter(vote => ['A', 'B', 'Tie'].includes(String(vote.vote || vote.choice))).length;
  const arenaSuggestedBattleCount = Math.min(
    items.length || 1,
    taskEvaluationConfig.arenaSampling?.suggestedBattlesPerReviewer
      || Math.max(20, taskModels.length * 2)
  );

  const refreshAllTaskVotes = async (taskId = activeTaskId || routeContext.taskId || '') => {
    if (!taskId) return;
    setTeamVotesLoading(true);
    setTeamVotesError(null);
    try {
      const groups = await loadTaskVoteGroups(taskId);
      setAllUserVoteGroups(groups);
    } catch (error: any) {
      console.error('Failed to refresh all task votes', error);
      setTeamVotesError(error?.message || '无法读取全员汇总结果');
    } finally {
      setTeamVotesLoading(false);
    }
  };

  const formatSaveError = (error: any) => error?.message || '投票保存失败，请检查网络后重试。本次选择尚未写入共享结果。';

  useEffect(() => {
    setCasePhase('evaluating');
  }, [currentIndex, sessionId]);

  useEffect(() => {
    if (currentRoute !== 'voting') {
      revealPreferenceSessionRef.current = null;
      return;
    }

    const evaluationSessionKey = routeContext.taskId || sessionId;
    if (!evaluationSessionKey || revealPreferenceSessionRef.current === evaluationSessionKey) return;
    revealPreferenceSessionRef.current = evaluationSessionKey;
    setRevealAfterSubmit(false);
  }, [currentRoute, routeContext.taskId, sessionId]);

  useEffect(() => {
    if (currentRoute === 'results' && !routeContext.taskId && activeTaskId) {
      void refreshAllTaskVotes(activeTaskId);
    }
  }, [activeTaskId, currentRoute, routeContext.taskId]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      setUser(user);
      if (user) {
        setUserName(user.displayName || user.email);
      }
    });
    return () => unsubscribe();
  }, []);

  // Update state if initialRoute changes
  useEffect(() => {
    if (initialRoute === currentRoute) return;
    if (datasetEditDraftDirty) {
      const shouldLeave = window.confirm('当前评测集有尚未保存的批量修改。离开页面将放弃这些修改，是否继续？');
      if (!shouldLeave) {
        onRouteChange?.(currentRoute, routeContext);
        return;
      }
      setDatasetEditDraftDirty(false);
    }
    setCurrentRoute(initialRoute);
  }, [datasetEditDraftDirty, initialRoute]);

  useEffect(() => {
    setRouteContext(initialContext);
    if (initialContext.taskBuilderMode) {
      setTaskBuilderMode(initialContext.taskBuilderMode);
    }
  }, [initialContext]);

  useEffect(() => subscribeBrowserStorageIssues(setStorageIssue), []);

  // Migrate legacy localStorage before reading the new client stores. Migration
  // is deliberately independent from task hydration so an IndexedDB failure
  // can never block a server-backed evaluation route.
  useEffect(() => {
    let cancelled = false;
    const initializeClientStorage = async () => {
      try {
        const migration = await migrateLegacyEvaluationStorage({
          legacyStorage: window.localStorage,
          store: clientStore,
          reviewerId: getCurrentReviewerIdentity().id,
        });
        if (cancelled) return;
        if (migration.failures.length > 0) {
          setClientStorageWarning(`有 ${migration.failures.length} 项旧本地数据未能完成迁移，原数据仍保留在浏览器中。`);
        }
        const [summaries, latestOfflineSession] = await Promise.all([
          clientStore.listHistorySummaries(),
          clientStore.getLatestOfflineSession(),
        ]);
        if (cancelled) return;
        setHistory(summaries);
        setHasSavedSession(Boolean(latestOfflineSession));
      } catch (error: any) {
        if (!cancelled) {
          console.warn('Evaluation client storage is unavailable', error);
          setClientStorageWarning(
            USE_SHARED_DATA_SOURCE
              ? '本地恢复存储暂不可用；线上任务仍会从服务端正常读取和保存。'
              : '本地恢复存储暂不可用；刷新页面可能无法恢复当前离线进度。',
          );
        }
      }
    };
    void initializeClientStorage();
    return () => {
      cancelled = true;
    };
  }, [clientStore]);

  // Only offline or unbacked sessions persist complete items. The queue and
  // revision check prevent a slow older write from replacing newer progress.
  useEffect(() => {
    const persistence = resolveEvaluationPersistenceMode({
      sharedDataSource: USE_SHARED_DATA_SOURCE,
      taskId: activeTaskId,
      sampledArena: isSampledArena,
    });
    if (!persistence.persistOfflineSession || currentRoute !== 'voting' || items.length === 0 || !sessionId) return;
    if (offlineWriteRef.current.sessionId !== sessionId) {
      offlineWriteRef.current = { sessionId, revision: 0, chain: Promise.resolve() };
    }
    const revision = ++offlineWriteRef.current.revision;
    const session: LegacyEvaluationSession = {
      items,
      votes,
      currentIndex,
      userName,
      modelNames,
      taskModels,
      taskParadigm,
      taskEvaluationConfig,
      activeTaskId,
      timestamp: Date.now(),
      sessionId,
    };
    offlineWriteRef.current.chain = offlineWriteRef.current.chain
      .catch(() => undefined)
      .then(async () => {
        await clientStore.saveOfflineSession({ id: sessionId, revision, updatedAt: Date.now(), session });
        setHasSavedSession(true);
      })
      .catch((error: any) => {
        console.warn('Failed to save offline evaluation progress', error);
        setClientStorageWarning('当前离线评测进度无法保存；请在刷新页面前完成本轮评测。');
      });
  }, [activeTaskId, clientStore, currentIndex, currentRoute, isSampledArena, items, modelNames, sessionId, taskEvaluationConfig, taskModels, taskParadigm, userName, votes]);

  // Shared sampled Arena stores only the current unsubmitted assignment.
  useEffect(() => {
    if (!activeTaskId || !isSampledArena) return;
    const reviewerId = getCurrentReviewerIdentity().id || userName;
    const persistence = resolveEvaluationPersistenceMode({
      sharedDataSource: USE_SHARED_DATA_SOURCE,
      taskId: activeTaskId,
      sampledArena: true,
    });
    if (!persistence.persistArenaCheckpoint) return;
    if (currentRoute !== 'voting' || !items[currentIndex]) {
      if (currentRoute === 'results' || currentRoute === 'insights') {
        void clientStore.deleteTaskCheckpoint(activeTaskId, reviewerId).catch(error => {
          console.warn('Failed to clear Arena checkpoint', error);
        });
      }
      return;
    }
    const checkpoint = buildPendingArenaCheckpoint({
      taskId: activeTaskId,
      reviewerId,
      submittedVoteCount: votes.length,
      sessionId,
      item: items[currentIndex],
    });
    if (!checkpoint) return;
    void clientStore.saveTaskCheckpoint(checkpoint).catch((error: any) => {
      console.warn('Failed to save Arena checkpoint', error);
      setClientStorageWarning('当前 Arena 配对无法在刷新后恢复，请先完成当前 case。');
    });
  }, [activeTaskId, clientStore, currentIndex, currentRoute, isSampledArena, items, sessionId, userName, votes.length]);

  useEffect(() => {
    const taskId = routeContext.taskId;
    const shouldHydrateTask = currentRoute === 'voting' && !!taskId;
    if (!shouldHydrateTask) return;
    if (loadedRouteTaskIdRef.current === taskId && hydratedTaskId === taskId) return;

    let cancelled = false;
    const abortController = new AbortController();
    const hydrateTaskFromRoute = async () => {
      loadedRouteTaskIdRef.current = null;
      setRouteTaskLoading(true);
      setRouteTaskError(null);
      setRouteTaskErrorKind(null);
      setHydratedTaskId(null);
      setItems([]);
      setVotes([]);
      setCurrentIndex(0);
      setAllUserVoteGroups([]);
      setActiveTaskId(null);

      try {
        const loaded = await loadTaskEvaluation(taskId, { signal: abortController.signal });

        if (cancelled) return;

        if (loaded.project) {
          setActiveProject(loaded.project);
        }
        const loadedIsSampledArena = isPairwiseMethod(loaded.evaluationConfig)
          && loaded.evaluationConfig.pairwiseMode === 'arena_sampled';
        const reviewerId = getCurrentReviewerIdentity().id || loaded.userName;
        const arenaSession = loadedIsSampledArena
          ? buildArenaSessionItems({
              taskId: loaded.task.id,
              reviewerId,
              items: loaded.items,
              reviewerVotes: loaded.votes,
              schedulingVotes: mergeCurrentUserVoteGroup(loaded.allUserVoteGroups || [], loaded.votes, loaded.userName)
                .flatMap(group => group.votes || []),
              models: loaded.models,
              config: loaded.evaluationConfig.arenaSampling || {},
            })
          : null;
        let hydratedItems = arenaSession?.items || loaded.items;
        let hydratedCurrentIndex = arenaSession
          ? Math.min(arenaSession.currentIndex, Math.max(hydratedItems.length - 1, 0))
          : Math.min(loaded.votes.length, Math.max(loaded.items.length - 1, 0));
        let restoredSessionId = '';
        if (loadedIsSampledArena && arenaSession && currentRoute === 'voting') {
          try {
            const expectedCurrentItem = hydratedItems[arenaSession.currentIndex];
            const schedulerVersion = loaded.evaluationConfig.arenaSampling?.schedulerVersion || 'arena_v1';
            const checkpoint = await clientStore.getTaskCheckpoint(loaded.task.id, reviewerId);
            if (checkpoint && expectedCurrentItem && validatePendingArenaCheckpoint(checkpoint, {
              taskId: loaded.task.id,
              reviewerId,
              submittedVoteCount: loaded.votes.length,
              schedulerVersion,
              item: expectedCurrentItem,
            })) {
              hydratedItems = hydratedItems.map((item, index) =>
                index === arenaSession.currentIndex ? applyArenaAssignmentToItem(item, checkpoint.assignment) : item
              );
              hydratedCurrentIndex = arenaSession.currentIndex;
              restoredSessionId = checkpoint.sessionId;
            } else if (checkpoint) {
              await clientStore.deleteTaskCheckpoint(loaded.task.id, reviewerId);
            }
          } catch (error) {
            console.warn('Failed to restore pending Arena assignment', error);
            setClientStorageWarning('未能恢复上一次未提交的 Arena 配对，已按服务端进度重新分配。');
          }
        }
        if (cancelled) return;
        setItems(hydratedItems);
        setVotes(loaded.votes);
        setAllUserVoteGroups(loaded.allUserVoteGroups || []);
        setTeamVotesError(loaded.allUserVoteError || null);
        setCurrentIndex(hydratedCurrentIndex);
        setUserName(loaded.userName);
        setModelNames(loaded.modelNames);
        setTaskModels(loaded.models);
        setTaskParadigm(loaded.paradigm);
        setTaskEvaluationConfig(loaded.evaluationConfig);
        setActiveTaskId(loaded.task.id);
        setSessionId(restoredSessionId || `session-${loaded.task.id}-${Date.now()}`);
        loadedRouteTaskIdRef.current = loaded.task.id;
        setHydratedTaskId(loaded.task.id);
        setVoteSaveError(null);
        setResyncError(null);
        if (loadedIsSampledArena && arenaSession?.remainingCount === 0 && currentRoute === 'voting') {
          openTaskResults(loaded.task.id, loaded.project?.id);
        }
      } catch (error: any) {
        if (abortController.signal.aborted) return;
        if (!cancelled) {
          const errorKind = error instanceof TaskEvaluationLoadError ? error.code : 'unknown';
          if (errorKind !== 'not_found') {
            console.error('Failed to load task from route', error);
          }
          setRouteTaskError(error?.message || '加载评测物料失败。');
          setRouteTaskErrorKind(errorKind);
        }
      } finally {
        if (!cancelled) setRouteTaskLoading(false);
      }
    };

    void hydrateTaskFromRoute();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [clientStore, currentRoute, hydratedTaskId, routeContext.taskId, routeTaskLoadAttempt]);

  // Save to History when session is complete (moved to results)
  const saveToHistory = (completedVotes: VoteRecord[]) => {
    if (!sessionId || items.length === 0) return;

    const newEntry: HistorySession = {
      id: sessionId,
      taskId: activeTaskId || undefined,
      timestamp: Date.now(),
      userName: userName || 'Anonymous',
      modelNames,
      models: taskModels,
      paradigm: taskParadigm,
      evaluationConfig: taskEvaluationConfig,
      items,
      votes: completedVotes
    };

    void clientStore.saveHistorySession(newEntry)
      .then(summary => {
        setHistory(previous => {
          const withoutCurrent = previous.filter(entry => entry.id !== summary.id);
          return [summary, ...withoutCurrent].sort((left, right) => right.timestamp - left.timestamp);
        });
      })
      .catch((error: any) => {
        console.warn('Failed to save evaluation history', error);
        setClientStorageWarning(
          activeTaskId
            ? '评测结果已保存到服务端，但本地历史记录写入失败。'
            : '本地评测结果无法写入历史记录，请先不要关闭当前结果页。',
        );
      });
    const persistence = resolveEvaluationPersistenceMode({
      sharedDataSource: USE_SHARED_DATA_SOURCE,
      taskId: activeTaskId,
      sampledArena: isSampledArena,
    });
    if (persistence.persistOfflineSession) {
      void clientStore.deleteOfflineSession(sessionId).then(() => setHasSavedSession(false)).catch(() => undefined);
    }
  };

  const resumeSession = async () => {
    try {
      const saved = await clientStore.getLatestOfflineSession();
      if (!saved) {
        setHasSavedSession(false);
        return;
      }
      const data = saved.session;
      setItems(data.items);
      setVotes(data.votes);
      setCurrentIndex(data.currentIndex);
      setUserName(data.userName || '');
      if (data.modelNames) setModelNames(data.modelNames);
      if (data.taskModels) setTaskModels(data.taskModels);
      if (data.taskParadigm) setTaskParadigm(data.taskParadigm);
      if (data.taskEvaluationConfig) {
        setTaskEvaluationConfig(data.taskEvaluationConfig);
      } else if (data.taskParadigm) {
        setTaskEvaluationConfig(getDefaultEvaluationConfig(getMethodFromParadigm(data.taskParadigm)));
      }
      setActiveTaskId(data.activeTaskId || null);
      setSessionId(data.sessionId || `session-${Date.now()}`);
      goToRoute('voting');
    } catch (error: any) {
      console.warn('Failed to resume offline session', error);
      setClientStorageWarning('无法读取已保存的离线评测进度。原迁移备份不会被删除。');
    }
  };

  const discardSession = () => {
    setConfirmConfig({
      isOpen: true,
      title: '放弃当前评测进度',
      message: '确定要清除当前保存的评测会话吗？清除后无法恢复。',
      onConfirm: () => {
        void clientStore.getLatestOfflineSession()
          .then(saved => saved ? clientStore.deleteOfflineSession(saved.id) : undefined)
          .then(() => setHasSavedSession(false))
          .catch((error: any) => setClientStorageWarning(error?.message || '无法清除本地评测进度。'));
      }
    });
  };

  const handleStart = (
    parsedItems: EvaluationItem[],
    name: string,
    parsedNames?: { a: string, b: string },
    taskId?: string,
    existingVotes?: VoteRecord[],
    paradigm: EvalParadigm = 'Arena',
    models?: { id: string; name: string }[],
    evaluationConfig?: EvaluationConfig
  ) => {
    const resolvedModels = models && models.length > 0 ? models : [
      { id: 'model-a', name: parsedNames?.a || 'Model A' },
      { id: 'model-b', name: parsedNames?.b || 'Model B' }
    ];
    const nextConfig = evaluationConfig || getDefaultEvaluationConfig(getMethodFromParadigm(paradigm));
    const nextVotes = existingVotes || [];
    const sampledArenaSession = isPairwiseMethod(nextConfig) && nextConfig.pairwiseMode === 'arena_sampled'
      ? buildArenaSessionItems({
          taskId: taskId || 'local-arena',
          reviewerId: getCurrentReviewerIdentity().id || name,
          items: parsedItems,
          reviewerVotes: nextVotes,
          schedulingVotes: nextVotes,
          models: resolvedModels,
          config: nextConfig.arenaSampling || {},
        })
      : null;
    const sessionItems = sampledArenaSession?.items || parsedItems;
    setItems(sessionItems);
    setUserName(name);
    if (parsedNames) setModelNames(parsedNames);
    else setModelNames({ a: 'Model A', b: 'Model B' });
    setTaskModels(resolvedModels);
    setTaskParadigm(getParadigmFromMethod(nextConfig.method));
    setTaskEvaluationConfig(nextConfig);
    setActiveTaskId(taskId || null);
    loadedRouteTaskIdRef.current = taskId || null;
    setHydratedTaskId(taskId || null);
    setAllUserVoteGroups([]);
    setTeamVotesError(null);
    setTeamVotesLoading(false);
    setVoteSaveError(null);
    setResyncError(null);
    if (taskId) {
      refreshAllTaskVotes(taskId);
    }
    
    // Generate unique ID for this session
    setSessionId(`session-${Date.now()}`);

    if (nextVotes.length > 0) {
      setVotes(nextVotes);
      if (sampledArenaSession ? sampledArenaSession.remainingCount === 0 : nextVotes.length >= parsedItems.length) {
        setCurrentIndex(Math.max(sessionItems.length - 1, 0));
        openTaskResults(taskId);
      } else {
        setCurrentIndex(sampledArenaSession?.currentIndex ?? nextVotes.length);
        goToRoute('voting', taskId ? { taskId } : {});
      }
    } else {
      setCurrentIndex(0);
      setVotes([]);
      goToRoute('voting', taskId ? { taskId } : {});
    }
  };

  const persistVoteProgress = async (updatedVotes: VoteRecord[], nextProgress: number) => {
    if (!activeTaskId || !userName) return;

    try {
      const savedVotes = await saveTaskUserVotes(activeTaskId, userName, updatedVotes, nextProgress);
      if (savedVotes) return;

      const { doc, updateDoc, FieldPath, setDoc } = await import('../datastore');
      const { db } = await import('../auth');
      const taskRef = doc(db, 'evalTasks', activeTaskId);
      try {
        await updateDoc(taskRef, new FieldPath('progress', userName), nextProgress);
      } catch (updateErr) {
        try {
          await setDoc(taskRef, { progress: { [userName]: nextProgress } }, { merge: true });
        } catch (progressErr) {
          console.error("Failed to update task progress", progressErr);
        }
      }

      const voteRef = doc(db, 'evalTasks', activeTaskId, 'userVotes', userName);
      try {
        await setDoc(voteRef, { votes: updatedVotes }, { merge: true });
      } catch (voteErr) {
        console.error("Failed to save vote", voteErr);
      }
    } catch (e) {
      console.error("Failed to initialize vote persistence", e);
      throw e;
    }
  };

  const advanceFromSubmittedVote = (updatedVotes: VoteRecord[]) => {
    setCasePhase('evaluating');
    if (currentIndex < items.length - 1) {
      if (isSampledArena && !items[currentIndex + 1]?.pairContext) {
        const nextItem = items[currentIndex + 1];
        const assignment = assignArenaBattle({
          taskId: activeTaskId || 'local-arena',
          reviewerId: getCurrentReviewerIdentity().id || userName,
          item: nextItem,
          models: taskModels,
          votes: getSchedulingVotes(updatedVotes),
          config: taskEvaluationConfig.arenaSampling || {},
        });
        if (assignment) {
          setItems(previous => previous.map((item, index) =>
            index === currentIndex + 1 ? applyArenaAssignmentToItem(item, assignment) : item
          ));
        }
      }
      setCurrentIndex(previous => previous + 1);
      return;
    }

    saveToHistory(updatedVotes);
    if (activeTaskId) {
      void refreshAllTaskVotes(activeTaskId);
    }
    openTaskResults(activeTaskId);
  };

  const commitVoteRecord = async (
    votePayload: Partial<VoteRecord>,
    options: { feedback?: ModelFeedbackDraft; reveal?: boolean } = {},
  ) => {
    if (voteSaving) return;
    const currentItem = items[currentIndex];
    const baseVote: VoteRecord = {
      itemId: currentItem.id,
      itemSnapshot: createVoteItemSnapshot(currentItem),
      method: taskEvaluationConfig.method,
      timestamp: Date.now(),
      user: userName,
      ...votePayload
    };
    const candidates = resolveModelFeedbackCandidates(currentItem, taskModels, baseVote.method || taskEvaluationConfig.method);
    const newVote = applyModelFeedbackToVote(baseVote, candidates, options.feedback || {});

    const updatedVotes = [...votes, newVote];
    setVoteSaving(true);
    setVoteSaveError(null);

    try {
      await persistVoteProgress(updatedVotes, updatedVotes.length);
      setVotes(updatedVotes);
      setAllUserVoteGroups(prev => mergeCurrentUserVoteGroup(prev, updatedVotes));
      if (options.reveal === true) {
        setCasePhase('revealed');
      } else {
        advanceFromSubmittedVote(updatedVotes);
      }
    } catch (error: any) {
      setVoteSaveError(formatSaveError(error));
    } finally {
      setVoteSaving(false);
    }
  };

  const handleVote = async (vote: VoteType, feedback: ModelFeedbackDraft) => {
    const currentItem = items[currentIndex] as any;
    await commitVoteRecord({
      vote,
      choice: vote,
      pairContext: currentItem.pairContext
    }, { feedback, reveal: revealAfterSubmit });
  };

  const handleRankVote = async (ranking: RankingEntry[], feedback: ModelFeedbackDraft) => {
    await commitVoteRecord({
      method: 'rank_order',
      ranking
    }, { feedback, reveal: revealAfterSubmit });
  };

  const handleScoreVote = async (votePayload: Partial<VoteRecord>, feedback: ModelFeedbackDraft) => {
    await commitVoteRecord(votePayload, { feedback, reveal: revealAfterSubmit });
  };

  const handleSkipItem = async () => {
    const currentItem = items[currentIndex] as any;
    await commitVoteRecord({
      choice: 'skipped',
      pairContext: currentItem?.pairContext
    }, { reveal: false });
  };

  const handleContinueAfterReveal = async (feedback: ModelFeedbackDraft) => {
    if (voteSaving) return;
    const currentItem = items[currentIndex];
    let voteIndex = -1;
    for (let index = votes.length - 1; index >= 0; index -= 1) {
      if (votes[index].itemId === currentItem?.id) {
        voteIndex = index;
        break;
      }
    }
    if (voteIndex < 0) {
      setVoteSaveError('当前 case 的已保存记录不存在，请重新提交评测。');
      setCasePhase('evaluating');
      return;
    }

    const currentVote = votes[voteIndex];
    const candidates = resolveModelFeedbackCandidates(currentItem, taskModels, currentVote.method || taskEvaluationConfig.method);
    let updatedVotes = votes;
    if (hasModelFeedbackChanged(currentVote, feedback)) {
      const updatedVote = applyModelFeedbackToVote(currentVote, candidates, feedback);
      updatedVotes = votes.map((vote, index) => index === voteIndex ? updatedVote : vote);
      setVoteSaving(true);
      setVoteSaveError(null);
      try {
        await persistVoteProgress(updatedVotes, updatedVotes.length);
        setVotes(updatedVotes);
        setAllUserVoteGroups(previous => mergeCurrentUserVoteGroup(previous, updatedVotes));
      } catch (error: any) {
        setVoteSaveError(formatSaveError(error));
        return;
      } finally {
        setVoteSaving(false);
      }
    }

    advanceFromSubmittedVote(updatedVotes);
  };

  const handleRevoteCurrent = async () => {
    if (voteSaving) return;
    const currentItem = items[currentIndex];
    let voteIndex = -1;
    for (let index = votes.length - 1; index >= 0; index -= 1) {
      if (votes[index].itemId === currentItem?.id) {
        voteIndex = index;
        break;
      }
    }
    if (voteIndex < 0) {
      setCasePhase('evaluating');
      return;
    }

    const updatedVotes = votes.filter((_vote, index) => index !== voteIndex);
    setVoteSaving(true);
    setVoteSaveError(null);
    try {
      await persistVoteProgress(updatedVotes, updatedVotes.length);
      setVotes(updatedVotes);
      setAllUserVoteGroups(previous => mergeCurrentUserVoteGroup(previous, updatedVotes));
      setCasePhase('evaluating');
    } catch (error: any) {
      setVoteSaveError(formatSaveError(error));
    } finally {
      setVoteSaving(false);
    }
  };

  const handlePreviewComment = async (comment: string) => {
    await commitVoteRecord({
      method: 'benchmark_preview',
      choice: 'previewed',
      reason: comment.trim()
    }, { reveal: false });
  };

  const handlePreviewSkip = async () => {
    await commitVoteRecord({
      method: 'benchmark_preview',
      choice: 'skipped'
    }, { reveal: false });
  };

  const handleGoBack = async () => {
    if (voteSaving) return;
    if (currentIndex > 0) {
      const updatedVotes = votes.slice(0, -1);
      const nextIndex = currentIndex - 1;

      if (activeTaskId && userName) {
        setVoteSaving(true);
        setVoteSaveError(null);
        try {
          const savedVotes = await saveTaskUserVotes(activeTaskId, userName, updatedVotes, nextIndex);
          if (savedVotes) {
            setVotes(updatedVotes);
            setAllUserVoteGroups(prev => mergeCurrentUserVoteGroup(prev, updatedVotes));
            setCurrentIndex(prev => prev - 1);
            return;
          }

          const { doc, updateDoc, FieldPath, setDoc } = await import('../datastore');
          const { db } = await import('../auth');
          const taskRef = doc(db, 'evalTasks', activeTaskId);
          try {
            await updateDoc(taskRef, new FieldPath('progress', userName), nextIndex);
          } catch (updateErr) {
            try {
              await setDoc(taskRef, { progress: { [userName]: nextIndex } }, { merge: true });
            } catch (progressErr) {
              console.error("Failed to update task progress on go back", progressErr);
            }
          }
          
          const voteRef = doc(db, 'evalTasks', activeTaskId, 'userVotes', userName);
          try {
            await setDoc(voteRef, { votes: updatedVotes }, { merge: true });
          } catch (voteErr) {
            console.error("Failed to save reverted votes", voteErr);
          }
          setVotes(updatedVotes);
          setAllUserVoteGroups(prev => mergeCurrentUserVoteGroup(prev, updatedVotes));
          setCurrentIndex(prev => prev - 1);
        } catch (e) {
          console.error("Failed to initialize go back persistence", e);
          setVoteSaveError(formatSaveError(e));
        } finally {
          setVoteSaving(false);
        }
      } else {
        setVotes(updatedVotes);
        setAllUserVoteGroups(prev => mergeCurrentUserVoteGroup(prev, updatedVotes));
        setCurrentIndex(prev => prev - 1);
      }
    }
  };

  const handleReset = () => {
    setConfirmConfig({
      isOpen: true,
      title: '清除评测会话',
      message: '确定要清除当前评测会话数据吗？',
      onConfirm: () => {
        goToRoute('evaluation');
        setItems([]);
        setVotes([]);
        setCurrentIndex(0);
        setModelNames({ a: 'Model A', b: 'Model B' });
        setTaskModels([
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b', name: 'Model B' }
        ]);
        setTaskParadigm('Arena');
        setTaskEvaluationConfig(getDefaultEvaluationConfig('ab_preference'));
        setSessionId('');
        setAllUserVoteGroups([]);
        setTeamVotesError(null);
        setTeamVotesLoading(false);
        setVoteSaveError(null);
        setResyncError(null);
        loadedRouteTaskIdRef.current = null;
        setHydratedTaskId(null);
        const completedSessionId = sessionId;
        if (completedSessionId) {
          void clientStore.deleteOfflineSession(completedSessionId).catch(error => {
            console.warn('Failed to clear offline session', error);
          });
        }
        setHasSavedSession(false);
      }
    });
  };

  const handleEndSessionEarly = () => {
    if (votes.length > 0) {
      const finish = () => {
        saveToHistory(votes);
        openTaskResults(activeTaskId);
      };
      if (isSampledArena) {
        setConfirmConfig({
          isOpen: true,
          title: '结束本轮竞技场评测？',
          message: `已提交的 ${arenaValidVoteCount} 场有效对战均已保存并会立即纳入统计。之后仍可从结果页继续贡献未评过的 case。`,
          onConfirm: finish,
        });
      } else {
        finish();
      }
    } else {
      handleReset();
    }
  };

  const resyncMyVotes = async () => {
    if (!activeTaskId || votes.length === 0) return;
    setResyncLoading(true);
    setResyncError(null);
    try {
      const savedVotes = await saveTaskUserVotes(activeTaskId, userName || getCurrentUserDisplayName(), votes, votes.length);
      if (savedVotes) {
        setVotes(savedVotes);
      }
      await refreshAllTaskVotes(activeTaskId);
    } catch (error: any) {
      setResyncError(formatSaveError(error));
    } finally {
      setResyncLoading(false);
    }
  };

  // History Management
  const clearHistory = () => {
    setConfirmConfig({
      isOpen: true,
      title: '删除所有历史记录',
      message: '确定删除所有历史记录吗？此操作无法撤销。',
      onConfirm: () => {
        void clientStore.clearHistoryAndMigrationBackups()
          .then(() => setHistory([]))
          .catch((error: any) => setClientStorageWarning(error?.message || '无法清除本地历史。'));
      }
    });
  };

  const deleteSession = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: '删除会话',
      message: '确定删除此会话吗？',
      onConfirm: () => {
        void clientStore.deleteHistorySession(id)
          .then(() => setHistory(previous => previous.filter(entry => entry.id !== id)))
          .catch((error: any) => setClientStorageWarning(error?.message || '无法删除这条本地历史。'));
      }
    });
  };

  const navigate = (route: AppRoute, context: RouteContext = {}) => {
    goToRoute(route, context);
  };

  const withVotePersistenceStatus = (content: React.ReactNode) => (
    <div className="relative">
      {(voteSaving || voteSaveError) && (
        <div className={`mx-auto mb-4 max-w-4xl border px-4 py-3 text-sm ${
          voteSaveError
            ? 'border-red-500/40 bg-red-500/10 text-red-100'
            : 'border-amber-400/40 bg-amber-400/10 text-amber-100'
        }`}>
          {voteSaveError || '正在保存到共享结果，请稍候...'}
        </div>
      )}
      <div className={voteSaving ? 'pointer-events-none opacity-70' : ''}>
        {content}
      </div>
    </div>
  );

  const renderRoute = () => {
    if (!user && shouldUseCloudAuth) {
      return (
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-8 text-center">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)] text-black font-bold">ME</div>
            <h1 className="text-2xl font-semibold text-white">登录 ManuEval</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">进入评测一体化平台，管理评测集、评测物料、参与评测、结果洞察和生产流程。</p>
            <button onClick={signInWithGoogle} className="btn-primary mt-6 w-full">使用飞书登录</button>
          </div>
        </div>
      );
    }

    if (
      currentRoute === 'voting'
      && routeContext.taskId
      && !routeTaskError
      && (routeTaskLoading || hydratedTaskId !== routeContext.taskId)
    ) {
      return (
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-8 text-center">
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <h1 className="text-xl font-semibold text-white">正在加载评测物料</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">正在根据 URL 加载任务配置、case 和评测进度。</p>
          </div>
        </div>
      );
    }

    if (currentRoute === 'voting' && routeContext.taskId && routeTaskError) {
      return (
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
          <div className="w-full max-w-md rounded-lg border border-red-500/30 bg-[var(--surface-panel)] p-8 text-center">
            <h1 className="text-xl font-semibold text-white">
              {routeTaskErrorKind === 'not_found' ? '评测物料不存在或已删除' : '评测物料加载失败'}
            </h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{routeTaskError}</p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setRouteTaskLoadAttempt(attempt => attempt + 1)}
                className="btn-primary flex-1"
              >
                重试
              </button>
              <button type="button" onClick={() => navigate('tasks')} className="btn-secondary flex-1">返回评测物料</button>
            </div>
          </div>
        </div>
      );
    }

    if (currentRoute === 'overview') {
      return (
        <OverviewPage
          onGoToProjects={() => navigate('projects')}
          onGoToDatasets={() => navigate('datasets')}
          onGoToTasks={(statusFilter) => navigate('tasks', { materialStatusFilter: statusFilter })}
          onOpenProject={(projectId) => navigate('projects', { projectId, source: 'dashboard' })}
          onGoToInsights={() => navigate('insights')}
          onGoToGeneration={(batchId) => navigate('generation', { generationBatchId: batchId })}
        />
      );
    }

    if (currentRoute === 'projects') {
      return (
        <div className="py-6">
          <ProjectListPage
            initialProject={routeContext.projectId && activeProject?.id === routeContext.projectId ? activeProject : null}
            initialProjectId={routeContext.projectId}
            onProjectSelect={(project) => {
              setActiveProject(project);
              if (currentRoute === 'projects') {
                if (project && routeContext.projectId !== project.id) {
                  navigate('projects', { projectId: project.id, source: 'dashboard' });
                } else if (!project && routeContext.projectId) {
                  navigate('projects');
                }
              }
            }}
            onGoToExecution={(project, taskItems, taskName, modelNames, taskId, existingVotes, paradigm, models, evaluationConfig) => {
              setActiveProject(project);
              setRouteContext({ projectId: project.id, taskId, source: 'dashboard' });
              if (taskItems && taskItems.length > 0) {
                const nextUserName = getCurrentUserDisplayName();
                handleStart(taskItems, nextUserName, modelNames, taskId, existingVotes, paradigm, models, evaluationConfig);
              } else {
                navigate('tasks', { projectId: project.id, source: 'dashboard', materialStatusFilter: 'active', taskBuilderMode: 'list' });
              }
            }}
            onGoToAnalysis={(project, insightScope) => {
              setActiveProject(project);
              navigate('insights', { projectId: project.id, insightScope, source: 'dashboard' });
            }}
            onGoToDatasetRepo={() => navigate('datasets')}
            onGoToTemplateRepo={() => navigate('templates')}
            onGoToTaskBuilder={(project, mode) => {
              setActiveProject(project);
              setTaskBuilderMode(mode || 'create');
              navigate('tasks', { projectId: project.id, source: 'dashboard', taskBuilderMode: mode || 'create' });
            }}
          />
        </div>
      );
    }

    if (currentRoute === 'datasets' || currentRoute === 'generation') {
      return (
        <div className="py-6">
          <DatasetListPage
            onBack={() => navigate('overview')}
            mode={currentRoute === 'generation' ? 'generation' : 'repository'}
            initialDatasetId={routeContext.datasetId}
            generationView={routeContext.generationView}
            initialGenerationBatchId={routeContext.generationBatchId}
            onGenerationNavigate={(generationView, context: { datasetId?: string; generationBatchId?: string } = {}) => navigate('generation', {
              generationView,
              datasetId: context.datasetId,
              generationBatchId: context.generationBatchId,
            })}
            onOpenDatasetRepository={(datasetId) => navigate('datasets', { datasetId })}
            onCreateEvaluation={(datasetId, resultColumn) => navigate('tasks', {
              taskBuilderMode: 'create',
              source: 'dataset',
              taskDatasetId: datasetId,
              taskModelColumns: [resultColumn],
            })}
            onDraftStateChange={setDatasetEditDraftDirty}
          />
        </div>
      );
    }

    if (currentRoute === 'templates') {
      return (
        <div className="py-6">
          <TemplateListPage onBack={() => navigate('overview')} />
        </div>
      );
    }

    if (currentRoute === 'tasks') {
      return (
        <div className="py-6">
          <TaskListPage
            projectId={routeContext.projectId}
            initialMode={routeContext.taskBuilderMode || taskBuilderMode}
            initialStatusFilter={routeContext.materialStatusFilter}
            initialTaskId={routeContext.taskId}
            initialDatasetId={routeContext.taskDatasetId}
            initialModelColumns={routeContext.taskModelColumns}
            onBack={() => routeContext.projectId ? navigate('projects', { projectId: routeContext.projectId, source: 'dashboard' }) : navigate('overview')}
            onCloseTaskDetails={() => navigate('tasks', { taskBuilderMode: 'list' })}
            onClearProjectScope={routeContext.projectId ? () => navigate('tasks', { taskBuilderMode: 'list' }) : undefined}
            onEvaluateTask={(task) => navigate('voting', { taskId: task.id, materialId: task.id, source: 'task' })}
            onOpenResults={(task) => navigate('insights', {
              projectId: task.projectId,
              taskId: task.id,
              materialId: task.id,
              insightScope: `material:${task.id}`,
              insightReviewerScope: 'all',
              source: 'task',
            })}
          />
        </div>
      );
    }

    if (currentRoute === 'evaluation') {
      return (
        <div className="min-h-[calc(100vh-64px)] py-6">
          <SetupScreen
            project={activeProject}
            onStart={handleStart}
            onGoToAnalysis={() => navigate('insights')}
            onGoToHistory={() => navigate('history')}
            onBack={() => navigate('overview')}
            savedSession={hasSavedSession}
            onResume={resumeSession}
            onDiscardSession={discardSession}
          />
        </div>
      );
    }

    if (currentRoute === 'insights') {
      return (
        <div className="py-6">
          <InsightDashboardPage
            onBack={() => navigate('evaluation')}
            returnAction={routeContext.source === 'task'
              ? { label: '返回评测物料', onClick: () => navigate('tasks', { projectId: routeContext.projectId, taskBuilderMode: 'list' }) }
              : routeContext.projectId
                ? { label: '返回项目', onClick: () => navigate('projects', { projectId: routeContext.projectId, source: 'dashboard' }) }
                : { label: '返回大盘', onClick: () => navigate('overview') }}
            initialProjectId={routeContext.projectId}
            initialMaterialId={routeContext.materialId || routeContext.taskId}
            initialScope={routeContext.insightScope}
            initialReviewerScope={routeContext.insightReviewerScope}
            source={routeContext.source === 'task' ? 'task' : 'dashboard'}
          />
        </div>
      );
    }

    if (currentRoute === 'history') {
      return (
        <div className="py-6">
          <HistoryPage
            history={history}
            onBack={() => navigate('evaluation')}
            onGoToDashboard={() => navigate('overview')}
            onClearHistory={clearHistory}
            onDeleteSession={deleteSession}
            onLoadSession={(id) => clientStore.getHistoryDetail(id)}
          />
        </div>
      );
    }

    if (currentRoute === 'voting' && items.length > 0 && isPreviewMethod(taskEvaluationConfig)) {
      return withVotePersistenceStatus(
        <BenchmarkPreviewScreen
          item={items[currentIndex]}
          currentIndex={currentIndex}
          totalItems={items.length}
          models={taskModels}
          outputType={items[currentIndex]?.type}
          onComment={handlePreviewComment}
          onSkip={handlePreviewSkip}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={currentIndex > 0 ? handleGoBack : undefined}
        />
      );
    }

    if (currentRoute === 'voting' && items.length > 0 && isScoreMethod(taskEvaluationConfig)) {
      return withVotePersistenceStatus(
        <ScoreEvaluationScreen
          item={items[currentIndex]}
          currentIndex={currentIndex}
          totalItems={items.length}
          models={taskModels}
          config={taskEvaluationConfig}
          isRevealed={casePhase === 'revealed'}
          isLastItem={currentIndex === items.length - 1}
          revealAfterSubmit={revealAfterSubmit}
          onRevealAfterSubmitChange={setRevealAfterSubmit}
          onVote={handleScoreVote}
          onNext={handleContinueAfterReveal}
          onRevote={handleRevoteCurrent}
          onSkip={casePhase === 'evaluating' ? handleSkipItem : undefined}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={casePhase === 'evaluating' && currentIndex > 0 ? handleGoBack : undefined}
        />
      );
    }

    if (currentRoute === 'voting' && items.length > 0 && !isRankMethod(taskEvaluationConfig)) {
      return withVotePersistenceStatus(
        <VotingScreen
          item={items[currentIndex]}
          nextItem={items[currentIndex + 1]}
          currentIndex={currentIndex}
          totalItems={items.length}
          models={taskModels}
          blind={taskEvaluationConfig.blind !== false}
          isRevealed={casePhase === 'revealed'}
          isLastItem={currentIndex === items.length - 1}
          revealAfterSubmit={revealAfterSubmit}
          onRevealAfterSubmitChange={setRevealAfterSubmit}
          onVote={handleVote}
          onNext={handleContinueAfterReveal}
          onRevote={handleRevoteCurrent}
          onSkip={casePhase === 'evaluating' ? handleSkipItem : undefined}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={casePhase === 'evaluating' && currentIndex > 0 ? handleGoBack : undefined}
          allowTie={taskEvaluationConfig.tiePolicy !== 'disallow'}
          arenaProgress={isSampledArena ? {
            contributed: arenaValidVoteCount,
            suggested: arenaSuggestedBattleCount,
            reached: arenaValidVoteCount >= arenaSuggestedBattleCount,
          } : undefined}
        />
      );
    }

    if (currentRoute === 'voting' && items.length > 0 && isRankMethod(taskEvaluationConfig)) {
      return withVotePersistenceStatus(
        <ArenaRankVotingScreen
          item={items[currentIndex]}
          nextItem={items[currentIndex + 1]}
          currentIndex={currentIndex}
          totalItems={items.length}
          models={taskModels}
          blind={taskEvaluationConfig.blind !== false}
          isRevealed={casePhase === 'revealed'}
          isLastItem={currentIndex === items.length - 1}
          revealAfterSubmit={revealAfterSubmit}
          onRevealAfterSubmitChange={setRevealAfterSubmit}
          onVote={handleRankVote}
          onNext={handleContinueAfterReveal}
          onRevote={handleRevoteCurrent}
          onSkip={casePhase === 'evaluating' ? handleSkipItem : undefined}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={casePhase === 'evaluating' && currentIndex > 0 ? handleGoBack : undefined}
        />
      );
    }

    if (currentRoute === 'results') {
      if (routeContext.taskId) {
        return (
          <div className="py-6">
            <InsightDashboardPage
              onBack={() => navigate('tasks', { projectId: routeContext.projectId, taskBuilderMode: 'list' })}
              returnAction={{ label: '返回评测物料', onClick: () => navigate('tasks', { projectId: routeContext.projectId, taskBuilderMode: 'list' }) }}
              initialProjectId={routeContext.projectId}
              initialMaterialId={routeContext.taskId}
              initialScope={`material:${routeContext.taskId}`}
              initialReviewerScope={routeContext.insightReviewerScope}
              source="task"
            />
          </div>
        );
      }
      return (
        <div className="py-6">
          <ResultsScreen
            votes={votes}
            items={items}
            onReset={handleReset}
            userName={userName}
            modelNames={modelNames}
            models={taskModels}
            paradigm={taskParadigm}
            evaluationConfig={taskEvaluationConfig}
            allUserVoteGroups={allUserVoteGroups}
            teamVotesLoading={teamVotesLoading}
            teamVotesError={teamVotesError}
            onRefreshTeamVotes={activeTaskId ? () => refreshAllTaskVotes(activeTaskId) : undefined}
            taskId={activeTaskId || routeContext.taskId}
            reviewerIdentity={getCurrentReviewerIdentity()}
            onResyncMyVotes={activeTaskId ? resyncMyVotes : undefined}
            resyncLoading={resyncLoading}
            resyncError={resyncError}
            onBackToTasks={() => navigate('tasks', { taskBuilderMode: 'list' })}
            onGoToDashboard={() => navigate('overview')}
            onContinueEvaluation={isSampledArena && votes.length < items.length
              ? () => navigate('voting', activeTaskId ? { taskId: activeTaskId, source: 'task' } : routeContext)
              : undefined}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <AppShell
      currentRoute={currentRoute}
      onNavigate={navigate}
      user={user}
      usesCloudAuth={shouldUseCloudAuth}
      onSignIn={signInWithGoogle}
      onLogout={logout}
      onClearLocalSession={discardSession}
      hasSavedSession={hasSavedSession}
      focusMode={currentRoute === 'voting'}
      contextTitle={currentRoute === 'projects'
        ? (routeContext.projectId && activeProject?.id === routeContext.projectId ? activeProject.name : undefined)
        : activeProject?.name}
    >
      {(storageIssue || clientStorageWarning) && (
        <div className="mx-auto mt-4 max-w-6xl border border-amber-400/35 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <strong className="font-semibold">本地恢复提示</strong>
              <p className="mt-1 text-amber-100/85">{storageIssue?.message || clientStorageWarning}</p>
              {storageIssue?.technicalMessage && (
                <details className="mt-2 text-xs text-amber-100/65">
                  <summary className="cursor-pointer">技术信息</summary>
                  <div className="mt-1 break-words">{storageIssue.technicalMessage}</div>
                </details>
              )}
            </div>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center border border-amber-200/20 text-lg text-amber-100 hover:bg-amber-200/10"
              aria-label="关闭本地恢复提示"
              onClick={() => {
                setStorageIssue(null);
                setClientStorageWarning(null);
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
      <RouteErrorBoundary
        resetKey={`${currentRoute}:${routeContext.projectId || routeContext.taskId || routeContext.datasetId || ''}`}
        routeLabel={currentRoute === 'projects' ? '项目页面' : undefined}
        onBack={() => navigate(currentRoute === 'projects' ? 'projects' : 'overview')}
        backLabel={currentRoute === 'projects' ? '返回项目列表' : '返回运营总览'}
      >
        <RouteContent render={renderRoute} />
      </RouteErrorBoundary>
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </AppShell>
  );
}
