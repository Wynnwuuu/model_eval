import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc } from '../../datastore';
import { db } from '../../auth';
import { DatasetVersionSnapshot, EvalDataset } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';

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
    throw new Error(errorBody.error?.message || errorBody.error || `Request failed: ${response.status}`);
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

const toVersionSnapshot = (dataset: EvalDataset): DatasetVersionSnapshot => ({
  version: dataset.version || 1,
  inputSchema: dataset.inputSchema || [],
  items: dataset.items || [],
  inputType: dataset.inputType,
  modality: dataset.modality,
  categoryPath: dataset.categoryPath || [],
  columnMappings: dataset.columnMappings,
  datasetCard: dataset.datasetCard,
  validationSummary: dataset.validationSummary,
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
  inputSchema: snapshot.inputSchema || [],
  items: snapshot.items || [],
  inputType: snapshot.inputType || dataset.inputType,
  modality: snapshot.modality || dataset.modality,
  categoryPath: snapshot.categoryPath || dataset.categoryPath || [],
  columnMappings: snapshot.columnMappings,
  datasetCard: snapshot.datasetCard || dataset.datasetCard,
  validationSummary: snapshot.validationSummary,
  version: snapshot.version,
  updatedAt: snapshot.updatedAt || dataset.updatedAt,
});

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
      datasets.push({ id: docSnap.id, ...docSnap.data() } as EvalDataset);
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

  const datasetWithSnapshot = attachLocalVersionSnapshot(dataset as EvalDataset);
  const ref = await addDoc(collection(db, 'evalDatasets'), sanitizeDatasetValue(datasetWithSnapshot));
  return ref.id as string;
}

export async function saveDataset(dataset: EvalDataset) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset }>(`/api/datasets/${dataset.id}`, {
      method: 'PUT',
      body: JSON.stringify({ dataset: sanitizeDatasetValue(dataset) }),
    });
    notifyDatasetReloaders();
    return response.dataset;
  }

  const ref = doc(db, 'evalDatasets', dataset.id);
  const existingSnap = await getDoc(ref);
  const existing = existingSnap.exists ? existingSnap.data() as EvalDataset : undefined;
  const datasetWithSnapshot = attachLocalVersionSnapshot(dataset, existing);
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

export async function rollbackDataset(datasetId: string, version: number, changeSummary?: string) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ dataset: EvalDataset }>(`/api/datasets/${datasetId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version, changeSummary }),
    });
    notifyDatasetReloaders();
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
  const history = dataset.versionHistory || [];
  const now = Date.now();
  const nextVersion = Math.max(dataset.version || 0, version, ...history.map(entry => entry.version)) + 1;
  const summary = changeSummary || `从 v${version} 回退生成新版本`;
  const nextDataset = attachLocalVersionSnapshot({
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
    ].slice(-30),
    updatedAt: now,
  }, dataset);
  await setDoc(doc(db, 'evalDatasets', datasetId), sanitizeDatasetValue(nextDataset));
  return nextDataset;
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
