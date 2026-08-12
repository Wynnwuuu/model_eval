import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from '../../datastore';
import { db } from '../../auth';
import { EvaluationProject } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';
import { notifyPageMetadataRefresh } from '../../pageMetadataClient';

const HTTP_REFRESH_INTERVAL_MS = 5000;

const projectReloaders = new Set<() => void>();

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

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function loadHttpProjects() {
  const response = await requestJson<{ projects: EvaluationProject[] }>('/api/projects');
  return response.projects;
}

function notifyProjectReloaders() {
  projectReloaders.forEach(reload => reload());
  notifyPageMetadataRefresh();
}

export function subscribeProjects(
  onNext: (projects: EvaluationProject[]) => void,
  onError?: (error: unknown) => void
) {
  if (USE_SHARED_DATA_SOURCE) {
    let active = true;
    const reload = () => {
      loadHttpProjects()
        .then(projects => {
          if (active) onNext(projects);
        })
        .catch(error => {
          if (active) onError?.(error);
        });
    };
    projectReloaders.add(reload);
    reload();
    const intervalId = window.setInterval(reload, HTTP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      projectReloaders.delete(reload);
    };
  }

  const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
  return onSnapshot(projectsQuery, (snapshot: any) => {
    const projects: EvaluationProject[] = [];
    snapshot.forEach((docSnap: any) => {
      projects.push({ id: docSnap.id, ...(docSnap.data() as EvaluationProject) });
    });
    onNext(projects);
  }, onError);
}

export async function createProject(project: Partial<EvaluationProject>, user: any) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ project: EvaluationProject }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        project,
        user: {
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
        },
      }),
    });
    notifyProjectReloaders();
    return response.project;
  }

  const cleanProject = JSON.parse(JSON.stringify(project));
  return addDoc(collection(db, 'projects'), {
    ...cleanProject,
    initiatorUid: user.uid,
    initiatorName: user.displayName || user.email || 'Anonymous',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  });
}

export async function updateProject(projectId: string, patch: Partial<EvaluationProject>) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ project: EvaluationProject }>(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
    });
    notifyProjectReloaders();
    return response.project;
  }

  await updateDoc(doc(db, 'projects', projectId), patch);
}

export async function updateProjectSteps(projectId: string, steps: EvaluationProject['steps'], progress: number) {
  const cleanSteps = JSON.parse(JSON.stringify(steps));
  await updateProject(projectId, {
    steps: cleanSteps,
    progress,
    lastUpdated: Date.now()
  });
}

export async function deleteProject(projectId: string) {
  if (USE_SHARED_DATA_SOURCE) {
    await requestJson<void>(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    notifyProjectReloaders();
    return;
  }

  await deleteDoc(doc(db, 'projects', projectId));
}
