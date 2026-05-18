import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from '../../datastore';
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

export async function createProject(project: Partial<EvaluationProject>, user: any) {
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
  await deleteDoc(doc(db, 'projects', projectId));
}
