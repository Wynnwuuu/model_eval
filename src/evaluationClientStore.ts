import type {
  ArenaBattleAssignment,
  EvaluationItem,
  HistorySession,
  HistorySessionSummary,
  PendingArenaCheckpointV1,
  VoteRecord,
} from './types';
import { getEffectiveVotes, getSkippedVoteCount } from './voteUtils';
import { calculateArenaRankModelStats, getRankingTieSummary, isArenaRankVote } from './rankingUtils';

export const EVALUATION_CLIENT_DB_NAME = 'manueval-client-state';
export const EVALUATION_CLIENT_DB_VERSION = 1;
export const LEGACY_SESSION_KEY = 'modeleval_session';
export const LEGACY_HISTORY_KEY = 'modeleval_history';

export type EvaluationClientStoreName =
  | 'migrationBackups'
  | 'offlineSessions'
  | 'historySummaries'
  | 'historyDetails'
  | 'taskCheckpoints';

export interface MigrationBackupRecord {
  key: string;
  raw: string;
  digest: string;
  bytes: number;
  recordCount: number;
  sessionIds: string[];
  state: 'pending' | 'copied' | 'verified' | 'cleaned' | 'failed';
  updatedAt: number;
  error?: string;
}

export interface LegacyEvaluationSession {
  items: EvaluationItem[];
  votes: VoteRecord[];
  currentIndex: number;
  userName: string;
  modelNames: { a: string; b: string };
  taskModels?: Array<{ id: string; name: string }>;
  taskParadigm?: HistorySession['paradigm'];
  taskEvaluationConfig?: HistorySession['evaluationConfig'];
  activeTaskId?: string | null;
  timestamp?: number;
  sessionId: string;
}

export interface StoredOfflineSessionV1 {
  id: string;
  revision: number;
  updatedAt: number;
  session: LegacyEvaluationSession;
}

interface PutOperation {
  store: EvaluationClientStoreName;
  value: Record<string, unknown>;
}

export interface EvaluationClientBackend {
  putBatch(operations: PutOperation[]): Promise<void>;
  putIfNewer(store: 'offlineSessions', value: StoredOfflineSessionV1): Promise<boolean>;
  get<T>(store: EvaluationClientStoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: EvaluationClientStoreName): Promise<T[]>;
  delete(store: EvaluationClientStoreName, key: string): Promise<void>;
  clear(stores: EvaluationClientStoreName[]): Promise<void>;
}

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
});

export class IndexedDbEvaluationClientBackend implements EvaluationClientBackend {
  private databasePromise?: Promise<IDBDatabase>;

  constructor(private readonly databaseName = EVALUATION_CLIENT_DB_NAME) {}

  private open() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable in this browser'));
        return;
      }
      const request = indexedDB.open(this.databaseName, EVALUATION_CLIENT_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const ensureStore = (name: EvaluationClientStoreName) => {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: name === 'migrationBackups' ? 'key' : 'id' });
        };
        ensureStore('migrationBackups');
        ensureStore('offlineSessions');
        ensureStore('historySummaries');
        ensureStore('historyDetails');
        ensureStore('taskCheckpoints');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another tab'));
    });
    return this.databasePromise;
  }

  async putBatch(operations: PutOperation[]) {
    if (operations.length === 0) return;
    const database = await this.open();
    const stores = Array.from(new Set(operations.map(operation => operation.store)));
    const transaction = database.transaction(stores, 'readwrite');
    const done = transactionDone(transaction);
    operations.forEach(operation => transaction.objectStore(operation.store).put(operation.value));
    await done;
  }

  async putIfNewer(_store: 'offlineSessions', value: StoredOfflineSessionV1) {
    const database = await this.open();
    const transaction = database.transaction('offlineSessions', 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore('offlineSessions');
    const current = await requestResult(store.get(value.id)) as StoredOfflineSessionV1 | undefined;
    const accepted = !current || current.revision <= value.revision;
    if (accepted) store.put(value);
    await done;
    return accepted;
  }

  async get<T>(storeName: EvaluationClientStoreName, key: string) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(storeName).get(key)) as T | undefined;
    await done;
    return value;
  }

  async getAll<T>(storeName: EvaluationClientStoreName) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readonly');
    const done = transactionDone(transaction);
    const values = await requestResult(transaction.objectStore(storeName).getAll()) as T[];
    await done;
    return values;
  }

  async delete(storeName: EvaluationClientStoreName, key: string) {
    const database = await this.open();
    const transaction = database.transaction(storeName, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(storeName).delete(key);
    await done;
  }

  async clear(storeNames: EvaluationClientStoreName[]) {
    if (storeNames.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction(storeNames, 'readwrite');
    const done = transactionDone(transaction);
    storeNames.forEach(storeName => transaction.objectStore(storeName).clear());
    await done;
  }
}

export class MemoryEvaluationClientBackend implements EvaluationClientBackend {
  private readonly stores = new Map<EvaluationClientStoreName, Map<string, any>>();
  private operationCount = 0;

  constructor(private readonly failure?: { failOperation: keyof EvaluationClientBackend; atCall?: number }) {
    (['migrationBackups', 'offlineSessions', 'historySummaries', 'historyDetails', 'taskCheckpoints'] as EvaluationClientStoreName[])
      .forEach(store => this.stores.set(store, new Map()));
  }

  private maybeFail(operation: keyof EvaluationClientBackend) {
    this.operationCount += 1;
    if (this.failure?.failOperation === operation && (this.failure.atCall === undefined || this.failure.atCall === this.operationCount)) {
      throw new Error(`Injected ${operation} failure`);
    }
  }

  async putBatch(operations: PutOperation[]) {
    this.maybeFail('putBatch');
    const next = new Map<EvaluationClientStoreName, Map<string, any>>();
    this.stores.forEach((value, key) => next.set(key, new Map(value)));
    operations.forEach(operation => {
      const key = String(operation.value.key ?? operation.value.id);
      next.get(operation.store)!.set(key, structuredClone(operation.value));
    });
    next.forEach((value, key) => this.stores.set(key, value));
  }

  async putIfNewer(_store: 'offlineSessions', value: StoredOfflineSessionV1) {
    this.maybeFail('putIfNewer');
    const current = this.stores.get('offlineSessions')!.get(value.id) as StoredOfflineSessionV1 | undefined;
    if (current && current.revision > value.revision) return false;
    this.stores.get('offlineSessions')!.set(value.id, structuredClone(value));
    return true;
  }

  async get<T>(store: EvaluationClientStoreName, key: string) {
    this.maybeFail('get');
    const value = this.stores.get(store)!.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async getAll<T>(store: EvaluationClientStoreName) {
    this.maybeFail('getAll');
    return Array.from(this.stores.get(store)!.values()).map(value => structuredClone(value)) as T[];
  }

  async delete(store: EvaluationClientStoreName, key: string) {
    this.maybeFail('delete');
    this.stores.get(store)!.delete(key);
  }

  async clear(stores: EvaluationClientStoreName[]) {
    this.maybeFail('clear');
    stores.forEach(store => this.stores.get(store)!.clear());
  }
}

const digestText = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  bytes.forEach(byte => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  });
  return `fallback-${(hash >>> 0).toString(16)}`;
};

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export const buildHistorySummary = (session: HistorySession): HistorySessionSummary => {
  const effectiveVotes = getEffectiveVotes(session.votes || []);
  const rankVotes = effectiveVotes.filter(isArenaRankVote);
  const rankStats = calculateArenaRankModelStats(rankVotes);
  const leadingModels = rankStats.length
    ? rankStats.filter(model => Math.abs(model.normalizedScore - rankStats[0].normalizedScore) < 1e-9)
    : [];
  const stats = effectiveVotes.reduce((result, vote) => {
    result.total += 1;
    if (vote.vote === 'A') result.aCount += 1;
    else if (vote.vote === 'B') result.bCount += 1;
    else result.tieCount += 1;
    return result;
  }, { total: 0, aCount: 0, bCount: 0, tieCount: 0 });
  return {
    id: session.id,
    taskId: session.taskId,
    timestamp: session.timestamp,
    userName: session.userName,
    modelNames: session.modelNames,
    models: session.models,
    paradigm: session.paradigm,
    evaluationConfig: session.evaluationConfig,
    itemCount: (session.items || []).length,
    voteCount: (session.votes || []).length,
    skippedCount: getSkippedVoteCount(session.votes || []),
    stats,
    rankSummary: session.paradigm === 'Arena-rank' ? {
      leadingModelNames: leadingModels.map(model => model.modelName),
      normalizedScore: rankStats[0]?.normalizedScore || 0,
      tieRate: rankVotes.length
        ? rankVotes.filter(vote => getRankingTieSummary(vote.ranking).hasTie).length / rankVotes.length
        : 0,
    } : undefined,
  };
};

export class EvaluationClientStore {
  constructor(public readonly backend: EvaluationClientBackend = new IndexedDbEvaluationClientBackend()) {}

  saveOfflineSession(value: StoredOfflineSessionV1) {
    return this.backend.putIfNewer('offlineSessions', value);
  }

  getOfflineSession(id: string) {
    return this.backend.get<StoredOfflineSessionV1>('offlineSessions', id);
  }

  async getLatestOfflineSession() {
    const sessions = await this.backend.getAll<StoredOfflineSessionV1>('offlineSessions');
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  }

  deleteOfflineSession(id: string) {
    return this.backend.delete('offlineSessions', id);
  }

  async saveHistorySession(session: HistorySession) {
    const summary = buildHistorySummary(session);
    await this.backend.putBatch([
      { store: 'historySummaries', value: summary as unknown as Record<string, unknown> },
      { store: 'historyDetails', value: session as unknown as Record<string, unknown> },
    ]);
    return summary;
  }

  async listHistorySummaries() {
    const summaries = await this.backend.getAll<HistorySessionSummary>('historySummaries');
    return summaries.sort((left, right) => right.timestamp - left.timestamp);
  }

  getHistoryDetail(id: string) {
    return this.backend.get<HistorySession>('historyDetails', id);
  }

  async deleteHistorySession(id: string) {
    await Promise.all([
      this.backend.delete('historySummaries', id),
      this.backend.delete('historyDetails', id),
    ]);
  }

  clearHistoryAndMigrationBackups() {
    return this.backend.clear(['historySummaries', 'historyDetails', 'migrationBackups']);
  }

  saveTaskCheckpoint(checkpoint: PendingArenaCheckpointV1) {
    return this.backend.putBatch([{ store: 'taskCheckpoints', value: checkpoint as unknown as Record<string, unknown> }]);
  }

  getTaskCheckpoint(taskId: string, reviewerId: string) {
    return this.backend.get<PendingArenaCheckpointV1>('taskCheckpoints', `${taskId}::${reviewerId}`);
  }

  deleteTaskCheckpoint(taskId: string, reviewerId: string) {
    return this.backend.delete('taskCheckpoints', `${taskId}::${reviewerId}`);
  }

  getMigrationBackup(key: string) {
    return this.backend.get<MigrationBackupRecord>('migrationBackups', key);
  }

  putMigrationRecords(operations: PutOperation[]) {
    return this.backend.putBatch(operations);
  }
}

export const resolveEvaluationPersistenceMode = ({
  sharedDataSource,
  taskId,
  sampledArena,
}: {
  sharedDataSource: boolean;
  taskId?: string | null;
  sampledArena: boolean;
}) => {
  const serverBacked = sharedDataSource && Boolean(taskId);
  return {
    persistOfflineSession: !serverBacked,
    persistArenaCheckpoint: serverBacked && sampledArena,
  };
};

const toArenaAssignment = (item: EvaluationItem): ArenaBattleAssignment | undefined => {
  const context = item.pairContext;
  if (!context?.assignmentId || !context.modelAId || !context.modelBId) return undefined;
  return {
    assignmentId: context.assignmentId,
    itemId: item.id,
    originalItemId: context.originalItemId || item.originalItemId || item.id,
    modelAId: context.modelAId,
    modelAName: context.modelAName,
    modelAUrl: item.modelA_Url,
    modelBId: context.modelBId,
    modelBName: context.modelBName,
    modelBUrl: item.modelB_Url,
    leftModelId: context.leftModelId || (item.isSwapped ? context.modelBId : context.modelAId),
    rightModelId: context.rightModelId || (item.isSwapped ? context.modelAId : context.modelBId),
    isSwapped: context.leftModelId ? context.leftModelId === context.modelBId : Boolean(item.isSwapped),
    samplingPhase: context.samplingPhase || 'coverage',
    samplingProbability: context.samplingProbability ?? 0,
    eligiblePairCount: context.eligiblePairCount ?? 0,
    schedulerVersion: context.schedulerVersion || 'arena_v1',
    pairContext: { ...context },
  };
};

export const buildPendingArenaCheckpoint = ({
  taskId,
  reviewerId,
  submittedVoteCount,
  sessionId,
  item,
  updatedAt = Date.now(),
}: {
  taskId: string;
  reviewerId: string;
  submittedVoteCount: number;
  sessionId: string;
  item: EvaluationItem;
  updatedAt?: number;
}): PendingArenaCheckpointV1 | undefined => {
  const assignment = toArenaAssignment(item);
  if (!assignment) return undefined;
  return {
    id: `${taskId}::${reviewerId}`,
    version: 1,
    taskId,
    reviewerId,
    itemId: item.id,
    originalItemId: item.originalItemId || item.id,
    assignment,
    submittedVoteCount,
    schedulerVersion: assignment.schedulerVersion,
    sessionId,
    updatedAt,
  };
};

export const validatePendingArenaCheckpoint = (
  checkpoint: PendingArenaCheckpointV1,
  expected: {
    taskId: string;
    reviewerId: string;
    submittedVoteCount: number;
    schedulerVersion: string;
    item: EvaluationItem;
  },
) => {
  if (
    checkpoint.version !== 1
    || checkpoint.taskId !== expected.taskId
    || checkpoint.reviewerId !== expected.reviewerId
    || checkpoint.submittedVoteCount !== expected.submittedVoteCount
    || checkpoint.schedulerVersion !== expected.schedulerVersion
  ) return false;
  const originalItemId = expected.item.originalItemId || expected.item.id;
  if (checkpoint.originalItemId !== originalItemId) return false;
  const outputs = new Map((expected.item.modelOutputs || []).map(output => [output.modelId, output.url]));
  if (outputs.size > 0) {
    if (outputs.get(checkpoint.assignment.modelAId) !== checkpoint.assignment.modelAUrl) return false;
    if (outputs.get(checkpoint.assignment.modelBId) !== checkpoint.assignment.modelBUrl) return false;
  }
  return checkpoint.assignment.leftModelId !== checkpoint.assignment.rightModelId
    && [checkpoint.assignment.modelAId, checkpoint.assignment.modelBId].includes(checkpoint.assignment.leftModelId)
    && [checkpoint.assignment.modelAId, checkpoint.assignment.modelBId].includes(checkpoint.assignment.rightModelId);
};

interface LegacyMigrationInput {
  legacyStorage: Storage;
  store: EvaluationClientStore;
  now?: () => number;
  reviewerId?: string;
}

export interface LegacyMigrationResult {
  migrated: string[];
  failures: Array<{ key: string; stage: string; message: string }>;
}

const parseLegacySession = (raw: string): LegacyEvaluationSession => {
  const parsed = JSON.parse(raw) as LegacyEvaluationSession;
  if (!parsed || !Array.isArray(parsed.items) || !Array.isArray(parsed.votes)) throw new Error('Legacy session does not contain items and votes arrays');
  return {
    ...parsed,
    currentIndex: Number.isFinite(parsed.currentIndex) ? parsed.currentIndex : parsed.votes.length,
    userName: parsed.userName || 'Anonymous',
    modelNames: parsed.modelNames || { a: 'Model A', b: 'Model B' },
    sessionId: parsed.sessionId || `legacy-session-${parsed.timestamp || 0}`,
  };
};

const parseLegacyHistory = (raw: string): HistorySession[] => {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Legacy history is not an array');
  return parsed.map((session, index) => {
    if (!session || !Array.isArray(session.items) || !Array.isArray(session.votes)) throw new Error(`Legacy history entry ${index + 1} is invalid`);
    return {
      ...session,
      id: session.id || `legacy-history-${session.timestamp || index}`,
      timestamp: Number(session.timestamp) || 0,
      userName: session.userName || 'Anonymous',
      modelNames: session.modelNames || { a: 'Model A', b: 'Model B' },
    } as HistorySession;
  });
};

const markMigration = async (
  store: EvaluationClientStore,
  backup: MigrationBackupRecord,
  state: MigrationBackupRecord['state'],
  updatedAt: number,
  error?: string,
) => store.putMigrationRecords([{
  store: 'migrationBackups',
  value: { ...backup, state, updatedAt, error } as unknown as Record<string, unknown>,
}]);

export const migrateLegacyEvaluationStorage = async ({
  legacyStorage,
  store,
  now = () => Date.now(),
  reviewerId,
}: LegacyMigrationInput): Promise<LegacyMigrationResult> => {
  const result: LegacyMigrationResult = { migrated: [], failures: [] };
  for (const key of [LEGACY_SESSION_KEY, LEGACY_HISTORY_KEY]) {
    let raw: string | null;
    try {
      raw = legacyStorage.getItem(key);
    } catch (error) {
      result.failures.push({ key, stage: 'read', message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (raw === null) continue;

    const timestamp = now();
    const digest = await digestText(raw);
    let operations: PutOperation[] = [];
    let recordCount = 0;
    let sessionIds: string[] = [];
    let backup: MigrationBackupRecord = {
      key,
      raw,
      digest,
      bytes: byteLength(raw),
      recordCount: 0,
      sessionIds: [],
      state: 'pending',
      updatedAt: timestamp,
    };
    try {
      if (key === LEGACY_SESSION_KEY) {
        const session = parseLegacySession(raw);
        recordCount = 1;
        sessionIds = [session.sessionId];
        if (!session.activeTaskId) {
          operations.push({
            store: 'offlineSessions',
            value: { id: session.sessionId, revision: 1, updatedAt: session.timestamp || timestamp, session },
          });
        } else {
          const item = session.items[session.currentIndex];
          const checkpoint = item ? buildPendingArenaCheckpoint({
            taskId: session.activeTaskId,
            reviewerId: reviewerId || session.userName || 'Anonymous',
            submittedVoteCount: session.votes.length,
            sessionId: session.sessionId,
            item,
            updatedAt: session.timestamp || timestamp,
          }) : undefined;
          if (checkpoint) operations.push({ store: 'taskCheckpoints', value: checkpoint as unknown as Record<string, unknown> });
        }
      } else {
        const history = parseLegacyHistory(raw);
        recordCount = history.length;
        sessionIds = history.map(session => session.id);
        history.forEach(session => {
          operations.push({ store: 'historySummaries', value: buildHistorySummary(session) as unknown as Record<string, unknown> });
          operations.push({ store: 'historyDetails', value: session as unknown as Record<string, unknown> });
        });
      }
      backup = { ...backup, recordCount, sessionIds, state: 'copied' };
      await store.putMigrationRecords([
        { store: 'migrationBackups', value: backup as unknown as Record<string, unknown> },
        ...operations,
      ]);

      const copiedBackup = await store.getMigrationBackup(key);
      if (!copiedBackup || copiedBackup.raw !== raw || copiedBackup.digest !== digest || copiedBackup.bytes !== byteLength(raw)) {
        throw new Error('Raw migration backup did not pass readback verification');
      }
      if (key === LEGACY_SESSION_KEY) {
        const session = parseLegacySession(raw);
        if (!session.activeTaskId) {
          const copied = await store.getOfflineSession(session.sessionId);
          if (!copied || await digestText(JSON.stringify(copied.session)) !== await digestText(JSON.stringify(session))) {
            throw new Error('Offline session did not pass readback verification');
          }
        }
      } else {
        const history = parseLegacyHistory(raw);
        for (const session of history) {
          const detail = await store.getHistoryDetail(session.id);
          const summary = (await store.listHistorySummaries()).find(candidate => candidate.id === session.id);
          if (!detail || !summary || await digestText(JSON.stringify(detail)) !== await digestText(JSON.stringify(session))) {
            throw new Error(`History session ${session.id} did not pass readback verification`);
          }
        }
      }
      await markMigration(store, backup, 'verified', now());
      legacyStorage.removeItem(key);
      if (legacyStorage.getItem(key) !== null) throw new Error('Legacy key cleanup could not be verified');
      await markMigration(store, backup, 'cleaned', now());
      result.migrated.push(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        if (legacyStorage.getItem(key) === null) legacyStorage.setItem(key, raw);
      } catch {
        // The verified IndexedDB raw backup remains available even if the
        // browser refuses to restore the just-removed localStorage value.
      }
      try {
        await markMigration(store, backup, 'failed', now(), message);
      } catch {
        // The source key remains authoritative when IndexedDB itself is unavailable.
      }
      result.failures.push({ key, stage: backup.state === 'pending' ? 'parse-or-copy' : 'verify-or-cleanup', message });
    }
  }
  return result;
};

export const createEvaluationClientStore = () => new EvaluationClientStore(new IndexedDbEvaluationClientBackend());
