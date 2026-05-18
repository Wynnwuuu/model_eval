import { doc, getDoc, setDoc } from '../../datastore';
import { auth, db } from '../../firebase';
import { getParadigmFromMethod, normalizeEvaluationConfig } from '../../evaluationMethods';
import { EvalTask, EvalTemplate, EvaluationItem, EvaluationProject, VoteRecord } from '../../types';
import { loadTaskItems } from './loadTaskItems';

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
  const taskSnapshot = await getDoc(doc(db, 'evalTasks', taskId));
  if (!snapshotExists(taskSnapshot)) {
    throw new Error('未找到这份评测物料。');
  }

  const task = { id: taskSnapshot.id, ...taskSnapshot.data() } as EvalTask;
  const templateSnapshot = task.templateId ? await getDoc(doc(db, 'evalTemplates', task.templateId)) : null;
  const template = templateSnapshot && snapshotExists(templateSnapshot)
    ? ({ id: templateSnapshot.id, ...templateSnapshot.data() } as EvalTemplate)
    : undefined;

  let project: EvaluationProject | undefined;
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
