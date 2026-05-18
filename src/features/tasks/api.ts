import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from '../../datastore';
import { db } from '../../firebase';
import { EvalTask, EvaluationItem, VoteRecord } from '../../types';
import { loadTaskEvaluation } from './loadTaskEvaluation';
import { loadTaskItems } from './loadTaskItems';

export { loadTaskEvaluation, loadTaskItems };

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
export const USE_TASK_API_BACKEND = import.meta.env.VITE_USE_API_BACKEND === 'true' && Boolean(API_BASE_URL);
const HTTP_REFRESH_INTERVAL_MS = 5000;

const taskReloaders = new Set<() => void>();

export async function requestTaskJson<T>(path: string, init?: RequestInit): Promise<T> {
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

function notifyTaskReloaders() {
  taskReloaders.forEach(reload => reload());
}

export async function loadTask(taskId: string) {
  const response = await requestTaskJson<{ task: EvalTask }>(`/api/tasks/${taskId}`);
  return response.task;
}

export async function loadHttpTaskItems(taskId: string) {
  const response = await requestTaskJson<{ items: EvaluationItem[] }>(`/api/tasks/${taskId}/items`);
  return response.items;
}

export async function loadTaskUserVotes(taskId: string, userName: string) {
  if (!USE_TASK_API_BACKEND) return [];
  const response = await requestTaskJson<{ votes: VoteRecord[] }>(
    `/api/tasks/${taskId}/votes/${encodeURIComponent(userName)}`
  );
  return response.votes;
}

export async function loadTaskVotes(taskId: string) {
  if (!USE_TASK_API_BACKEND) return [];
  const response = await requestTaskJson<{ userVotes: Array<{ user: string; votes: VoteRecord[] }> }>(
    `/api/tasks/${taskId}/votes`
  );
  return response.userVotes;
}

export async function saveTaskUserVotes(taskId: string, userName: string, votes: VoteRecord[], progress: number) {
  if (USE_TASK_API_BACKEND) {
    const response = await requestTaskJson<{ votes: VoteRecord[] }>(
      `/api/tasks/${taskId}/votes/${encodeURIComponent(userName)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ votes, progress }),
      }
    );
    notifyTaskReloaders();
    return response.votes;
  }

  return null;
}

export function subscribeTasks(
  params: { projectId?: string },
  onNext: (tasks: EvalTask[]) => void,
  onError?: (error: unknown) => void
) {
  if (USE_TASK_API_BACKEND) {
    let active = true;
    const reload = () => {
      const queryString = params.projectId ? `?projectId=${encodeURIComponent(params.projectId)}` : '';
      requestTaskJson<{ tasks: EvalTask[] }>(`/api/tasks${queryString}`)
        .then(response => {
          if (active) onNext(response.tasks);
        })
        .catch(error => {
          if (active) onError?.(error);
        });
    };
    taskReloaders.add(reload);
    reload();
    const intervalId = window.setInterval(reload, HTTP_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      taskReloaders.delete(reload);
    };
  }

  const tasksRef = collection(db, 'evalTasks');
  const tasksQuery = params.projectId
    ? query(tasksRef, where('projectId', '==', params.projectId))
    : query(tasksRef);

  return onSnapshot(tasksQuery, (snapshot: any) => {
    const tasks: EvalTask[] = [];
    snapshot.forEach((docSnap: any) => {
      tasks.push({ id: docSnap.id, ...docSnap.data() } as EvalTask);
    });
    tasks.sort((a, b) => b.createdAt - a.createdAt);
    onNext(tasks);
  }, onError);
}

export async function createTaskWithItems(task: Omit<EvalTask, 'id'> & Partial<Pick<EvalTask, 'id'>>, items: EvaluationItem[]) {
  if (USE_TASK_API_BACKEND) {
    const response = await requestTaskJson<{ task: EvalTask }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ task, items }),
    });
    notifyTaskReloaders();
    return response.task;
  }

  const taskRef = await addDoc(collection(db, 'evalTasks'), task);
  const itemsRef = collection(db, 'evalTasks', taskRef.id, 'items');
  for (const item of items) {
    await addDoc(itemsRef, item);
  }
  return { id: taskRef.id, ...task } as EvalTask;
}

export async function updateTask(taskId: string, patch: Partial<EvalTask>) {
  if (USE_TASK_API_BACKEND) {
    const response = await requestTaskJson<{ task: EvalTask }>(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
    });
    notifyTaskReloaders();
    return response.task;
  }

  await updateDoc(doc(db, 'evalTasks', taskId), patch);
}

export async function updateTaskItem(taskId: string, itemId: string, patch: Partial<EvaluationItem>) {
  if (USE_TASK_API_BACKEND) {
    const response = await requestTaskJson<{ item: EvaluationItem }>(`/api/tasks/${taskId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
    });
    return response.item;
  }

  await updateDoc(doc(db, 'evalTasks', taskId, 'items', itemId), patch);
}

export async function deleteTask(taskId: string) {
  if (USE_TASK_API_BACKEND) {
    await requestTaskJson<void>(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
    notifyTaskReloaders();
    return;
  }

  await deleteDoc(doc(db, 'evalTasks', taskId));
}
