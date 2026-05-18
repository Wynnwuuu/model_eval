import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from '../../datastore';
import { db } from '../../firebase';
import { EvalDataset } from '../../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const USE_API_BACKEND = import.meta.env.VITE_USE_API_BACKEND === 'true' && Boolean(API_BASE_URL);
const HTTP_REFRESH_INTERVAL_MS = 5000;

const datasetReloaders = new Set<() => void>();

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `Request failed: ${response.status}`);
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

export function subscribeDatasets(
  onNext: (datasets: EvalDataset[]) => void,
  onError?: (error: unknown) => void
) {
  if (USE_API_BACKEND) {
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
  if (USE_API_BACKEND) {
    const response = await requestJson<{ dataset: EvalDataset }>('/api/datasets', {
      method: 'POST',
      body: JSON.stringify({ dataset: sanitizeDatasetValue(dataset) }),
    });
    notifyDatasetReloaders();
    return response.dataset.id;
  }

  const ref = await addDoc(collection(db, 'evalDatasets'), sanitizeDatasetValue(dataset));
  return ref.id as string;
}

export async function saveDataset(dataset: EvalDataset) {
  if (USE_API_BACKEND) {
    const response = await requestJson<{ dataset: EvalDataset }>(`/api/datasets/${dataset.id}`, {
      method: 'PUT',
      body: JSON.stringify({ dataset: sanitizeDatasetValue(dataset) }),
    });
    notifyDatasetReloaders();
    return response.dataset;
  }

  await setDoc(doc(db, 'evalDatasets', dataset.id), sanitizeDatasetValue(dataset));
  return dataset;
}

export async function deleteDataset(datasetId: string) {
  if (USE_API_BACKEND) {
    await requestJson<void>(`/api/datasets/${datasetId}`, {
      method: 'DELETE',
    });
    notifyDatasetReloaders();
    return;
  }

  await deleteDoc(doc(db, 'evalDatasets', datasetId));
}
