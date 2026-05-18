import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from '../../datastore';
import { auth, db } from '../../firebase';
import { getDimensionValuesForItem, getDimensionValuesFromRecord } from '../../dimensionUtils';
import { getParadigmFromMethod, normalizeEvaluationConfig } from '../../evaluationMethods';
import { EvalTask, EvalTemplate, EvaluationItem, EvaluationProject, VoteRecord } from '../../types';

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

  const itemsSnapshot = await getDocs(collection(db, 'evalTasks', task.id, 'items'));
  let items = itemsSnapshot.docs.map((docSnap: any) => {
    const data = { id: docSnap.id, ...docSnap.data() } as EvaluationItem;
    data.dimensionValues = getDimensionValuesForItem(data as any, task.dimensionColumns || []);
    if (!data.modelOutputs?.length) {
      const originalData = (data as any).originalData || {};
      data.modelOutputs = models.map((model, idx) => ({
        modelId: model.id || `model-${idx}`,
        modelName: model.name || `Model ${idx + 1}`,
        url: idx === 0
          ? data.modelA_Url
          : idx === 1
            ? data.modelB_Url
            : originalData[model.name] || originalData[model.id] || ''
      })).filter(output => output.url);
    }
    return data;
  }).sort((a: any, b: any) => {
    const leftOrder = Number(a.itemOrder ?? 0);
    const rightOrder = Number(b.itemOrder ?? 0);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(a.id).localeCompare(String(b.id));
  });

  if (items.length === 0 && task.datasetId && task.datasetId !== 'external-csv') {
    const datasetSnapshot = await getDoc(doc(db, 'evalDatasets', task.datasetId));
    if (snapshotExists(datasetSnapshot)) {
      const datasetData = datasetSnapshot.data() as any;
      if (datasetData.items?.length) {
        items = datasetData.items.map((row: any, idx: number) => {
          const keys = Object.keys(row);
          const fallbackModelKeys = keys.filter(key => !key.toLowerCase().includes('id')).slice(-(models.length || 2));
          const modelKeys = models.map((model, modelIdx) => (
            row[model.name] !== undefined ? model.name :
            row[model.id] !== undefined ? model.id :
            fallbackModelKeys[modelIdx]
          )).filter(Boolean);
          const modelAKey = modelKeys[0] || keys[keys.length - 2];
          const modelBKey = modelKeys[1] || keys[keys.length - 1];
          const inputs = { ...row };
          modelKeys.forEach(key => delete inputs[key]);
          (task.dimensionColumns || []).forEach(key => delete inputs[key]);

          let startImageUrl: string | undefined;
          const referenceUrls: string[] = [];
          Object.keys(inputs).forEach(col => {
            const val = inputs[col];
            if (typeof val !== 'string') return;
            const urls = val.match(/https?:\/\/[^\s"'\t|,;>]+/g);
            if (!urls) return;
            const lowerCol = col.toLowerCase();
            urls.forEach(u => {
              if (lowerCol.includes('start') || lowerCol.includes('首帧') || lowerCol.includes('first')) {
                if (!startImageUrl) startImageUrl = u;
                else referenceUrls.push(u);
              } else if (lowerCol.includes('ref') || lowerCol.includes('参考')) {
                referenceUrls.push(u);
              } else {
                if (!startImageUrl) startImageUrl = u;
                else referenceUrls.push(u);
              }
            });
          });

          return {
            id: `ds-item-${idx}`,
            modelA_Url: row[modelAKey] || '',
            modelB_Url: row[modelBKey] || '',
            modelOutputs: models.map((model, modelIdx) => ({
              modelId: model.id || `model-${modelIdx}`,
              modelName: model.name || `Model ${modelIdx + 1}`,
              url: row[modelKeys[modelIdx]] || ''
            })).filter(output => output.url),
            inputs,
            dimensionValues: getDimensionValuesFromRecord(row, task.dimensionColumns || []),
            prompt: inputs['prompt'] || inputs['提示词'] || Object.values(inputs)[0] || '',
            type: task.outputType || 'text',
            startImageUrl,
            referenceUrls: referenceUrls.length > 0 ? referenceUrls : undefined
          } as EvaluationItem;
        });
      }
    }
  }

  if (items.length === 0) {
    throw new Error('这份评测物料没有可执行的 case 数据。');
  }

  if (task.totalItems !== items.length) {
    updateDoc(doc(db, 'evalTasks', task.id), { totalItems: items.length }).catch(error => {
      console.error('Failed to update totalItems', error);
    });
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
