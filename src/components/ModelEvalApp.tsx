
import React, { useState, useEffect } from 'react';
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
import { AppRoute, EvalParadigm, EvaluationConfig, EvaluationItem, HistorySession, RankingEntry, RouteContext, TaskVoteGroup, VoteRecord, VoteType, EvaluationProject } from '../types';
import { auth, getCurrentReviewerIdentity, getCurrentUserDisplayName, signInWithGoogle, logout, shouldUseCloudAuth } from '../auth';
import { getDefaultEvaluationConfig, getMethodFromParadigm, getParadigmFromMethod, isPairwiseMethod, isPreviewMethod, isRankMethod, isScoreMethod } from '../evaluationMethods';
import { saveTaskUserVotes, loadTaskEvaluation, loadTaskVoteGroups } from '../features/tasks/api';
import { createVoteItemSnapshot } from '../taskItemSnapshot';
import { applyArenaAssignmentToItem, assignArenaBattle, buildArenaSessionItems } from '../arenaSampling';

const STORAGE_KEY = 'modeleval_session';
const HISTORY_KEY = 'modeleval_history';

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
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [activeProject, setActiveProject] = useState<EvaluationProject | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskBuilderMode, setTaskBuilderMode] = useState<'create' | 'list'>('create');
  const [routeTaskLoading, setRouteTaskLoading] = useState(false);
  const [routeTaskError, setRouteTaskError] = useState<string | null>(null);
  const [allUserVoteGroups, setAllUserVoteGroups] = useState<TaskVoteGroup[]>([]);
  const [teamVotesLoading, setTeamVotesLoading] = useState(false);
  const [teamVotesError, setTeamVotesError] = useState<string | null>(null);
  const [voteSaving, setVoteSaving] = useState(false);
  const [voteSaveError, setVoteSaveError] = useState<string | null>(null);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);

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

  const mergeCurrentUserVoteGroup = (groups: TaskVoteGroup[], nextVotes: VoteRecord[], nextUserName = userName) => {
    const reviewer = getCurrentReviewerIdentity();
    const userKey = reviewer.id || nextUserName || 'Anonymous';
    const displayName = reviewer.displayName || nextUserName || 'Anonymous';
    const merged = groups.filter(group => {
      const isCurrentReviewer = group.userId === userKey
        || Boolean(reviewer.email && group.email === reviewer.email)
        || group.user === displayName
        || group.displayName === displayName;
      return !isCurrentReviewer;
    });
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
    if (currentRoute === 'results' && activeTaskId) {
      void refreshAllTaskVotes(activeTaskId);
    }
  }, [activeTaskId, currentRoute]);

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
    setCurrentRoute(initialRoute);
  }, [initialRoute]);

  useEffect(() => {
    setRouteContext(initialContext);
    if (initialContext.taskBuilderMode) {
      setTaskBuilderMode(initialContext.taskBuilderMode);
    }
  }, [initialContext]);

  // Load History on Mount
  useEffect(() => {
    const savedHistory = localStorage.getItem(HISTORY_KEY);
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history");
      }
    }
  }, []);

  // Check for saved session on load
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setHasSavedSession(true);
    }
  }, [currentRoute]);

  // Auto-save current progress
  useEffect(() => {
    if (currentRoute === 'voting' && items.length > 0) {
      const sessionData = {
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
        sessionId // Persist the ID
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
    }
  }, [items, votes, currentIndex, currentRoute, userName, modelNames, taskModels, taskParadigm, taskEvaluationConfig, sessionId, activeTaskId]);

  useEffect(() => {
    const taskId = routeContext.taskId;
    const shouldHydrateTask = (currentRoute === 'voting' || currentRoute === 'results') && !!taskId;
    if (!shouldHydrateTask) return;
    if (activeTaskId === taskId && items.length > 0) return;

    let cancelled = false;

    const hydrateTaskFromRoute = async () => {
      setRouteTaskLoading(true);
      setRouteTaskError(null);

      try {
        const loaded = await loadTaskEvaluation(taskId);

        if (cancelled) return;

        if (loaded.project && !activeProject) {
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
            const savedSession = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            const savedCurrentItem = savedSession?.items?.[savedSession.currentIndex] as EvaluationItem | undefined;
            const expectedCurrentItem = hydratedItems[arenaSession.currentIndex];
            const savedOriginalId = savedCurrentItem?.pairContext?.originalItemId || savedCurrentItem?.originalItemId || savedCurrentItem?.id;
            const expectedOriginalId = expectedCurrentItem?.originalItemId || expectedCurrentItem?.id;
            if (
              savedSession?.activeTaskId === loaded.task.id
              && savedSession?.votes?.length === loaded.votes.length
              && savedCurrentItem?.pairContext?.assignmentId
              && savedOriginalId === expectedOriginalId
            ) {
              hydratedItems = hydratedItems.map((item, index) =>
                index === arenaSession.currentIndex ? savedCurrentItem : item
              );
              hydratedCurrentIndex = arenaSession.currentIndex;
              restoredSessionId = savedSession.sessionId || '';
            }
          } catch (error) {
            console.warn('Failed to restore pending Arena assignment', error);
          }
        }
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
        setVoteSaveError(null);
        setResyncError(null);
        if (loadedIsSampledArena && arenaSession?.remainingCount === 0 && currentRoute === 'voting') {
          goToRoute('results', { taskId: loaded.task.id, source: 'task' });
        }
      } catch (error: any) {
        if (!cancelled) {
          console.error('Failed to load task from route', error);
          setRouteTaskError(error?.message || '加载评测物料失败。');
        }
      } finally {
        if (!cancelled) setRouteTaskLoading(false);
      }
    };

    hydrateTaskFromRoute();

    return () => {
      cancelled = true;
    };
  }, [activeProject, activeTaskId, currentRoute, items.length, routeContext.taskId]);

  // Save to History when session is complete (moved to results)
  const saveToHistory = (completedVotes: VoteRecord[]) => {
    if (!sessionId || items.length === 0) return;

    const newEntry: HistorySession = {
      id: sessionId,
      timestamp: Date.now(),
      userName: userName || 'Anonymous',
      modelNames,
      models: taskModels,
      paradigm: taskParadigm,
      evaluationConfig: taskEvaluationConfig,
      items,
      votes: completedVotes
    };

    setHistory(prev => {
      // Avoid duplicates: if session ID exists, update it, otherwise push new
      const exists = prev.find(h => h.id === sessionId);
      const updated = exists 
        ? prev.map(h => h.id === sessionId ? newEntry : h)
        : [...prev, newEntry];
      
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const resumeSession = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const data = JSON.parse(saved);
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
        setSessionId(data.sessionId || `session-${Date.now()}`); // Ensure ID exists
        goToRoute('voting');
      } catch (e) {
        console.error("Failed to parse saved session");
      }
    }
  };

  const discardSession = () => {
    setConfirmConfig({
      isOpen: true,
      title: '放弃当前评测进度',
      message: '确定要清除当前保存的评测会话吗？清除后无法恢复。',
      onConfirm: () => {
        localStorage.removeItem(STORAGE_KEY);
        setHasSavedSession(false);
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
        goToRoute('results', taskId ? { taskId } : {});
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

  const commitVoteRecord = async (votePayload: Partial<VoteRecord>) => {
    if (voteSaving) return;
    const currentItem = items[currentIndex];
    const newVote: VoteRecord = {
      itemId: currentItem.id,
      itemSnapshot: createVoteItemSnapshot(currentItem),
      method: taskEvaluationConfig.method,
      timestamp: Date.now(),
      user: userName,
      ...votePayload
    };

    const updatedVotes = [...votes, newVote];
    setVoteSaving(true);
    setVoteSaveError(null);

    try {
      await persistVoteProgress(updatedVotes, updatedVotes.length);
      setVotes(updatedVotes);
      setAllUserVoteGroups(prev => mergeCurrentUserVoteGroup(prev, updatedVotes));

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
        setCurrentIndex(prev => prev + 1);
      } else {
        saveToHistory(updatedVotes);
        if (activeTaskId) {
          void refreshAllTaskVotes(activeTaskId);
        }
        goToRoute('results', activeTaskId ? { taskId: activeTaskId } : routeContext);
      }
    } catch (error: any) {
      setVoteSaveError(formatSaveError(error));
    } finally {
      setVoteSaving(false);
    }
  };

  const handleVote = async (vote: VoteType) => {
    const currentItem = items[currentIndex] as any;
    await commitVoteRecord({
      vote,
      choice: vote,
      pairContext: currentItem.pairContext
    });
  };

  const handleRankVote = async (ranking: RankingEntry[]) => {
    await commitVoteRecord({
      method: 'rank_order',
      ranking
    });
  };

  const handleScoreVote = async (votePayload: Partial<VoteRecord>) => {
    await commitVoteRecord(votePayload);
  };

  const handleSkipItem = async () => {
    const currentItem = items[currentIndex] as any;
    await commitVoteRecord({
      choice: 'skipped',
      pairContext: currentItem?.pairContext
    });
  };

  const handlePreviewComment = async (comment: string) => {
    await commitVoteRecord({
      method: 'benchmark_preview',
      choice: 'previewed',
      reason: comment.trim()
    });
  };

  const handlePreviewSkip = async () => {
    await commitVoteRecord({
      method: 'benchmark_preview',
      choice: 'skipped'
    });
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
        localStorage.removeItem(STORAGE_KEY);
        setHasSavedSession(false);
      }
    });
  };

  const handleEndSessionEarly = () => {
    if (votes.length > 0) {
      const finish = () => {
        saveToHistory(votes);
        goToRoute('results', activeTaskId ? { taskId: activeTaskId } : routeContext);
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
        localStorage.removeItem(HISTORY_KEY);
        setHistory([]);
      }
    });
  };

  const deleteSession = (id: string) => {
    setConfirmConfig({
      isOpen: true,
      title: '删除会话',
      message: '确定删除此会话吗？',
      onConfirm: () => {
        const updated = history.filter(h => h.id !== id);
        setHistory(updated);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
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

    if ((currentRoute === 'voting' || currentRoute === 'results') && routeContext.taskId && routeTaskLoading) {
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

    if ((currentRoute === 'voting' || currentRoute === 'results') && routeContext.taskId && routeTaskError) {
      return (
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
          <div className="w-full max-w-md rounded-lg border border-red-500/30 bg-[var(--surface-panel)] p-8 text-center">
            <h1 className="text-xl font-semibold text-white">评测物料加载失败</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{routeTaskError}</p>
            <button onClick={() => navigate('tasks')} className="btn-primary mt-6 w-full">返回评测物料</button>
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
          onOpenTask={(taskId) => navigate('tasks', { taskId, materialId: taskId, source: 'task', taskBuilderMode: 'list' })}
          onGoToInsights={(statusFilter) => navigate('insights', { materialStatusFilter: statusFilter })}
          onGoToGeneration={(batchId) => navigate('generation', { generationBatchId: batchId })}
        />
      );
    }

    if (currentRoute === 'projects') {
      return (
        <div className="py-6">
          <ProjectListPage
            initialProject={routeContext.projectId ? activeProject : null}
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
            onClearProjectScope={routeContext.projectId ? () => navigate('tasks', { taskBuilderMode: 'list' }) : undefined}
            onEvaluateTask={(task) => navigate('voting', { taskId: task.id, materialId: task.id, source: 'task' })}
            onOpenInsights={(task) => navigate('insights', { taskId: task.id, materialId: task.id, source: 'task' })}
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
            onGoToDashboard={() => navigate('overview')}
            initialProjectId={routeContext.projectId}
            initialMaterialId={routeContext.materialId || routeContext.taskId}
            initialStatusFilter={routeContext.materialStatusFilter}
            initialScope={routeContext.insightScope}
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
          onVote={handleScoreVote}
          onSkip={handleSkipItem}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={currentIndex > 0 ? handleGoBack : undefined}
          allowTie={taskEvaluationConfig.tiePolicy !== 'disallow'}
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
          onVote={handleVote}
          onSkip={handleSkipItem}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={currentIndex > 0 ? handleGoBack : undefined}
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
          onVote={handleRankVote}
          onSkip={handleSkipItem}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={currentIndex > 0 ? handleGoBack : undefined}
        />
      );
    }

    if (currentRoute === 'results') {
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
      contextTitle={activeProject?.name}
    >
      {renderRoute()}
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
