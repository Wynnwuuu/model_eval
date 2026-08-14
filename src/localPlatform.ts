import { safeGetStorageItem, safeSetStorageItem } from './safeBrowserStorage';

export const LOCAL_PLATFORM_STORAGE_KEY = 'evaltrack_local_platform_v1';

export const localUser = {
  uid: 'local-user',
  email: 'local@eval.test',
  displayName: 'Local Tester',
  emailVerified: true,
  isAnonymous: false,
  providerData: [
    {
      providerId: 'local',
      displayName: 'Local Tester',
      email: 'local@eval.test'
    }
  ]
};

export const localDb = { type: 'local-platform' } as const;

type CollectionStore = Record<string, Record<string, any>>;

interface LocalPlatformState {
  collections: CollectionStore;
}

type Constraint =
  | { type: 'where'; field: string; op: '=='; value: any }
  | { type: 'orderBy'; field: string; direction: 'asc' | 'desc' };

interface CollectionReference {
  kind: 'collection';
  path: string[];
}

interface DocumentReference {
  kind: 'doc';
  path: string[];
  id: string;
}

interface QueryReference {
  kind: 'query';
  source: CollectionReference;
  constraints: Constraint[];
}

const listeners = new Set<{
  target: CollectionReference | QueryReference;
  next: (snapshot: LocalQuerySnapshot) => void;
  error?: (error: unknown) => void;
}>();

class LocalDocumentSnapshot {
  constructor(
    public readonly id: string,
    private readonly payload: any | undefined
  ) {}

  /** Aligns with document snapshot `exists` property used by the local adapter. */
  get exists(): boolean {
    return this.payload !== undefined;
  }

  data() {
    return clone(this.payload);
  }
}

class LocalQuerySnapshot {
  public readonly docs: LocalDocumentSnapshot[];
  public readonly empty: boolean;

  constructor(docs: LocalDocumentSnapshot[]) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }

  forEach(callback: (doc: LocalDocumentSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

export class FieldPath {
  public readonly segments: string[];

  constructor(...segments: string[]) {
    this.segments = segments;
  }
}

const initialState = (): LocalPlatformState => ({
  collections: {
    users: {
      [localUser.uid]: {
        uid: localUser.uid,
        email: localUser.email,
        displayName: localUser.displayName,
        role: 'admin'
      }
    },
    projects: {},
    datasets: {},
    evalDatasets: {},
    evalGenerationJobs: {},
    evalTemplates: {},
    evalTasks: {}
  }
});

function normalizeSegments(segments: unknown[]): string[] {
  return segments
    .flatMap(segment => String(segment).split('/'))
    .map(segment => segment.trim())
    .filter(Boolean);
}

function pathKey(path: string[]) {
  return path.join('/');
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function ensureStateShape(state: Partial<LocalPlatformState> | null | undefined): LocalPlatformState {
  const base = initialState();
  const collections = { ...base.collections, ...(state?.collections || {}) };
  collections.users = {
    ...base.collections.users,
    ...(collections.users || {})
  };
  return { collections };
}

function readState(): LocalPlatformState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return ensureStateShape(null);
  }

  const raw = safeGetStorageItem(window.localStorage, LOCAL_PLATFORM_STORAGE_KEY, { report: false }).value;
  if (!raw) return ensureStateShape(null);

  try {
    return ensureStateShape(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to parse local platform data', error);
    return ensureStateShape(null);
  }
}

function writeState(state: LocalPlatformState) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  safeSetStorageItem(window.localStorage, LOCAL_PLATFORM_STORAGE_KEY, JSON.stringify(state));
}

function getCollection(state: LocalPlatformState, collectionPath: string[]) {
  const key = pathKey(collectionPath);
  if (!state.collections[key]) state.collections[key] = {};
  return state.collections[key];
}

function getValueByPath(source: any, path: string) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function setValueByPath(target: any, path: string[], value: any) {
  let cursor = target;
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      cursor[segment] = clone(value);
      return;
    }
    if (!cursor[segment] || typeof cursor[segment] !== 'object' || Array.isArray(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  });
}

function deepMerge(target: any, source: any) {
  const output = { ...(target || {}) };
  Object.entries(source || {}).forEach(([key, value]) => {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = clone(value);
    }
  });
  return output;
}

function makeDocSnapshot(ref: DocumentReference, state = readState()) {
  const id = ref.path[ref.path.length - 1];
  const collectionPath = ref.path.slice(0, -1);
  const stored = state.collections[pathKey(collectionPath)]?.[id];
  return new LocalDocumentSnapshot(id, stored);
}

function makeQuerySnapshot(target: CollectionReference | QueryReference, state = readState()) {
  const collectionRef = target.kind === 'query' ? target.source : target;
  const constraints = target.kind === 'query' ? target.constraints : [];
  const collectionData = state.collections[pathKey(collectionRef.path)] || {};
  let rows = Object.entries(collectionData).map(([id, payload]) => ({
    id,
    payload: clone(payload)
  }));

  constraints.forEach(constraint => {
    if (constraint.type === 'where') {
      rows = rows.filter(row => getValueByPath(row.payload, constraint.field) === constraint.value);
    }
  });

  constraints.forEach(constraint => {
    if (constraint.type === 'orderBy') {
      rows = [...rows].sort((a, b) => {
        const left = getValueByPath(a.payload, constraint.field);
        const right = getValueByPath(b.payload, constraint.field);
        if (left === right) return 0;
        if (left === undefined || left === null) return 1;
        if (right === undefined || right === null) return -1;
        return left > right ? 1 : -1;
      });
      if (constraint.direction === 'desc') rows.reverse();
    }
  });

  return new LocalQuerySnapshot(rows.map(row => new LocalDocumentSnapshot(row.id, row.payload)));
}

function notifyListeners() {
  listeners.forEach(listener => {
    try {
      listener.next(makeQuerySnapshot(listener.target));
    } catch (error) {
      listener.error?.(error);
    }
  });
}

function generateId(prefix = 'local') {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now()}-${random}`;
}

export function collection(base: any, ...segments: string[]): CollectionReference {
  const basePath = base?.kind === 'doc' || base?.kind === 'collection' ? base.path : [];
  return {
    kind: 'collection',
    path: [...basePath, ...normalizeSegments(segments)]
  };
}

export function doc(base: any, ...segments: string[]): DocumentReference {
  const basePath = base?.kind === 'doc' || base?.kind === 'collection' ? base.path : [];
  const path = [...basePath, ...normalizeSegments(segments)];
  return {
    kind: 'doc',
    path,
    id: path[path.length - 1]
  };
}

export function where(field: string, op: '==', value: any): Constraint {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Constraint {
  return { type: 'orderBy', field, direction };
}

export function query(source: CollectionReference, ...constraints: Constraint[]): QueryReference {
  return { kind: 'query', source, constraints };
}

export function onSnapshot(
  target: CollectionReference | QueryReference,
  next: (snapshot: LocalQuerySnapshot) => void,
  error?: (error: unknown) => void
) {
  const listener = { target, next, error };
  listeners.add(listener);
  next(makeQuerySnapshot(target));
  return () => listeners.delete(listener);
}

export async function getDocs(target: CollectionReference | QueryReference) {
  return makeQuerySnapshot(target);
}

export async function getDoc(ref: DocumentReference) {
  return makeDocSnapshot(ref);
}

export async function addDoc(ref: CollectionReference, payload: any) {
  const state = readState();
  const collectionData = getCollection(state, ref.path);
  const id = payload?.id && !collectionData[payload.id] ? String(payload.id) : generateId(ref.path.at(-1) || 'doc');
  collectionData[id] = clone(payload);
  writeState(state);
  notifyListeners();
  return doc(localDb, ...ref.path, id);
}

export async function setDoc(ref: DocumentReference, payload: any, options?: { merge?: boolean }) {
  const state = readState();
  const id = ref.path[ref.path.length - 1];
  const collectionData = getCollection(state, ref.path.slice(0, -1));
  collectionData[id] = options?.merge ? deepMerge(collectionData[id], payload) : clone(payload);
  writeState(state);
  notifyListeners();
}

export async function updateDoc(ref: DocumentReference, dataOrField: any, value?: any, ...rest: any[]) {
  const state = readState();
  const id = ref.path[ref.path.length - 1];
  const collectionData = getCollection(state, ref.path.slice(0, -1));
  if (!collectionData[id]) {
    throw new Error(`Local document does not exist: ${pathKey(ref.path)}`);
  }

  const current = clone(collectionData[id]);
  if (dataOrField instanceof FieldPath) {
    setValueByPath(current, dataOrField.segments, value);
    for (let index = 0; index < rest.length; index += 2) {
      const field = rest[index];
      const nextValue = rest[index + 1];
      if (field instanceof FieldPath) {
        setValueByPath(current, field.segments, nextValue);
      } else {
        setValueByPath(current, [String(field)], nextValue);
      }
    }
  } else {
    Object.entries(dataOrField || {}).forEach(([key, nextValue]) => {
      setValueByPath(current, key.split('.'), nextValue);
    });
  }

  collectionData[id] = current;
  writeState(state);
  notifyListeners();
}

export async function deleteDoc(ref: DocumentReference) {
  const state = readState();
  const id = ref.path[ref.path.length - 1];
  const collectionPath = ref.path.slice(0, -1);
  const collectionData = getCollection(state, collectionPath);
  delete collectionData[id];

  const deletedPrefix = pathKey(ref.path);
  Object.keys(state.collections).forEach(key => {
    if (key.startsWith(`${deletedPrefix}/`)) {
      delete state.collections[key];
    }
  });

  writeState(state);
  notifyListeners();
}

export function serverTimestamp() {
  return Date.now();
}
