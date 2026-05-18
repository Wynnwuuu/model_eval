/**
 * Local fallback persistence for demo/offline mode.
 * Standard collaboration data should use feature APIs backed by HTTP/PostgreSQL.
 */
export {
  addDoc,
  collection,
  deleteDoc,
  doc,
  FieldPath,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from './localPlatform';
