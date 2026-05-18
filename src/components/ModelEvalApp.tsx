
import React, { useState, useEffect } from 'react';
import SetupScreen from './SetupScreen';
import VotingScreen from './VotingScreen';
import ArenaRankVotingScreen from './ArenaRankVotingScreen';
import ScoreEvaluationScreen from './ScoreEvaluationScreen';
import ResultsScreen from './ResultsScreen';
import { ConfirmModal } from './ConfirmModal';
import AppShell from './AppShell';
import OverviewPage from '../pages/overview/OverviewPage';
import ProjectListPage from '../pages/projects/ProjectListPage';
import DatasetListPage from '../pages/datasets/DatasetListPage';
import TemplateListPage from '../pages/templates/TemplateListPage';
import TaskListPage from '../pages/tasks/TaskListPage';
import InsightDashboardPage from '../pages/insights/InsightDashboardPage';
import HistoryPage from '../pages/history/HistoryPage';
import { AppRoute, EvalParadigm, EvaluationConfig, EvaluationItem, HistorySession, RankingEntry, RouteContext, VoteRecord, VoteType, EvaluationProject } from '../types';
import { auth, signInWithGoogle, logout, shouldUseFirebase } from '../firebase';
import { getDefaultEvaluationConfig, getMethodFromParadigm, getParadigmFromMethod, isRankMethod, isScoreMethod } from '../evaluationMethods';
import { loadTaskEvaluation } from '../features/tasks/api';

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

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      setUser(user);
      if (user) {
        setUserName(user.email);
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
        timestamp: Date.now(),
        sessionId // Persist the ID
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
    }
  }, [items, votes, currentIndex, currentRoute, userName, modelNames, taskModels, taskParadigm, taskEvaluationConfig, sessionId]);

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
        setItems(loaded.items);
        setVotes(loaded.votes);
        setCurrentIndex(Math.min(loaded.votes.length, Math.max(loaded.items.length - 1, 0)));
        setUserName(loaded.userName);
        setModelNames(loaded.modelNames);
        setTaskModels(loaded.models);
        setTaskParadigm(loaded.paradigm);
        setTaskEvaluationConfig(loaded.evaluationConfig);
        setActiveTaskId(loaded.task.id);
        setSessionId(`session-${loaded.task.id}-${Date.now()}`);
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
    setItems(parsedItems);
    setUserName(name);
    if (parsedNames) setModelNames(parsedNames);
    else setModelNames({ a: 'Model A', b: 'Model B' });
    setTaskModels(models && models.length > 0 ? models : [
      { id: 'model-a', name: parsedNames?.a || 'Model A' },
      { id: 'model-b', name: parsedNames?.b || 'Model B' }
    ]);
    const nextConfig = evaluationConfig || getDefaultEvaluationConfig(getMethodFromParadigm(paradigm));
    setTaskParadigm(getParadigmFromMethod(nextConfig.method));
    setTaskEvaluationConfig(nextConfig);
    setActiveTaskId(taskId || null);
    
    // Generate unique ID for this session
    setSessionId(`session-${Date.now()}`);

    if (existingVotes && existingVotes.length > 0) {
      setVotes(existingVotes);
      if (existingVotes.length >= parsedItems.length) {
        setCurrentIndex(parsedItems.length - 1);
        goToRoute('results', taskId ? { taskId } : {});
      } else {
        setCurrentIndex(existingVotes.length);
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
      const { doc, updateDoc, FieldPath, setDoc } = await import('../datastore');
      const { db } = await import('../firebase');
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
    }
  };

  const commitVoteRecord = async (votePayload: Partial<VoteRecord>) => {
    const currentItem = items[currentIndex];
    const newVote: VoteRecord = {
      itemId: currentItem.id,
      method: taskEvaluationConfig.method,
      timestamp: Date.now(),
      user: userName,
      ...votePayload
    };

    const updatedVotes = [...votes, newVote];
    setVotes(updatedVotes);
    await persistVoteProgress(updatedVotes, currentIndex + 1);

    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      saveToHistory(updatedVotes);
      goToRoute('results', activeTaskId ? { taskId: activeTaskId } : routeContext);
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

  const handleGoBack = async () => {
    if (currentIndex > 0) {
      const updatedVotes = votes.slice(0, -1);
      setVotes(updatedVotes);
      setCurrentIndex(prev => prev - 1);

      if (activeTaskId && userName) {
        try {
          const { doc, updateDoc, FieldPath, setDoc } = await import('../datastore');
          const { db } = await import('../firebase');
          const taskRef = doc(db, 'evalTasks', activeTaskId);
          try {
            await updateDoc(taskRef, new FieldPath('progress', userName), currentIndex - 1);
          } catch (updateErr) {
            try {
              await setDoc(taskRef, { progress: { [userName]: currentIndex - 1 } }, { merge: true });
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
        } catch (e) {
          console.error("Failed to initialize go back persistence", e);
        }
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
        localStorage.removeItem(STORAGE_KEY);
        setHasSavedSession(false);
      }
    });
  };

  const handleEndSessionEarly = () => {
    if (votes.length > 0) {
      saveToHistory(votes);
      goToRoute('results', activeTaskId ? { taskId: activeTaskId } : routeContext);
    } else {
      handleReset();
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

  const renderRoute = () => {
    if (!user && shouldUseFirebase) {
      return (
        <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4">
          <div className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-8 text-center">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)] text-black font-bold">ES</div>
            <h1 className="text-2xl font-semibold text-white">登录 Eval Studio</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">进入评测一体化平台，管理评测集、评测物料、参与评测、结果洞察和生产流程。</p>
            <button onClick={signInWithGoogle} className="btn-primary mt-6 w-full">使用 Google 登录</button>
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
          onGoToEvaluation={() => navigate('evaluation')}
          onGoToInsights={(statusFilter) => navigate('insights', { materialStatusFilter: statusFilter })}
          onGoToGeneration={() => navigate('generation')}
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
                const nextUserName = auth.currentUser?.email || auth.currentUser?.displayName || localStorage.getItem('eval_username') || 'Anonymous';
                handleStart(taskItems, nextUserName, modelNames, taskId, existingVotes, paradigm, models, evaluationConfig);
              } else {
                navigate('evaluation', { projectId: project.id, source: 'dashboard' });
              }
            }}
            onGoToAnalysis={(project) => {
              setActiveProject(project);
              navigate('insights', { projectId: project.id, source: 'dashboard' });
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
            projectId={activeProject?.id || routeContext.projectId}
            initialMode={routeContext.taskBuilderMode || taskBuilderMode}
            initialStatusFilter={routeContext.materialStatusFilter}
            initialTaskId={routeContext.taskId}
            onBack={() => navigate('projects')}
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

    if (currentRoute === 'voting' && items.length > 0 && isScoreMethod(taskEvaluationConfig)) {
      return (
        <ScoreEvaluationScreen
          item={items[currentIndex]}
          currentIndex={currentIndex}
          totalItems={items.length}
          models={taskModels}
          config={taskEvaluationConfig}
          onVote={handleScoreVote}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={currentIndex > 0 ? handleGoBack : undefined}
          allowTie={taskEvaluationConfig.tiePolicy !== 'disallow'}
        />
      );
    }

    if (currentRoute === 'voting' && items.length > 0 && !isRankMethod(taskEvaluationConfig)) {
      return (
        <VotingScreen
          item={items[currentIndex]}
          nextItem={items[currentIndex + 1]}
          currentIndex={currentIndex}
          totalItems={items.length}
          onVote={handleVote}
          onEnd={handleEndSessionEarly}
          onBack={() => navigate('overview')}
          onGoBack={currentIndex > 0 ? handleGoBack : undefined}
        />
      );
    }

    if (currentRoute === 'voting' && items.length > 0 && isRankMethod(taskEvaluationConfig)) {
      return (
        <ArenaRankVotingScreen
          item={items[currentIndex]}
          nextItem={items[currentIndex + 1]}
          currentIndex={currentIndex}
          totalItems={items.length}
          models={taskModels}
          onVote={handleRankVote}
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
            onGoToDashboard={() => navigate('overview')}
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
      shouldUseFirebase={shouldUseFirebase}
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
