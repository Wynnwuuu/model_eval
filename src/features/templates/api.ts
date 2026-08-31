import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from '../../datastore';
import { db } from '../../auth';
import { EvalTemplate } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';
import { notifyPageMetadataRefresh } from '../../pageMetadataClient';
import { createSingleFlightLoader, startNonOverlappingPolling } from '../../httpPolling';

const HTTP_REFRESH_INTERVAL_MS = 5000;

const templateReloaders = new Set<() => void>();

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

async function loadHttpTemplates() {
  const response = await requestJson<{ templates: EvalTemplate[] }>('/api/templates');
  return response.templates;
}

function notifyTemplateReloaders() {
  templateReloaders.forEach(reload => reload());
  notifyPageMetadataRefresh();
}

export function subscribeTemplates(
  onNext: (templates: EvalTemplate[]) => void,
  onError?: (error: unknown) => void
) {
  if (USE_SHARED_DATA_SOURCE) {
    let active = true;
    const reload = createSingleFlightLoader(async () => {
      try {
        const templates = await loadHttpTemplates();
        if (active) onNext(templates);
      } catch (error) {
        if (active) onError?.(error);
      }
    });
    templateReloaders.add(reload);
    const stopPolling = startNonOverlappingPolling(reload, HTTP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      stopPolling();
      templateReloaders.delete(reload);
    };
  }

  const templatesQuery = query(collection(db, 'evalTemplates'), orderBy('createdAt', 'desc'));
  return onSnapshot(templatesQuery, (snapshot: any) => {
    const templates: EvalTemplate[] = [];
    snapshot.forEach((docSnap: any) => {
      templates.push({ id: docSnap.id, ...docSnap.data() } as EvalTemplate);
    });
    onNext(templates);
  }, onError);
}

export async function saveTemplate(template: EvalTemplate) {
  if (USE_SHARED_DATA_SOURCE) {
    const response = await requestJson<{ template: EvalTemplate }>(`/api/templates/${template.id}`, {
      method: 'PUT',
      body: JSON.stringify({ template }),
    });
    notifyTemplateReloaders();
    return response.template;
  }

  await setDoc(doc(db, 'evalTemplates', template.id), template);
  return template;
}

export async function deleteTemplate(templateId: string) {
  if (USE_SHARED_DATA_SOURCE) {
    await requestJson<void>(`/api/templates/${templateId}`, {
      method: 'DELETE',
    });
    notifyTemplateReloaders();
    return;
  }

  await deleteDoc(doc(db, 'evalTemplates', templateId));
}
