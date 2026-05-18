import { collection, onSnapshot, orderBy, query } from '../../datastore';
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
