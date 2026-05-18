import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from '../../datastore';
import { db } from '../../firebase';
import { EvalTemplate } from '../../types';

export function subscribeTemplates(
  onNext: (templates: EvalTemplate[]) => void,
  onError?: (error: unknown) => void
) {
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
  await setDoc(doc(db, 'evalTemplates', template.id), template);
  return template;
}

export async function deleteTemplate(templateId: string) {
  await deleteDoc(doc(db, 'evalTemplates', templateId));
}
