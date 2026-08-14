# Evaluation client storage migration

## Scope

This migration removes the legacy full-session `localStorage` writes that used
`modeleval_session` and `modeleval_history`. PostgreSQL remains the source of
truth for every server-backed task, case, and vote.

The versioned IndexedDB database is `manueval-client-state` and contains:

- `migrationBackups`: raw copies of both legacy keys plus digest and migration state.
- `offlineSessions`: full state only for evaluations without a server task.
- `historySummaries`: the small history-list index.
- `historyDetails`: one complete record per history session, loaded on demand.
- `taskCheckpoints`: the current unsubmitted sampled-Arena assignment only.

## Migration guarantees

For each legacy key the client reads and hashes the original value, atomically
writes the raw backup and converted records, reads them back for verification,
then removes the legacy key. Any parse, write, readback, or cleanup failure keeps
or restores the legacy key where browser quota permits. The raw IndexedDB backup
is retained even after successful cleanup and is removed only by an explicit
"clear local history" action.

Migration is idempotent across refreshes and concurrent tabs. Reprocessing the
same session IDs overwrites the same IndexedDB records instead of creating
duplicates. Corrupt JSON is backed up and reported but never deleted.

## Runtime behavior

- A/B, MOS, Rubric, Arena-rank, and Preview reload task data and the current user's votes from the API.
- Sampled Arena stores only an assignment checkpoint and rejects it when task, reviewer, vote count, scheduler version, case, or model outputs change.
- Offline evaluations use revisioned serialized writes so an older asynchronous write cannot replace newer progress.
- Storage quota and IndexedDB failures are non-fatal for server tasks and surface as an in-app warning.
- Authentication storage failures are reported and partial token/user writes are rolled back.

## Deployment and downgrade

No PostgreSQL migration is required. A deployment rollback must not restore the
legacy full-session writers. If IndexedDB persistence must be disabled, keep
server task loading and vote saving enabled, disable only local offline/history
features, and retain `migrationBackups` for recovery.

The browser regression suite is `npm run test:e2e:evaluation-storage`. Local
runs use `E2E_BASE_URL`; CI starts PostgreSQL, the API, and Vite before executing
the same suite.
