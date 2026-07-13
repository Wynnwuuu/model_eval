# Arena Handoff

The balanced adaptive Arena implementation is complete. Core logic lives in `src/arenaSampling.ts` and `src/bradleyTerry.ts`; deterministic regression coverage is in `scripts/test-arena.ts` and runs through `npm.cmd run test:arena`.

Before release, start Docker Desktop and rerun `npm.cmd run local:start`, `npm.cmd run local:check`, and `npm.cmd run test:api:smoke`. No Arena-specific API or database migration is required because configuration and pair metadata remain JSON fields.
