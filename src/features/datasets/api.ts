import { collection, onSnapshot, orderBy, query } from '../../datastore';
import { db } from '../../firebase';
import { EvalDataset } from '../../types';

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
