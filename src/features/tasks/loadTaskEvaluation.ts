import { collection, doc, getDoc, getDocs, setDoc } from '../../datastore';
import { db, getCurrentReviewerIdentity } from '../../auth';
import { getParadigmFromMethod, normalizeEvaluationConfig } from '../../evaluationMethods';
import { EvalTask, EvalTemplate, EvaluationItem, EvaluationProject, TaskVoteGroup, VoteRecord } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { loadTaskItems } from './loadTaskItems';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';

const USE_API_BACKEND = USE_SHARED_DATA_SOURCE;

const snapshotExists = (snapshot: any) => {
  if (!snapshot) return false;
  return typeof snapshot.exists === 'function' ? snapshot.exists() : !!snapshot.exists;
};

export interface LoadedTaskEvaluation {
  task: EvalTask;
  project?: EvaluationProject;
  items: EvaluationItem[];
  votes: VoteRecord[];
  userName: string;
  allUserVoteGroups: TaskVoteGroup[];
  allUserVoteError?: string;
  modelNames: { a: string; b: string };
  models: { id: string; name: string }[];
  paradigm: ReturnType<typeof getParadigmFromMethod>;
  evaluationConfig: ReturnType<typeof normalizeEvaluationConfig>;
}

export class TaskEvaluationLoadError extends Error {
  constructor(
    public readonly code: 'not_found' | 'forbidden' | 'empty' | 'network' | 'unknown',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TaskEvaluationLoadError';
  }
}

export async function loadTaskVoteGroups(taskId: string, signal?: AbortSignal): Promise<TaskVoteGroup[]> {
  if (USE_API_BACKEND) {
    const response = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/votes`, { credentials: 'include', headers: getApiAuthHeaders(), signal });
    if (!response.ok) throw new Error('无法读取全员投票结果');
    return ((await response.json()) as { userVotes: TaskVoteGroup[] }).userVotes || [];
  }

  const snapshot = await getDocs(collection(db, 'evalTasks', taskId, 'userVotes'));
  const voteGroups: TaskVoteGroup[] = [];
  snapshot.forEach((docSnap: any) => {
    voteGroups.push({
      user: docSnap.id,
      votes: docSnap.data().votes || []
    });
  });
  return voteGroups;
}

async function loadCurrentUserVotes(taskId: string, reviewer: ReturnType<typeof getCurrentReviewerIdentity>, signal?: AbortSignal) {
  if (!USE_API_BACKEND) return [];
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/my-votes`, { credentials: 'include', headers: getApiAuthHeaders(), signal });
  } catch (error) {
    throw new TaskEvaluationLoadError('network', error instanceof Error ? error.message : '网络连接失败');
  }
  if (response.ok) {
    return ((await response.json()) as { votes: VoteRecord[] }).votes || [];
  }

  if (response.status === 403) {
    throw new TaskEvaluationLoadError('forbidden', '你没有权限读取这份评测物料的投票进度。', 403);
  }
  if (response.status !== 404) {
    throw new TaskEvaluationLoadError('unknown', `评测进度加载失败（${response.status}）。`, response.status);
  }

  // Compatibility for deployments created before the reviewer-identity route.
  const legacyKeys = [reviewer.id, reviewer.email, reviewer.displayName].filter(Boolean);
  for (const key of legacyKeys) {
    const legacyResponse = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/votes/${encodeURIComponent(key)}`, { credentials: 'include', headers: getApiAuthHeaders(), signal });
    if (legacyResponse.ok) {
      const legacyVotes = ((await legacyResponse.json()) as { votes: VoteRecord[] }).votes || [];
      if (legacyVotes.length > 0) return legacyVotes;
    }
  }
  return [];
}

export async function loadTaskEvaluation(taskId: string, options: { signal?: AbortSignal } = {}): Promise<LoadedTaskEvaluation> {
  let task: EvalTask;
  let template: EvalTemplate | undefined;
  let project: EvaluationProject | undefined;

  if (USE_API_BACKEND) {
    let taskResponse: Response;
    try {
      taskResponse = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, { credentials: 'include', headers: getApiAuthHeaders(), signal: options.signal });
    } catch (error) {
      throw new TaskEvaluationLoadError('network', error instanceof Error ? error.message : '网络连接失败');
    }
    if (!taskResponse.ok) {
      if (taskResponse.status === 404) throw new TaskEvaluationLoadError('not_found', '评测物料不存在或已删除。', 404);
      if (taskResponse.status === 403) throw new TaskEvaluationLoadError('forbidden', '你没有权限查看这份评测物料。', 403);
      throw new TaskEvaluationLoadError('unknown', `评测物料加载失败（${taskResponse.status}）。`, taskResponse.status);
    }
    task = ((await taskResponse.json()) as { task: EvalTask }).task;

    if (task.templateId) {
      const templateResponse = await fetch(`${API_BASE_URL}/api/templates/${task.templateId}`, { credentials: 'include', headers: getApiAuthHeaders(), signal: options.signal });
      if (templateResponse.ok) {
        template = ((await templateResponse.json()) as { template: EvalTemplate }).template;
      }
    }

    if (task.projectId) {
      const projectResponse = await fetch(`${API_BASE_URL}/api/projects/${task.projectId}`, { credentials: 'include', headers: getApiAuthHeaders(), signal: options.signal });
      if (projectResponse.ok) {
        project = ((await projectResponse.json()) as { project: EvaluationProject }).project;
      }
    }
  } else {
    const taskSnapshot = await getDoc(doc(db, 'evalTasks', taskId));
    if (!snapshotExists(taskSnapshot)) {
      throw new TaskEvaluationLoadError('not_found', '评测物料不存在或已删除。', 404);
    }

    task = { id: taskSnapshot.id, ...taskSnapshot.data() } as EvalTask;
    const templateSnapshot = task.templateId ? await getDoc(doc(db, 'evalTemplates', task.templateId)) : null;
    template = templateSnapshot && snapshotExists(templateSnapshot)
      ? ({ id: templateSnapshot.id, ...templateSnapshot.data() } as EvalTemplate)
      : undefined;

    if (task.projectId) {
      try {
        const projectSnapshot = await getDoc(doc(db, 'projects', task.projectId));
        if (snapshotExists(projectSnapshot)) {
          project = { id: projectSnapshot.id, ...projectSnapshot.data() } as EvaluationProject;
        }
      } catch (error) {
        console.error('Failed to load project for task route', error);
      }
    }
  }

  const evaluationConfig = normalizeEvaluationConfig(task, template);
  const paradigm = getParadigmFromMethod(evaluationConfig.method);
  const models = task.models?.length ? task.models : [
    { id: 'model-a', name: 'Model A' },
    { id: 'model-b', name: 'Model B' }
  ];

  const items = await loadTaskItems(task, { updateTotalItems: true, signal: options.signal });

  if (items.length === 0) {
    throw new TaskEvaluationLoadError('empty', '这份评测物料没有可执行的 case 数据。');
  }

  const reviewer = getCurrentReviewerIdentity();
  const userName = reviewer.displayName;
  let votes: VoteRecord[] = [];
  let allUserVoteGroups: TaskVoteGroup[] = [];
  let allUserVoteError: string | undefined;
  if (USE_API_BACKEND) {
    votes = await loadCurrentUserVotes(task.id, reviewer, options.signal);
    try {
      allUserVoteGroups = await loadTaskVoteGroups(task.id, options.signal);
    } catch (error: any) {
      console.error('Failed to hydrate all task votes', error);
      allUserVoteError = error?.message || '无法读取全员汇总结果';
    }
    return {
      task,
      project,
      items,
      votes,
      userName,
      allUserVoteGroups,
      allUserVoteError,
      modelNames: {
        a: models[0]?.name || 'Model A',
        b: models[1]?.name || 'Model B'
      },
      models,
      paradigm,
      evaluationConfig
    };
  }

  try {
    const voteSnapshot = await getDoc(doc(db, 'evalTasks', task.id, 'userVotes', userName));
    if (snapshotExists(voteSnapshot)) {
      votes = voteSnapshot.data().votes || [];
    }
    try {
      allUserVoteGroups = await loadTaskVoteGroups(task.id);
    } catch (error: any) {
      console.error('Failed to hydrate all task votes', error);
      allUserVoteError = error?.message || '无法读取全员汇总结果';
    }
    if (task.progress?.[userName] === undefined) {
      await setDoc(doc(db, 'evalTasks', task.id), { progress: { [userName]: votes.length } }, { merge: true });
    }
  } catch (error) {
    console.error('Failed to hydrate task votes', error);
  }

  return {
    task,
    project,
    items,
    votes,
    userName,
    allUserVoteGroups,
    allUserVoteError,
    modelNames: {
      a: models[0]?.name || 'Model A',
      b: models[1]?.name || 'Model B'
    },
    models,
    paradigm,
    evaluationConfig
  };
}
