import { collection, onSnapshot, orderBy, query } from '../../datastore';
import { db } from '../../firebase';
import { EvaluationProject } from '../../types';

export function subscribeProjects(
  onNext: (projects: EvaluationProject[]) => void,
  onError?: (error: unknown) => void
) {
  const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
  return onSnapshot(projectsQuery, (snapshot: any) => {
    const projects: EvaluationProject[] = [];
    snapshot.forEach((docSnap: any) => {
      projects.push({ id: docSnap.id, ...(docSnap.data() as EvaluationProject) });
    });
    onNext(projects);
  }, onError);
}
