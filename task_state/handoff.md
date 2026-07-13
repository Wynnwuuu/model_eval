# Arena And Arena-rank Handoff

The balanced adaptive Arena implementation is complete. Core logic lives in `src/arenaSampling.ts` and `src/bradleyTerry.ts`; deterministic regression coverage is in `scripts/test-arena.ts` and runs through `npm.cmd run test:arena`.

Before release, start Docker Desktop and rerun `npm.cmd run local:start`, `npm.cmd run local:check`, and `npm.cmd run test:api:smoke`. No Arena-specific API or database migration is required because configuration and pair metadata remain JSON fields.

Arena-rank weak-order support is also complete. Shared tie-aware logic is in `src/rankingUtils.ts`, insight aggregation is in `src/analysisInsights.ts`, and deterministic coverage is in `scripts/test-rank-ties.ts` via `npm.cmd run test:rank-ties`. The UI uses stable media cards plus a tier editor in `src/components/ArenaRankVotingScreen.tsx`. Repeated `rank` values remain in the existing JSON/JSONB payload, so no database migration is required.

The browser regression used an isolated local session and removed it afterward. The web app is currently reachable at `http://localhost:3000/`; API/database smoke verification still requires Docker Desktop and the shared local stack.
