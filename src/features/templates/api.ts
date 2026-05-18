import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from '../../datastore';
import { db } from '../../firebase';
import { EvalTemplate } from '../../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const USE_API_BACKEND = import.meta.env.VITE_USE_API_BACKEND === 'true' && Boolean(API_BASE_URL);
const HTTP_REFRESH_INTERVAL_MS = 5000;

const templateReloaders = new Set<() => void>();

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
}

export function subscribeTemplates(
  onNext: (templates: EvalTemplate[]) => void,
  onError?: (error: unknown) => void
) {
  if (USE_API_BACKEND) {
    let active = true;
    const reload = () => {
      loadHttpTemplates()
        .then(templates => {
          if (active) onNext(templates);
        })
        .catch(error => {
          if (active) onError?.(error);
        });
    };
    templateReloaders.add(reload);
    reload();
    const intervalId = window.setInterval(reload, HTTP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
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
  if (USE_API_BACKEND) {
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
  if (USE_API_BACKEND) {
    await requestJson<void>(`/api/templates/${templateId}`, {
      method: 'DELETE',
    });
    notifyTemplateReloaders();
    return;
  }

  await deleteDoc(doc(db, 'evalTemplates', templateId));
}
