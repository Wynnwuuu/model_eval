import { collection, doc, getDoc, getDocs, updateDoc } from '../../datastore';
import { db } from '../../firebase';
import { getDimensionValuesForItem, getDimensionValuesFromRecord } from '../../dimensionUtils';
import { EvalTask, EvaluationItem } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const USE_API_BACKEND = import.meta.env.VITE_USE_API_BACKEND === 'true' && Boolean(API_BASE_URL);

const snapshotExists = (snapshot: any) => {
  if (!snapshot) return false;
  return typeof snapshot.exists === 'function' ? snapshot.exists() : !!snapshot.exists;
};

interface LoadTaskItemsOptions {
  updateTotalItems?: boolean;
}

export async function loadTaskItems(task: EvalTask, options: LoadTaskItemsOptions = {}) {
  if (USE_API_BACKEND) {
    const response = await fetch(`${API_BASE_URL}/api/tasks/${task.id}/items`, { headers: getApiAuthHeaders() });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error?.message || errorBody.error || `加载任务用例失败: ${response.status}`);
    }
    const data = await response.json() as { items: EvaluationItem[] };
    return data.items.map(item => ({
      ...item,
      dimensionValues: getDimensionValuesForItem(item as any, task.dimensionColumns || []),
    })).sort((a: any, b: any) => {
      const leftOrder = Number(a.itemOrder ?? 0);
      const rightOrder = Number(b.itemOrder ?? 0);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(a.id).localeCompare(String(b.id));
    });
  }

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

  if (options.updateTotalItems && items.length > 0 && task.totalItems !== items.length) {
    updateDoc(doc(db, 'evalTasks', task.id), { totalItems: items.length }).catch(error => {
      console.error('Failed to update totalItems', error);
    });
  }

  return items;
}
