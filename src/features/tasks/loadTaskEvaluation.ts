import { doc, getDoc, setDoc } from '../../datastore';
import { auth, db } from '../../auth';
import { getParadigmFromMethod, normalizeEvaluationConfig } from '../../evaluationMethods';
import { EvalTask, EvalTemplate, EvaluationItem, EvaluationProject, VoteRecord } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { loadTaskItems } from './loadTaskItems';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const USE_API_BACKEND = import.meta.env.VITE_USE_API_BACKEND === 'true';

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
  modelNames: { a: string; b: string };
  models: { id: string; name: string }[];
  paradigm: ReturnType<typeof getParadigmFromMethod>;
  evaluationConfig: ReturnType<typeof normalizeEvaluationConfig>;
}

export async function loadTaskEvaluation(taskId: string): Promise<LoadedTaskEvaluation> {
  let task: EvalTask;
  let template: EvalTemplate | undefined;
  let project: EvaluationProject | undefined;

  if (USE_API_BACKEND) {
    const taskResponse = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, { headers: getApiAuthHeaders() });
    if (!taskResponse.ok) throw new Error('未找到这份评测物料。');
    task = ((await taskResponse.json()) as { task: EvalTask }).task;

    if (task.templateId) {
      const templateResponse = await fetch(`${API_BASE_URL}/api/templates/${task.templateId}`, { headers: getApiAuthHeaders() });
      if (templateResponse.ok) {
        template = ((await templateResponse.json()) as { template: EvalTemplate }).template;
      }
    }

    if (task.projectId) {
      const projectResponse = await fetch(`${API_BASE_URL}/api/projects/${task.projectId}`, { headers: getApiAuthHeaders() });
      if (projectResponse.ok) {
        project = ((await projectResponse.json()) as { project: EvaluationProject }).project;
      }
    }
  } else {
    const taskSnapshot = await getDoc(doc(db, 'evalTasks', taskId));
    if (!snapshotExists(taskSnapshot)) {
      throw new Error('未找到这份评测物料。');
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

  const items = await loadTaskItems(task, { updateTotalItems: true });

  if (items.length === 0) {
    throw new Error('这份评测物料没有可执行的 case 数据。');
  }

  const userName = auth.currentUser?.email || auth.currentUser?.displayName || localStorage.getItem('eval_username') || 'Anonymous';
  let votes: VoteRecord[] = [];
  try {
    if (USE_API_BACKEND) {
      const voteResponse = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/votes/${encodeURIComponent(userName)}`, { headers: getApiAuthHeaders() });
      if (voteResponse.ok) {
        votes = ((await voteResponse.json()) as { votes: VoteRecord[] }).votes;
      }
      return {
        task,
        project,
        items,
        votes,
        userName,
        modelNames: {
          a: models[0]?.name || 'Model A',
          b: models[1]?.name || 'Model B'
        },
        models,
        paradigm,
        evaluationConfig
      };
    }

    const voteSnapshot = await getDoc(doc(db, 'evalTasks', task.id, 'userVotes', userName));
    if (snapshotExists(voteSnapshot)) {
      votes = voteSnapshot.data().votes || [];
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
    modelNames: {
      a: models[0]?.name || 'Model A',
      b: models[1]?.name || 'Model B'
    },
    models,
    paradigm,
    evaluationConfig
  };
}
