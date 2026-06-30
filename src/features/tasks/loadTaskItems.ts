import { collection, doc, getDoc, getDocs, updateDoc } from '../../datastore';
import { db } from '../../auth';
import { getDimensionValuesForItem, getDimensionValuesFromRecord } from '../../dimensionUtils';
import { sortReferenceUrls } from '../../mediaTypeUtils';
import { extractMediaUrls } from '../../mediaUrlUtils';
import { EvalTask, EvaluationItem } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';

const USE_API_BACKEND = USE_SHARED_DATA_SOURCE;

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
      referenceUrls: item.referenceUrls?.length ? sortReferenceUrls(item.referenceUrls) : item.referenceUrls,
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
    if (data.referenceUrls?.length) {
      data.referenceUrls = sortReferenceUrls(data.referenceUrls);
    }
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

  if (items.length === 0 && !(task as any).hasTaskItemEdits && task.datasetId && task.datasetId !== 'external-csv') {
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
            const urls = extractMediaUrls(inputs[col]);
            if (urls.length === 0) return;

            const lowerCol = col.toLowerCase();
            const isMusicCol = /music|audio|bgm|配乐|音乐|音频/.test(lowerCol);
            const isStartCol = /start|首帧|first/.test(lowerCol);
            const isRefCol = /ref|reference|参考|image_json|music_json/.test(lowerCol) || isMusicCol;

            urls.forEach(u => {
              if (isMusicCol || (isRefCol && !isStartCol)) {
                referenceUrls.push(u);
                return;
              }
              if (isStartCol) {
                if (!startImageUrl) startImageUrl = u;
                else referenceUrls.push(u);
                return;
              }
              if (!startImageUrl) startImageUrl = u;
              else referenceUrls.push(u);
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
            referenceUrls: referenceUrls.length > 0 ? sortReferenceUrls(referenceUrls) : undefined
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
