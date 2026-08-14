import assert from 'node:assert/strict';
import {
  EvaluationClientStore,
  MemoryEvaluationClientBackend,
  buildHistorySummary,
  buildPendingArenaCheckpoint,
  migrateLegacyEvaluationStorage,
  resolveEvaluationPersistenceMode,
  validatePendingArenaCheckpoint,
} from '../src/evaluationClientStore.ts';
import {
  AuthStorageError,
  safeRemoveStorageItem,
  safeSetStorageItem,
  setRequiredAuthStorageItems,
} from '../src/safeBrowserStorage.ts';
import { buildHistoryCsv } from '../src/historyCsv.ts';
import type { EvaluationItem, HistorySession, VoteRecord } from '../src/types.ts';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  length = 0;

  clear() {
    this.values.clear();
    this.length = 0;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
    this.length = this.values.size;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
    this.length = this.values.size;
  }
}

class QuotaStorage extends MemoryStorage {
  override setItem() {
    throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
  }
}

class FailSecondWriteStorage extends MemoryStorage {
  private writes = 0;

  override setItem(key: string, value: string) {
    this.writes += 1;
    if (this.writes === 2) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    super.setItem(key, value);
  }
}

const makeItem = (index: number): EvaluationItem => ({
  id: `case-${index}`,
  modelA_Url: `https://example.com/a/${index}.mp4`,
  modelB_Url: `https://example.com/b/${index}.mp4`,
  modelOutputs: Array.from({ length: 5 }, (_, modelIndex) => ({
    modelId: `model-${modelIndex}`,
    modelName: `Model ${modelIndex}`,
    url: `https://example.com/${index}/${modelIndex}.mp4`,
  })),
  prompt: `Rich prompt ${index} ${'detail '.repeat(40)}`,
  inputs: { image_urls: [`https://example.com/reference/${index}.png`], metadata: 'x'.repeat(256) },
  originalData: { source: 'synthetic', notes: 'y'.repeat(256) },
  type: 'video',
});

const items = Array.from({ length: 188 }, (_, index) => makeItem(index));
const votes: VoteRecord[] = items.slice(0, 3).map((item, index) => ({
  itemId: item.id,
  vote: index % 2 === 0 ? 'A' : 'B',
  choice: index % 2 === 0 ? 'A' : 'B',
  timestamp: index + 1,
  user: 'Reviewer',
}));
const historySession: HistorySession = {
  id: 'session-history-1',
  taskId: 'task-1',
  timestamp: 123,
  userName: 'Reviewer',
  modelNames: { a: 'A', b: 'B' },
  paradigm: 'Arena',
  items,
  votes,
};

assert.deepEqual(
  resolveEvaluationPersistenceMode({ sharedDataSource: true, taskId: 'task-1', sampledArena: false }),
  { persistOfflineSession: false, persistArenaCheckpoint: false },
  'shared non-Arena tasks must not serialize full items or votes locally',
);
assert.deepEqual(
  resolveEvaluationPersistenceMode({ sharedDataSource: true, taskId: 'task-1', sampledArena: true }),
  { persistOfflineSession: false, persistArenaCheckpoint: true },
  'shared sampled Arena tasks may persist only a checkpoint',
);
assert.equal(
  resolveEvaluationPersistenceMode({ sharedDataSource: false, taskId: 'local-task', sampledArena: false }).persistOfflineSession,
  true,
  'offline tasks must retain refresh recovery',
);

const quotaStorage = new QuotaStorage();
assert.equal(safeSetStorageItem(quotaStorage, 'preference', 'value').ok, false);
assert.equal(safeRemoveStorageItem(quotaStorage, 'preference').ok, true);
assert.throws(
  () => setRequiredAuthStorageItems(quotaStorage, [['auth-token', 'secret'], ['auth-user', '{}']]),
  AuthStorageError,
  'auth storage failures must be explicit instead of leaving a partial session',
);
const partialAuthStorage = new FailSecondWriteStorage();
assert.throws(
  () => setRequiredAuthStorageItems(partialAuthStorage, [['auth-token', 'secret'], ['auth-user', '{}']]),
  AuthStorageError,
);
assert.equal(partialAuthStorage.getItem('auth-token'), null, 'a partially written auth session must be rolled back');
assert.equal(partialAuthStorage.getItem('auth-user'), null, 'the failed auth entry must remain absent');

const legacyStorage = new MemoryStorage();
const legacySession = {
  items,
  votes,
  currentIndex: 3,
  userName: 'Reviewer',
  modelNames: { a: 'A', b: 'B' },
  taskModels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  taskParadigm: 'Arena' as const,
  activeTaskId: null,
  timestamp: 123,
  sessionId: 'offline-session-1',
};
legacyStorage.setItem('modeleval_session', JSON.stringify(legacySession));
legacyStorage.setItem('modeleval_history', JSON.stringify([historySession]));

const backend = new MemoryEvaluationClientBackend();
const store = new EvaluationClientStore(backend);
const migration = await migrateLegacyEvaluationStorage({ legacyStorage, store, now: () => 456 });
assert.equal(migration.failures.length, 0);
assert.equal(legacyStorage.getItem('modeleval_session'), null, 'verified session key must be removed');
assert.equal(legacyStorage.getItem('modeleval_history'), null, 'verified history key must be removed');
assert.deepEqual((await store.getOfflineSession('offline-session-1'))?.session.items, items);
assert.deepEqual(await store.getHistoryDetail(historySession.id), historySession);
assert.deepEqual((await store.listHistorySummaries()).map(summary => summary.id), [historySession.id]);
assert.equal((await store.getMigrationBackup('modeleval_session'))?.state, 'cleaned');
assert.equal((await store.getMigrationBackup('modeleval_history'))?.raw, JSON.stringify([historySession]));

const summary = buildHistorySummary(historySession);
assert.equal(summary.itemCount, 188);
assert.equal(summary.voteCount, 3);
assert.deepEqual(summary.stats, { total: 3, aCount: 2, bCount: 1, tieCount: 0 });

const corruptStorage = new MemoryStorage();
corruptStorage.setItem('modeleval_history', '{not-json');
const corruptStore = new EvaluationClientStore(new MemoryEvaluationClientBackend());
const corruptMigration = await migrateLegacyEvaluationStorage({ legacyStorage: corruptStorage, store: corruptStore });
assert.equal(corruptMigration.failures.length, 1);
assert.equal(corruptStorage.getItem('modeleval_history'), '{not-json', 'corrupt legacy data must never be deleted');
assert.equal((await corruptStore.getMigrationBackup('modeleval_history'))?.state, 'failed');

const failingStorage = new MemoryStorage();
failingStorage.setItem('modeleval_session', JSON.stringify(legacySession));
const failingBackend = new MemoryEvaluationClientBackend({ failOperation: 'putBatch' });
const failedMigration = await migrateLegacyEvaluationStorage({
  legacyStorage: failingStorage,
  store: new EvaluationClientStore(failingBackend),
});
assert.equal(failedMigration.failures.length, 1);
assert.notEqual(failingStorage.getItem('modeleval_session'), null, 'copy failure must retain the legacy key');

class ReadbackMismatchBackend extends MemoryEvaluationClientBackend {
  private mismatched = false;
  override async get<T>(storeName: Parameters<MemoryEvaluationClientBackend['get']>[0], key: string) {
    const value = await super.get<T>(storeName, key);
    if (!this.mismatched && storeName === 'migrationBackups' && value) {
      this.mismatched = true;
      return { ...(value as any), digest: 'mismatch' } as T;
    }
    return value;
  }
}
const mismatchStorage = new MemoryStorage();
mismatchStorage.setItem('modeleval_history', JSON.stringify([historySession]));
const mismatchStore = new EvaluationClientStore(new ReadbackMismatchBackend());
const mismatchMigration = await migrateLegacyEvaluationStorage({ legacyStorage: mismatchStorage, store: mismatchStore });
assert.equal(mismatchMigration.failures.length, 1);
assert.notEqual(mismatchStorage.getItem('modeleval_history'), null, 'readback mismatch must retain the legacy key');
assert.equal((await mismatchStore.getMigrationBackup('modeleval_history'))?.state, 'failed');

class CleanupFailureStorage extends MemoryStorage {
  override removeItem(key: string) {
    if (key === 'modeleval_session') throw new Error('Injected cleanup failure');
    super.removeItem(key);
  }
}
const cleanupFailureStorage = new CleanupFailureStorage();
cleanupFailureStorage.setItem('modeleval_session', JSON.stringify(legacySession));
const cleanupFailureStore = new EvaluationClientStore(new MemoryEvaluationClientBackend());
const cleanupFailure = await migrateLegacyEvaluationStorage({ legacyStorage: cleanupFailureStorage, store: cleanupFailureStore });
assert.equal(cleanupFailure.failures.length, 1);
assert.notEqual(cleanupFailureStorage.getItem('modeleval_session'), null, 'cleanup failure must retain the source key');
assert.equal((await cleanupFailureStore.getMigrationBackup('modeleval_session'))?.state, 'failed');

class FailOnceOnThirdBatchBackend extends MemoryEvaluationClientBackend {
  private batchCount = 0;
  override async putBatch(operations: Parameters<MemoryEvaluationClientBackend['putBatch']>[0]) {
    this.batchCount += 1;
    if (this.batchCount === 3) throw new Error('Injected cleaned-state failure');
    return super.putBatch(operations);
  }
}
const resumableStorage = new MemoryStorage();
resumableStorage.setItem('modeleval_session', JSON.stringify(legacySession));
const resumableStore = new EvaluationClientStore(new FailOnceOnThirdBatchBackend());
const interrupted = await migrateLegacyEvaluationStorage({ legacyStorage: resumableStorage, store: resumableStore });
assert.equal(interrupted.failures.length, 1);
assert.notEqual(resumableStorage.getItem('modeleval_session'), null, 'a final metadata failure must restore the source key');
const resumed = await migrateLegacyEvaluationStorage({ legacyStorage: resumableStorage, store: resumableStore });
assert.equal(resumed.failures.length, 0, 'an interrupted migration must be resumable');
assert.equal(resumableStorage.getItem('modeleval_session'), null);

const concurrentStorage = new MemoryStorage();
concurrentStorage.setItem('modeleval_history', JSON.stringify([historySession]));
const concurrentStore = new EvaluationClientStore(new MemoryEvaluationClientBackend());
const concurrentResults = await Promise.all([
  migrateLegacyEvaluationStorage({ legacyStorage: concurrentStorage, store: concurrentStore }),
  migrateLegacyEvaluationStorage({ legacyStorage: concurrentStorage, store: concurrentStore }),
]);
assert.equal(concurrentResults.flatMap(result => result.failures).length, 0, 'concurrent tabs must migrate idempotently');
assert.equal((await concurrentStore.listHistorySummaries()).length, 1, 'concurrent migration must not duplicate history');

const originalCsv = buildHistoryCsv(historySession);
const migratedCsvSession = await store.getHistoryDetail(historySession.id);
assert(migratedCsvSession);
assert.deepEqual(buildHistoryCsv(migratedCsvSession!), originalCsv, 'history CSV output must remain byte-for-byte stable after migration');

const revisionStore = new EvaluationClientStore(new MemoryEvaluationClientBackend());
await revisionStore.saveOfflineSession({ id: 'revisioned', revision: 2, updatedAt: 2, session: { ...legacySession, sessionId: 'revisioned', currentIndex: 2 } });
await revisionStore.saveOfflineSession({ id: 'revisioned', revision: 1, updatedAt: 1, session: { ...legacySession, sessionId: 'revisioned', currentIndex: 1 } });
assert.equal((await revisionStore.getOfflineSession('revisioned'))?.session.currentIndex, 2, 'older async writes must not replace newer progress');

const arenaItem = makeItem(999);
const assignment = {
  assignmentId: 'assignment-1',
  itemId: arenaItem.id,
  originalItemId: arenaItem.id,
  modelAId: 'model-0',
  modelAName: 'Model 0',
  modelAUrl: arenaItem.modelOutputs![0].url,
  modelBId: 'model-1',
  modelBName: 'Model 1',
  modelBUrl: arenaItem.modelOutputs![1].url,
  leftModelId: 'model-1',
  rightModelId: 'model-0',
  isSwapped: true,
  samplingPhase: 'coverage' as const,
  samplingProbability: 0.5,
  eligiblePairCount: 10,
  schedulerVersion: 'arena_v1',
  pairContext: {
    assignmentId: 'assignment-1',
    originalItemId: arenaItem.id,
    modelAId: 'model-0',
    modelAName: 'Model 0',
    modelBId: 'model-1',
    modelBName: 'Model 1',
    leftModelId: 'model-1',
    rightModelId: 'model-0',
    schedulerVersion: 'arena_v1',
  },
};
const checkpoint = buildPendingArenaCheckpoint({
  taskId: 'task-arena',
  reviewerId: 'reviewer-1',
  submittedVoteCount: 4,
  sessionId: 'arena-session',
  item: { ...arenaItem, pairContext: assignment.pairContext, modelA_Url: assignment.modelAUrl, modelB_Url: assignment.modelBUrl, isSwapped: true },
});
assert(checkpoint, 'an assigned Arena item should produce a checkpoint');
assert.equal(validatePendingArenaCheckpoint(checkpoint!, {
  taskId: 'task-arena', reviewerId: 'reviewer-1', submittedVoteCount: 4, item: arenaItem, schedulerVersion: 'arena_v1',
}), true);
assert.equal(validatePendingArenaCheckpoint(checkpoint!, {
  taskId: 'task-arena', reviewerId: 'reviewer-1', submittedVoteCount: 5, item: arenaItem, schedulerVersion: 'arena_v1',
}), false, 'a changed server vote count must invalidate a checkpoint');

console.log('Evaluation client storage tests passed.');
