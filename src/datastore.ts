/**
 * Single entry for persistence: real Firestore when `shouldUseFirebase`, else localStorage-backed localPlatform.
 * UI imports `db` from `./firebase` and all collection/doc APIs from here.
 */
import { shouldUseFirebase } from './firebase';
import {
  addDoc as fsAddDoc,
  collection as fsCollection,
  deleteDoc as fsDeleteDoc,
  doc as fsDoc,
  FieldPath as fsFieldPath,
  getDoc as fsGetDoc,
  getDocs as fsGetDocs,
  onSnapshot as fsOnSnapshot,
  orderBy as fsOrderBy,
  query as fsQuery,
  setDoc as fsSetDoc,
  updateDoc as fsUpdateDoc,
  where as fsWhere,
} from 'firebase/firestore';
import {
  addDoc as localAddDoc,
  collection as localCollection,
  deleteDoc as localDeleteDoc,
  doc as localDoc,
  FieldPath as localFieldPath,
  getDoc as localGetDoc,
  getDocs as localGetDocs,
  onSnapshot as localOnSnapshot,
  orderBy as localOrderBy,
  query as localQuery,
  setDoc as localSetDoc,
  updateDoc as localUpdateDoc,
  where as localWhere,
} from './localPlatform';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const sanitizeFirestorePayload = (value: any): any => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(item => item === undefined ? null : sanitizeFirestorePayload(item));
  }
  if (isPlainObject(value)) {
    const next: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
      const sanitized = sanitizeFirestorePayload(item);
      if (sanitized !== undefined) next[key] = sanitized;
    });
    return next;
  }
  return value;
};

const firebaseAddDoc = (ref: any, payload: any) =>
  fsAddDoc(ref, sanitizeFirestorePayload(payload));

const firebaseSetDoc = (ref: any, payload: any, options?: any) =>
  options ? fsSetDoc(ref, sanitizeFirestorePayload(payload), options) : fsSetDoc(ref, sanitizeFirestorePayload(payload));

const firebaseUpdateDoc = (ref: any, dataOrField: any, value?: any, ...rest: any[]) => {
  if (isPlainObject(dataOrField)) {
    return fsUpdateDoc(ref, sanitizeFirestorePayload(dataOrField));
  }
  return fsUpdateDoc(
    ref,
    dataOrField,
    value === undefined ? null : sanitizeFirestorePayload(value),
    ...rest.map(item => item === undefined ? null : sanitizeFirestorePayload(item))
  );
};

/* Local + Firebase implementations differ in TS types but share the same call patterns in this app. */
export const collection = (shouldUseFirebase ? fsCollection : localCollection) as any;
export const doc = (shouldUseFirebase ? fsDoc : localDoc) as any;
export const query = (shouldUseFirebase ? fsQuery : localQuery) as any;
export const where = (shouldUseFirebase ? fsWhere : localWhere) as any;
export const orderBy = (shouldUseFirebase ? fsOrderBy : localOrderBy) as any;
export const onSnapshot = (shouldUseFirebase ? fsOnSnapshot : localOnSnapshot) as any;
export const addDoc = (shouldUseFirebase ? firebaseAddDoc : localAddDoc) as any;
export const setDoc = (shouldUseFirebase ? firebaseSetDoc : localSetDoc) as any;
export const updateDoc = (shouldUseFirebase ? firebaseUpdateDoc : localUpdateDoc) as any;
export const deleteDoc = (shouldUseFirebase ? fsDeleteDoc : localDeleteDoc) as any;
export const getDocs = (shouldUseFirebase ? fsGetDocs : localGetDocs) as any;
export const getDoc = (shouldUseFirebase ? fsGetDoc : localGetDoc) as any;
export const FieldPath = (shouldUseFirebase ? fsFieldPath : localFieldPath) as any;
