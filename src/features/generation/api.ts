import { collection, doc, onSnapshot, orderBy, query, setDoc, where } from '../../datastore';
import { db } from '../../auth';
import { DatasetGenerationJob, DatasetGenerationJobItem } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';
import { notifyPageMetadataRefresh } from '../../pageMetadataClient';

const HTTP_REFRESH_INTERVAL_MS = 5000;

const reloaders = new Set<() => void>();

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
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

function notifyReloaders() {
  reloaders.forEach(reload => reload());
  notifyPageMetadataRefresh();
}

export function subscribeGenerationJobs(
  params: { datasetId?: string } = {},
  onNext: (jobs: DatasetGenerationJob[]) => void,
  onError?: (error: unknown) => void
) {
  if (USE_SHARED_DATA_SOURCE) {
    let active = true;
    const reload = () => {
      const queryString = params.datasetId ? `?datasetId=${encodeURIComponent(params.datasetId)}` : '';
      requestJson<{ jobs: DatasetGenerationJob[] }>(`/api/generation/jobs${queryString}`)
        .then(response => {
          if (active) onNext(response.jobs);
        })
        .catch(error => {
          if (active) onError?.(error);
        });
    };
    reloaders.add(reload);
    reload();
    const intervalId = window.setInterval(reload, HTTP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      reloaders.delete(reload);
    };
  }

  const jobsQuery = params.datasetId
    ? query(collection(db, 'evalGenerationJobs'), where('datasetId', '==', params.datasetId))
    : query(collection(db, 'evalGenerationJobs'), orderBy('createdAt', 'desc'));
  return onSnapshot(jobsQuery, (snapshot) => {
    const jobs: DatasetGenerationJob[] = [];
    snapshot.forEach((docSnap) => {
      jobs.push({ id: docSnap.id, ...docSnap.data() } as DatasetGenerationJob);
    });
    onNext(jobs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }, onError);
}

export async function saveGenerationJob(job: DatasetGenerationJob) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ job: DatasetGenerationJob }>(`/api/generation/jobs/${job.id}`, {
      method: 'PUT',
      body: JSON.stringify({ job }),
    });
    notifyReloaders();
    return response.job;
  }

  await setDoc(doc(db, 'evalGenerationJobs', job.id), job);
  return job;
}

export async function saveGenerationJobItem(item: DatasetGenerationJobItem) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ item: DatasetGenerationJobItem }>(
      `/api/generation/jobs/${item.jobId}/items/${item.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({ item }),
      }
    );
    return response.item;
  }

  await setDoc(doc(collection(db, 'evalGenerationJobs', item.jobId, 'items'), item.id), item);
  return item;
}
