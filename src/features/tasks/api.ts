import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from '../../datastore';
import { db } from '../../auth';
import { EvalTask, EvaluationItem, TaskVoteGroup, VoteRecord } from '../../types';
import { getApiAuthHeaders } from '../apiAuthHeaders';
import { loadTaskEvaluation, loadTaskVoteGroups } from './loadTaskEvaluation';
import { loadTaskItems } from './loadTaskItems';
import { API_BASE_URL, USE_SHARED_DATA_SOURCE } from '../../runtimeConfig';

export { loadTaskEvaluation, loadTaskItems, loadTaskVoteGroups };

export const USE_TASK_API_BACKEND = USE_SHARED_DATA_SOURCE;
const HTTP_REFRESH_INTERVAL_MS = 5000;

const taskReloaders = new Set<() => void>();

const snapshotExists = (snapshot: any) => {
  if (!snapshot) return false;
  return typeof snapshot.exists === 'function' ? snapshot.exists() : !!snapshot.exists;
};

async function resolveLocalTaskItemDocId(taskId: string, itemId: string) {
  const directSnap = await getDoc(doc(db, 'evalTasks', taskId, 'items', itemId));
  if (snapshotExists(directSnap)) return itemId;

  const itemsSnapshot = await getDocs(collection(db, 'evalTasks', taskId, 'items'));
  const matchedDoc = itemsSnapshot.docs.find((docSnap: any) => {
    const data = docSnap.data?.() || {};
    return docSnap.id === itemId || data.id === itemId;
  });
  if (matchedDoc) return matchedDoc.id;

  throw new Error(`Task item not found: ${itemId}`);
}

async function syncLocalTaskProgressAfterItemDelete(taskId: string) {
  const remainingItemsSnapshot = await getDocs(collection(db, 'evalTasks', taskId, 'items'));
  const remainingItemIds = new Set<string>();
  remainingItemsSnapshot.docs.forEach((docSnap: any) => {
    const data = docSnap.data?.() || {};
    remainingItemIds.add(docSnap.id);
    if (data.id) remainingItemIds.add(data.id);
  });

  const progress: Record<string, number> = {};
  const votesSnapshot = await getDocs(collection(db, 'evalTasks', taskId, 'userVotes'));
  for (const docSnap of votesSnapshot.docs as any[]) {
    const data = docSnap.data?.() || {};
    const filteredVotes = (data.votes || []).filter((vote: VoteRecord) => remainingItemIds.has(vote.itemId));
    progress[docSnap.id] = filteredVotes.length;
    await setDoc(doc(db, 'evalTasks', taskId, 'userVotes', docSnap.id), { ...data, votes: filteredVotes }, { merge: true });
  }

  await setDoc(doc(db, 'evalTasks', taskId), {
    hasTaskItemEdits: true,
    totalItems: remainingItemsSnapshot.docs.length,
    progress,
  }, { merge: true });
}

export async function requestTaskJson<T>(path: string, init?: RequestInit): Promise<T> {
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

export async function loadMyTaskVotes(taskId: string) {
  if (!USE_TASK_API_BACKEND) return [];
  const response = await requestTaskJson<{ votes: VoteRecord[] }>(`/api/tasks/${taskId}/my-votes`);
  return response.votes;
}

export async function loadTaskVotes(taskId: string) {
  if (!USE_TASK_API_BACKEND) return loadTaskVoteGroups(taskId);
  const response = await requestTaskJson<{ userVotes: TaskVoteGroup[] }>(
    `/api/tasks/${taskId}/votes`
  );
  return response.userVotes as TaskVoteGroup[];
}

export async function saveMyTaskVotes(taskId: string, votes: VoteRecord[], progress: number) {
  if (USE_TASK_API_BACKEND) {
    const response = await requestTaskJson<{ votes: VoteRecord[] }>(
      `/api/tasks/${taskId}/my-votes`,
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

export async function saveTaskUserVotes(taskId: string, userName: string, votes: VoteRecord[], progress: number) {
  if (USE_TASK_API_BACKEND) {
    return saveMyTaskVotes(taskId, votes, progress);
  }

  const itemsSnapshot = await getDocs(collection(db, 'evalTasks', taskId, 'items'));
  let activeItemIds = new Set(itemsSnapshot.docs
    .filter((itemDoc: any) => !itemDoc.data()?.archivedAt)
    .flatMap((itemDoc: any) => [itemDoc.id, itemDoc.data()?.id].filter(Boolean)));
  if (!itemsSnapshot.docs.length) {
    const taskSnapshot = await getDoc(doc(db, 'evalTasks', taskId));
    if (snapshotExists(taskSnapshot)) {
      const task = { id: taskId, ...taskSnapshot.data() } as EvalTask;
      activeItemIds = new Set((await loadTaskItems(task)).map(item => item.id));
    }
  }
  const unavailableItemIds = votes.map(vote => vote.itemId).filter(itemId => !activeItemIds.has(itemId));
  if (unavailableItemIds.length) {
    throw new Error('部分评测 case 已更新或归档，请刷新任务后重新提交。');
  }

  const taskSnapshot = await getDoc(doc(db, 'evalTasks', taskId));
  const taskData = snapshotExists(taskSnapshot) ? taskSnapshot.data() as EvalTask : undefined;
  await setDoc(doc(db, 'evalTasks', taskId), {
    progress: { ...(taskData?.progress || {}), [userName]: progress },
  }, { merge: true });
  await setDoc(doc(db, 'evalTasks', taskId, 'userVotes', userName), { votes }, { merge: true });
  return votes;
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

  const docId = await resolveLocalTaskItemDocId(taskId, itemId);
  await updateDoc(doc(db, 'evalTasks', taskId, 'items', docId), patch);
}

export async function deleteTaskItem(taskId: string, itemId: string) {
  if (USE_TASK_API_BACKEND) {
    await requestTaskJson<void>(`/api/tasks/${taskId}/items/${itemId}`, {
      method: 'DELETE',
    });
    notifyTaskReloaders();
    return;
  }

  const docId = await resolveLocalTaskItemDocId(taskId, itemId);
  await deleteDoc(doc(db, 'evalTasks', taskId, 'items', docId));
  await syncLocalTaskProgressAfterItemDelete(taskId);
  notifyTaskReloaders();
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
