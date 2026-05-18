import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from '../../datastore';
import { db } from '../../firebase';
import { EvalDataset } from '../../types';

const sanitizeDatasetValue = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(item => item === undefined ? null : sanitizeDatasetValue(item));
  }
  if (typeof value === 'object') {
    const next: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
      const sanitized = sanitizeDatasetValue(item);
      if (sanitized !== undefined) next[key] = sanitized;
    });
    return next;
  }
  return value;
};

export function subscribeDatasets(
  onNext: (datasets: EvalDataset[]) => void,
  onError?: (error: unknown) => void
) {
  const datasetsQuery = query(collection(db, 'evalDatasets'), orderBy('createdAt', 'desc'));
  return onSnapshot(datasetsQuery, (snapshot: any) => {
    const datasets: EvalDataset[] = [];
    snapshot.forEach((docSnap: any) => {
      datasets.push({ id: docSnap.id, ...docSnap.data() } as EvalDataset);
    });
    onNext(datasets);
  }, onError);
}

export async function createDataset(dataset: Omit<EvalDataset, 'id'> & Partial<Pick<EvalDataset, 'id'>>) {
  const ref = await addDoc(collection(db, 'evalDatasets'), sanitizeDatasetValue(dataset));
  return ref.id as string;
}

export async function saveDataset(dataset: EvalDataset) {
  await setDoc(doc(db, 'evalDatasets', dataset.id), sanitizeDatasetValue(dataset));
  return dataset;
}

export async function deleteDataset(datasetId: string) {
  await deleteDoc(doc(db, 'evalDatasets', datasetId));
}
