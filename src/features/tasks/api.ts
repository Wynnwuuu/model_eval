import { collection, onSnapshot, query, where } from '../../datastore';
import { db } from '../../firebase';
import { EvalTask } from '../../types';
import { loadTaskEvaluation } from './loadTaskEvaluation';
import { loadTaskItems } from './loadTaskItems';

export { loadTaskEvaluation, loadTaskItems };

export function subscribeTasks(
  params: { projectId?: string },
  onNext: (tasks: EvalTask[]) => void,
  onError?: (error: unknown) => void
) {
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
