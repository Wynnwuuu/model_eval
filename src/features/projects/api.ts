import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from '../../datastore';
import { db } from '../../auth';
import { EvaluationProject } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';
import { notifyPageMetadataRefresh } from '../../pageMetadataClient';
import { normalizeEvaluationProject, normalizeEvaluationProjects } from './projectContract';
import { createSingleFlightLoader, startNonOverlappingPolling } from '../../httpPolling';

const HTTP_REFRESH_INTERVAL_MS = 5000;

const projectReloaders = new Set<() => void>();

class ProjectApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ProjectApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

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
    throw new ProjectApiError(
      errorBody.error?.message || errorBody.error || `Request failed: ${response.status}`,
      response.status,
      errorBody.error?.code,
      errorBody.error?.details,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function loadHttpProjects() {
  const response = await requestJson<{ projects: EvaluationProject[] }>('/api/projects');
  return normalizeEvaluationProjects(response.projects);
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
    const reload = createSingleFlightLoader(async () => {
      try {
        const projects = await loadHttpProjects();
        if (active) onNext(projects);
      } catch (error) {
        if (active) onError?.(error);
      }
    });
    projectReloaders.add(reload);
    const stopPolling = startNonOverlappingPolling(reload, HTTP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      stopPolling();
      projectReloaders.delete(reload);
    };
  }

  const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
  return onSnapshot(projectsQuery, (snapshot: any) => {
    const projects: EvaluationProject[] = [];
    snapshot.forEach((docSnap: any) => {
      projects.push(normalizeEvaluationProject({ ...(docSnap.data() || {}), id: docSnap.id }, docSnap.id));
    });
    onNext(projects);
  }, onError);
}

export async function getProject(projectId: string, signal?: AbortSignal): Promise<EvaluationProject | null> {
  if (USE_SHARED_DATA_SOURCE) {
    try {
      const response = await requestJson<{ project: EvaluationProject }>(`/api/projects/${encodeURIComponent(projectId)}`, { signal });
      return normalizeEvaluationProject(response.project, projectId);
    } catch (error) {
      if (error instanceof ProjectApiError && error.status === 404) return null;
      throw error;
    }
  }

  const snapshot = await getDoc(doc(db, 'projects', projectId));
  return snapshot.exists
    ? normalizeEvaluationProject({ ...(snapshot.data() || {}), id: snapshot.id }, snapshot.id)
    : null;
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
    return normalizeEvaluationProject(response.project);
  }

  const cleanProject = JSON.parse(JSON.stringify(project));
  const storedProject = {
    ...cleanProject,
    initiatorUid: user.uid,
    initiatorName: user.displayName || user.email || 'Anonymous',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  };
  const createdRef = await addDoc(collection(db, 'projects'), storedProject);
  return normalizeEvaluationProject({ ...storedProject, id: createdRef.id }, createdRef.id);
}

export async function updateProject(projectId: string, patch: Partial<EvaluationProject>) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ project: EvaluationProject }>(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
    });
    notifyProjectReloaders();
    return normalizeEvaluationProject(response.project, projectId);
  }

  await updateDoc(doc(db, 'projects', projectId), patch);
  return getProject(projectId);
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
