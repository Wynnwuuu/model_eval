import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc } from '../../datastore';
import { auth, db } from '../../auth';
import { DatasetSyncSummary, DatasetVersionSnapshot, EvalDataset, EvalTask, EvaluationItem, VoteRecord } from '../../types';
import { buildDatasetClone } from '../../datasetClone';
import {
  detectDatasetColumnRenames,
  ensureStableDatasetItemIds,
  inferTaskDatasetBinding,
  planDatasetTaskSync,
  remapTaskDatasetBinding,
  synchronizeVoteSnapshot,
} from '../../datasetSync';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';
import { notifyPageMetadataRefresh } from '../../pageMetadataClient';

const HTTP_REFRESH_INTERVAL_MS = 5000;

const datasetReloaders = new Set<() => void>();

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getApiAuthHeaders(),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(errorBody.error?.message || errorBody.error || `Request failed: ${response.status}`) as Error & {
      status?: number;
      code?: string;
      details?: unknown;
    };
    error.status = response.status;
    error.code = errorBody.error?.code;
    error.details = errorBody.error?.details;
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function loadHttpDatasets() {
  const response = await requestJson<{ datasets: EvalDataset[] }>('/api/datasets');
  return response.datasets;
}

function notifyDatasetReloaders() {
  datasetReloaders.forEach(reload => reload());
  notifyPageMetadataRefresh();
}

const sanitizeDatasetValue = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(item => item === undefined ? null : sanitizeDatasetValue(item));
  }
  if (typeof value === 'object') {
    const next: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
      const sanitized = sanitizeDatasetValue(item);
      if (sanitized !== undefined) next[key] = sanitized;
    });
    return next;
  }
  return value;
};

const summarizeDatasetChangeValue = (value: unknown) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const text = serialized || '';
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

const toVersionSnapshot = (dataset: EvalDataset): DatasetVersionSnapshot => ({
  version: dataset.version || 1,
  name: dataset.name,
  description: dataset.description,
  tags: dataset.tags || [],
  inputSchema: dataset.inputSchema || [],
  items: dataset.items || [],
  inputType: dataset.inputType,
  modality: dataset.modality,
  categoryPath: dataset.categoryPath || [],
  columnMappings: dataset.columnMappings,
  datasetCard: dataset.datasetCard,
  validationSummary: dataset.validationSummary,
  standardFields: dataset.standardFields,
  syncSummary: dataset.syncSummary,
  copiedFrom: dataset.copiedFrom,
  updatedAt: dataset.updatedAt || Date.now(),
});

const attachLocalVersionSnapshot = (dataset: EvalDataset, existing?: EvalDataset): EvalDataset => {
  const version = String(dataset.version || 1);
  return {
    ...dataset,
    versionSnapshots: {
      ...(existing?.versionSnapshots || {}),
      ...(dataset.versionSnapshots || {}),
      [version]: toVersionSnapshot(dataset),
    },
  };
};

const datasetFromSnapshot = (dataset: EvalDataset, snapshot: DatasetVersionSnapshot): EvalDataset => ({
  ...dataset,
  name: snapshot.name || dataset.name,
  description: snapshot.description ?? dataset.description,
  tags: snapshot.tags || dataset.tags,
  inputSchema: snapshot.inputSchema || [],
  items: ensureStableDatasetItemIds(dataset.id, snapshot.items || []),
  inputType: snapshot.inputType || dataset.inputType,
  modality: snapshot.modality || dataset.modality,
  categoryPath: snapshot.categoryPath || dataset.categoryPath || [],
  columnMappings: snapshot.columnMappings,
  datasetCard: snapshot.datasetCard,
  validationSummary: snapshot.validationSummary,
  standardFields: snapshot.standardFields,
  syncSummary: snapshot.syncSummary,
  copiedFrom: snapshot.copiedFrom ?? dataset.copiedFrom,
  version: snapshot.version,
  updatedAt: snapshot.updatedAt || dataset.updatedAt,
});

const emptySyncSummary = (): DatasetSyncSummary => ({
  projects: 0,
  tasks: 0,
  taskItemsUpdated: 0,
  taskItemsAdded: 0,
  taskItemsArchived: 0,
  votesUpdated: 0,
  votesArchived: 0,
  warnings: [],
});

const propagateLocalDatasetVersion = async (previous: EvalDataset, next: EvalDataset) => {
  const summary = emptySyncSummary();
  const tasksSnapshot = await getDocs(collection(db, 'evalTasks'));
  const taskRows = tasksSnapshot.docs
    .map((taskDoc: any) => ({ docId: taskDoc.id, ...taskDoc.data() } as EvalTask & { docId: string }))
    .filter(task => task.datasetId === next.id);
  summary.tasks = taskRows.length;
  summary.projects = new Set(taskRows.map(task => task.projectId).filter(Boolean)).size;
  const columnRenameMap = detectDatasetColumnRenames(
    previous.items || [],
    next.items || [],
    previous.columnMappings,
    next.columnMappings
  );
  const nextColumnKeys = Array.from(new Set([
    ...next.inputSchema.map(field => field.key),
    ...(next.items || []).flatMap(row => Object.keys(row)).filter(key => !key.startsWith('__')),
  ]));

  for (const task of taskRows) {
    const itemSnapshot = await getDocs(collection(db, 'evalTasks', task.docId, 'items'));
    const docIdByItemId = new Map<string, string>();
    const taskItems = itemSnapshot.docs
      .map((itemDoc: any) => {
        const data = itemDoc.data() as EvaluationItem;
        const item = { ...data, id: data.id || itemDoc.id };
        docIdByItemId.set(item.id, itemDoc.id);
        return item;
      })
      .filter(item => !item.archivedAt);
    const inferredBinding = inferTaskDatasetBinding(task, taskItems, previous.columnMappings);
    const binding = remapTaskDatasetBinding(
      inferredBinding,
      previous.columnMappings,
      next.columnMappings,
      nextColumnKeys,
      columnRenameMap
    );
    const synchronizedTask: EvalTask = {
      ...task,
      datasetBinding: { ...binding, datasetVersion: next.version || binding.datasetVersion },
      models: task.models.map(model => ({ ...model, name: binding.modelColumns[model.id] || model.name })),
    };
    const plan = planDatasetTaskSync({
      task: synchronizedTask,
      previousRows: previous.items || [],
      nextRows: next.items || [],
      taskItems,
      nextVersion: next.version || 1,
    });
    summary.warnings.push(...plan.warnings);
    const latestByItemId = new Map<string, EvaluationItem>();

    for (const update of plan.updates) {
      const itemDocId = docIdByItemId.get(update.itemId) || update.itemId;
      await setDoc(doc(db, 'evalTasks', task.docId, 'items', itemDocId), update.item);
      latestByItemId.set(update.itemId, update.item);
      summary.taskItemsUpdated += 1;
    }
    for (const item of plan.additions) {
      await setDoc(doc(db, 'evalTasks', task.docId, 'items', item.id), item);
      latestByItemId.set(item.id, item);
      summary.taskItemsAdded += 1;
    }
    const archivedIds = new Set<string>();
    for (const archive of plan.archives) {
      const archivedAt = Date.now();
      const itemDocId = docIdByItemId.get(archive.itemId) || archive.itemId;
      await setDoc(doc(db, 'evalTasks', task.docId, 'items', itemDocId), {
        ...archive.item,
        archivedAt,
      });
      archivedIds.add(archive.itemId);
      summary.taskItemsArchived += 1;
    }

    const progress: Record<string, number> = {};
    const votesSnapshot = await getDocs(collection(db, 'evalTasks', task.docId, 'userVotes'));
    for (const voteDoc of votesSnapshot.docs as any[]) {
      const data = voteDoc.data() || {};
      const archivedVotes: VoteRecord[] = [...(data.archivedVotes || [])];
      const votes = (data.votes || []).flatMap((vote: VoteRecord) => {
        if (archivedIds.has(vote.itemId)) {
          archivedVotes.push({
            ...vote,
            evaluatedItemSnapshot: vote.evaluatedItemSnapshot || vote.itemSnapshot,
            datasetVersionEvaluated: vote.datasetVersionEvaluated || vote.itemSnapshot?.sourceDatasetVersion,
            datasetVersionCurrent: next.version || 1,
            contentUpdatedAfterVote: true,
            archivedAt: Date.now(),
            archivedReason: `来源评测集 v${next.version || 1} 已移除`,
          });
          summary.votesArchived += 1;
          return [];
        }
        const latestItem = latestByItemId.get(vote.itemId);
        if (!latestItem) return [vote];
        summary.votesUpdated += 1;
        return [synchronizeVoteSnapshot(vote, latestItem, next.version || 1)];
      });
      progress[voteDoc.id] = votes.length;
      await setDoc(doc(db, 'evalTasks', task.docId, 'userVotes', voteDoc.id), {
        ...data,
        votes,
        archivedVotes,
      });
    }

    const { docId, ...taskData } = task;
    await setDoc(doc(db, 'evalTasks', docId), {
      ...taskData,
      datasetBinding: plan.binding,
      models: synchronizedTask.models,
      dimensionColumns: plan.binding.dimensionColumns,
      totalItems: taskItems.length + plan.additions.length - plan.archives.length,
      progress: { ...(task.progress || {}), ...progress },
    });
  }
  return summary;
};

export function subscribeDatasets(
  onNext: (datasets: EvalDataset[]) => void,
  onError?: (error: unknown) => void
) {
  if (USE_SHARED_DATA_SOURCE) {
    let active = true;
    const reload = () => {
      loadHttpDatasets()
        .then(datasets => {
          if (active) onNext(datasets);
        })
        .catch(error => {
          if (active) onError?.(error);
        });
    };
    datasetReloaders.add(reload);
    reload();
    const intervalId = window.setInterval(reload, HTTP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      datasetReloaders.delete(reload);
    };
  }

  const datasetsQuery = query(collection(db, 'evalDatasets'), orderBy('createdAt', 'desc'));
  return onSnapshot(datasetsQuery, (snapshot: any) => {
    const datasets: EvalDataset[] = [];
    snapshot.forEach((docSnap: any) => {
      const data = docSnap.data() as EvalDataset;
      const items = ensureStableDatasetItemIds(docSnap.id, data.items || []);
      const requiresStableIdBackfill = (data.items || []).some((item, index) => item.__datasetItemId !== items[index]?.__datasetItemId);
      const normalized = { id: docSnap.id, ...data, items } as EvalDataset;
      datasets.push(normalized);
      if (requiresStableIdBackfill) {
        void setDoc(doc(db, 'evalDatasets', docSnap.id), sanitizeDatasetValue(normalized));
      }
    });
    onNext(datasets);
  }, onError);
}

export async function createDataset(dataset: Omit<EvalDataset, 'id'> & Partial<Pick<EvalDataset, 'id'>>) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset }>('/api/datasets', {
      method: 'POST',
      body: JSON.stringify({ dataset: sanitizeDatasetValue(dataset) }),
    });
    notifyDatasetReloaders();
    return response.dataset.id;
  }

  const localId = dataset.id || `ds-${Date.now()}`;
  const datasetWithSnapshot = attachLocalVersionSnapshot({
    ...dataset,
    id: localId,
    items: ensureStableDatasetItemIds(localId, dataset.items || []),
  } as EvalDataset);
  await setDoc(doc(db, 'evalDatasets', localId), sanitizeDatasetValue(datasetWithSnapshot));
  return localId;
}

export async function cloneDataset(datasetId: string, sourceVersion: number, name: string) {
  const cloneName = name.trim();
  if (!cloneName) throw new Error('请输入副本名称');
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
    throw new Error('来源版本无效');
  }

  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset }>(`/api/datasets/${datasetId}/clone`, {
      method: 'POST',
      body: JSON.stringify({ sourceVersion, name: cloneName }),
    });
    notifyDatasetReloaders();
    return response.dataset;
  }

  const sourceSnap = await getDoc(doc(db, 'evalDatasets', datasetId));
  if (!sourceSnap.exists) throw new Error('来源评测集不存在');
  const current = sourceSnap.data() as EvalDataset;
  let source = current;
  if ((current.version || 1) !== sourceVersion) {
    const snapshot = current.versionSnapshots?.[String(sourceVersion)];
    if (!snapshot) throw new Error('来源评测集版本不存在');
    source = datasetFromSnapshot(current, snapshot);
  }

  const currentUser = auth.currentUser;
  const clone = buildDatasetClone(source, {
    id: `ds-${crypto.randomUUID()}`,
    name: cloneName,
    actorId: currentUser?.uid || 'local-user',
    actorName: currentUser?.displayName || currentUser?.email || 'Local',
  });
  const cloneWithSnapshot = attachLocalVersionSnapshot(clone);
  await setDoc(doc(db, 'evalDatasets', clone.id), sanitizeDatasetValue(cloneWithSnapshot));
  return cloneWithSnapshot;
}

export async function saveDataset(
  dataset: EvalDataset,
  options: { expectedVersion?: number; forcePropagation?: boolean; deferPropagation?: boolean } = {}
) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset; syncSummary?: DatasetSyncSummary }>(`/api/datasets/${dataset.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        dataset: sanitizeDatasetValue(dataset),
        expectedVersion: options.expectedVersion,
        forcePropagation: options.forcePropagation,
        deferPropagation: options.deferPropagation,
      }),
    });
    notifyDatasetReloaders();
    return response.dataset;
  }

  const ref = doc(db, 'evalDatasets', dataset.id);
  const existingSnap = await getDoc(ref);
  const existing = existingSnap.exists ? existingSnap.data() as EvalDataset : undefined;
  if (options.expectedVersion !== undefined && existing?.version !== options.expectedVersion) {
    const error = new Error('评测集已被其他人更新，请刷新后重试。') as Error & { status?: number; code?: string };
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
  const normalizedDataset = {
    ...dataset,
    items: ensureStableDatasetItemIds(dataset.id, dataset.items || []),
  };
  const shouldPropagate = !options.deferPropagation && Boolean(existing) && (
    options.forcePropagation || (normalizedDataset.version || 1) > (existing?.version || 0)
  );
  const syncSummary = shouldPropagate && existing
    ? await propagateLocalDatasetVersion(existing, normalizedDataset)
    : normalizedDataset.syncSummary;
  const datasetWithSnapshot = attachLocalVersionSnapshot({ ...normalizedDataset, syncSummary }, existing);
  await setDoc(ref, sanitizeDatasetValue(datasetWithSnapshot));
  return datasetWithSnapshot;
}

export async function loadDatasetVersion(datasetId: string, version: number) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset }>(`/api/datasets/${datasetId}/versions/${version}`);
    return response.dataset;
  }

  const snap = await getDoc(doc(db, 'evalDatasets', datasetId));
  if (!snap.exists) {
    throw new Error('评测集不存在');
  }
  const dataset = snap.data() as EvalDataset;
  const snapshot = dataset.versionSnapshots?.[String(version)];
  if (!snapshot) {
    throw new Error('这个历史版本没有可回退的本地快照');
  }
  return datasetFromSnapshot(dataset, snapshot);
}

export async function rollbackDataset(datasetId: string, version: number, changeSummary?: string, expectedVersion?: number) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset }>(`/api/datasets/${datasetId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version, changeSummary, expectedVersion }),
    });
    notifyDatasetReloaders();
    return response.dataset;
  }

  const snap = await getDoc(doc(db, 'evalDatasets', datasetId));
  if (!snap.exists) {
    throw new Error('评测集不存在');
  }
  const dataset = snap.data() as EvalDataset;
  if (expectedVersion !== undefined && dataset.version !== expectedVersion) {
    const error = new Error('评测集已被其他人更新，请刷新后重试。') as Error & { status?: number; code?: string };
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
  const snapshot = dataset.versionSnapshots?.[String(version)];
  if (!snapshot) {
    throw new Error('这个历史版本没有可回退的本地快照');
  }
  const history = dataset.versionHistory || [];
  const now = Date.now();
  const nextVersion = Math.max(dataset.version || 0, version, ...history.map(entry => entry.version)) + 1;
  const summary = changeSummary || `从 v${version} 回退生成新版本`;
  const rolledBackDataset: EvalDataset = {
    ...datasetFromSnapshot(dataset, snapshot),
    version: nextVersion,
    versionHistory: [
      ...history,
      {
        version: nextVersion,
        changedAt: now,
        changedBy: 'Local',
        changeSummary: summary,
        itemCountBefore: dataset.items?.length || 0,
        itemCountAfter: snapshot.items?.length || 0,
      },
    ],
    updatedAt: now,
  };
  const syncSummary = await propagateLocalDatasetVersion(dataset, rolledBackDataset);
  const nextDataset = attachLocalVersionSnapshot({ ...rolledBackDataset, syncSummary }, dataset);
  await setDoc(doc(db, 'evalDatasets', datasetId), sanitizeDatasetValue(nextDataset));
  return nextDataset;
}

export async function updateDatasetItem(
  dataset: EvalDataset,
  stableItemId: string,
  fieldKey: string,
  value: unknown
) {
  if (!fieldKey.trim() || fieldKey === '_originalData' || fieldKey.startsWith('__')) {
    throw new Error('这个字段不可编辑');
  }
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset; syncSummary?: DatasetSyncSummary }>(
      `/api/datasets/${dataset.id}/items/${encodeURIComponent(stableItemId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ fieldKey, value: sanitizeDatasetValue(value), expectedVersion: dataset.version || 1 }),
      }
    );
    notifyDatasetReloaders();
    return response.dataset;
  }

  const rowIndex = dataset.items.findIndex(row => row.__datasetItemId === stableItemId);
  if (rowIndex < 0) throw new Error('评测集 case 不存在');
  const now = Date.now();
  const version = (dataset.version || 0) + 1;
  const row = dataset.items[rowIndex];
  const nextRow = { ...row, [fieldKey]: value };
  const schemaField = dataset.inputSchema.find(field => field.key === fieldKey);
  if (nextRow._originalData && schemaField?.sourceKey) {
    nextRow._originalData = { ...nextRow._originalData, [schemaField.sourceKey]: value };
  }
  const items = dataset.items.map((item, index) => index === rowIndex ? nextRow : item);
  const preciseSummary = `修改 ${row['用例ID'] || row.case_id || row.id || `case-${rowIndex + 1}`} / ${fieldKey}：${summarizeDatasetChangeValue(row[fieldKey])} -> ${summarizeDatasetChangeValue(value)}`;
  return saveDataset({
    ...dataset,
    items,
    version,
    versionHistory: [...(dataset.versionHistory || []), {
      version,
      changedAt: now,
      changedBy: 'Local',
      changeSummary: preciseSummary,
      itemCountBefore: dataset.items.length,
      itemCountAfter: items.length,
    }],
    datasetCard: dataset.datasetCard ? { ...dataset.datasetCard, latestChange: preciseSummary, updatedAt: now } : dataset.datasetCard,
    updatedAt: now,
  }, { expectedVersion: dataset.version || 1 });
}

export async function updateDatasetManifest(dataset: EvalDataset, patch: Partial<EvalDataset>) {
  const allowedPatch: Partial<EvalDataset> = {};
  (['name', 'description', 'tags', 'modality', 'categoryPath'] as const).forEach(key => {
    if (patch[key] !== undefined) (allowedPatch as any)[key] = patch[key];
  });
  if (patch.datasetCard) {
    const editableDatasetCardPatch: Partial<NonNullable<EvalDataset['datasetCard']>> = {};
    (['source', 'applicableTasks', 'applicableStages', 'rubricBinding', 'coverageGaps'] as const).forEach(key => {
      if (patch.datasetCard?.[key] !== undefined) (editableDatasetCardPatch as any)[key] = patch.datasetCard[key];
    });
    if (Object.keys(editableDatasetCardPatch).length) allowedPatch.datasetCard = editableDatasetCardPatch as EvalDataset['datasetCard'];
  }
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset; syncSummary?: DatasetSyncSummary }>(
      `/api/datasets/${dataset.id}/manifest`,
      {
        method: 'PATCH',
        body: JSON.stringify({ patch: sanitizeDatasetValue(allowedPatch), expectedVersion: dataset.version || 1 }),
      }
    );
    notifyDatasetReloaders();
    return response.dataset;
  }
  const now = Date.now();
  const version = (dataset.version || 0) + 1;
  const changes: string[] = [];
  Object.entries(allowedPatch).forEach(([key, value]) => {
    if (key === 'datasetCard' || JSON.stringify((dataset as any)[key]) === JSON.stringify(value)) return;
    changes.push(`${key}: ${summarizeDatasetChangeValue((dataset as any)[key])} -> ${summarizeDatasetChangeValue(value)}`);
  });
  Object.entries(allowedPatch.datasetCard || {}).forEach(([key, value]) => {
    const previousValue = (dataset.datasetCard as any)?.[key];
    if (JSON.stringify(previousValue) === JSON.stringify(value)) return;
    changes.push(`Dataset Card.${key}: ${summarizeDatasetChangeValue(previousValue)} -> ${summarizeDatasetChangeValue(value)}`);
  });
  if (!changes.length) return dataset;
  const preciseSummary = `修改评测集资料：${changes.join('；')}`;
  return saveDataset({
    ...dataset,
    ...allowedPatch,
    datasetCard: allowedPatch.datasetCard ? { ...dataset.datasetCard, ...allowedPatch.datasetCard, latestChange: preciseSummary, updatedAt: now } as any : dataset.datasetCard,
    version,
    versionHistory: [...(dataset.versionHistory || []), {
      version,
      changedAt: now,
      changedBy: 'Local',
      changeSummary: preciseSummary,
      itemCountBefore: dataset.items.length,
      itemCountAfter: dataset.items.length,
    }],
    updatedAt: now,
  }, { expectedVersion: dataset.version || 1 });
}

export async function deleteDataset(datasetId: string) {
  if (USE_SHARED_DATA_SOURCE) {
    await requestJson<void>(`/api/datasets/${datasetId}`, {
      method: 'DELETE',
    });
    notifyDatasetReloaders();
    return;
  }

  await deleteDoc(doc(db, 'evalDatasets', datasetId));
}
