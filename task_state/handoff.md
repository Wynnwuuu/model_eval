# Arena And Arena-rank Handoff

## Completed work: dataset live editing and propagation

Implementation from baseline `c1d3f4f` is complete. Stable dataset identities, typed double-click editing, optimistic versions, full-manifest rollback, linked task/result propagation, archived evidence, PostgreSQL/offline parity, and regression coverage are in place. Do not remove vote-time snapshots: latest display content and evaluated evidence are intentionally separate.

All release gates passed locally: `test:dataset-sync`, `test:arena`, `test:rank-ties`, `lint`, `build`, `server:build`, `test:api:smoke`, and `local:check`. Migrations `006` and `007` are applied. The shared stack is reachable at `http://localhost:3000/` and `http://localhost:8787/`.

The balanced adaptive Arena implementation is complete. Core logic lives in `src/arenaSampling.ts` and `src/bradleyTerry.ts`; deterministic regression coverage is in `scripts/test-arena.ts` and runs through `npm.cmd run test:arena`.

The final release audit ran with Docker Desktop and PostgreSQL available; `local:start`, `local:check`, and `test:api:smoke` passed. Arena configuration and pair metadata still use existing JSON fields; the new migrations are dataset synchronization specific.

Arena-rank weak-order support is also complete. Shared tie-aware logic is in `src/rankingUtils.ts`, insight aggregation is in `src/analysisInsights.ts`, and deterministic coverage is in `scripts/test-rank-ties.ts` via `npm.cmd run test:rank-ties`. The UI now uses rank-sorted media cards and a synchronized tier editor in `src/components/ArenaRankVotingScreen.tsx`; cards can move tiers, merge with the previous rank, split out of ties, and participate in drag/drop. Repeated `rank` values remain in the existing JSON/JSONB payload, so no database migration is required.

The browser regression used an isolated local session and removed it afterward. The shared web, API, and database stack is currently healthy.
