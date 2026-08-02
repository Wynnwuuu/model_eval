# Arena And Arena-rank Handoff

## Completed work: VidMuse direct generation

The ManuEval-only dev implementation is complete on `feature/manueval-aion-generation`. It reads live Aion image/video configuration, runs confirmed cases through a PostgreSQL worker with global concurrency and renewable leases, writes one conflict-safe dataset version, and links into the existing human-evaluation task builder. No Aion code, Redis, PVC, H3-specific workflow, or AI scoring was added.

The current dev mode is `GENERATION_ASSET_MODE=temporary_url`, so generation no longer waits for OSS credentials. Public input URLs pass through, local uploads are disabled, and returned URLs are written directly to the dataset. Shared dev uses the cluster-internal `model_api`; local diagnostics can use the existing Planner-free VidFlow `task_worker` compatibility transport.

A real browser smoke passed on 2026-08-01: `xai/grok-imagine-image`, `720p`, `1:1`, batch `gen-97c0abef-5726-4a87-98c9-a09b94351444`, success 1/1, dataset v4, 1024x1024 result rendered from VidMuse dev CDN. The result column, seed, provider request ID, writeback, reload recovery, and case-ID display were verified. OSS credentials remain a later durability upgrade rather than a blocker.
## Completed work: dataset live editing and propagation

Implementation from baseline `c1d3f4f` is complete. Stable dataset identities, typed double-click editing, optimistic versions, full-manifest rollback, linked task/result propagation, archived evidence, PostgreSQL/offline parity, and regression coverage are in place. Do not remove vote-time snapshots: latest display content and evaluated evidence are intentionally separate.

All release gates passed locally: `test:dataset-sync`, `test:arena`, `test:rank-ties`, `lint`, `build`, `server:build`, `test:api:smoke`, and `local:check`. Migrations `006` and `007` are applied. The shared stack is reachable at `http://localhost:3000/` and `http://localhost:8787/`.

The balanced adaptive Arena implementation is complete. Core logic lives in `src/arenaSampling.ts` and `src/bradleyTerry.ts`; deterministic regression coverage is in `scripts/test-arena.ts` and runs through `npm.cmd run test:arena`.

The final release audit ran with Docker Desktop and PostgreSQL available; `local:start`, `local:check`, and `test:api:smoke` passed. Arena configuration and pair metadata still use existing JSON fields; the new migrations are dataset synchronization specific.

Arena-rank weak-order support is also complete. Shared tie-aware logic is in `src/rankingUtils.ts`, insight aggregation is in `src/analysisInsights.ts`, and deterministic coverage is in `scripts/test-rank-ties.ts` via `npm.cmd run test:rank-ties`. The UI now uses rank-sorted media cards and a synchronized tier editor in `src/components/ArenaRankVotingScreen.tsx`; cards can move tiers, merge with the previous rank, split out of ties, and participate in drag/drop. Repeated `rank` values remain in the existing JSON/JSONB payload, so no database migration is required.

The browser regression used an isolated local session and removed it afterward. The shared web, API, and database stack is currently healthy.

## Completed work: unified generation input mapping

The generation modal now keeps Prompt as a single selector and exposes optional image/audio multiselects. Selected video image columns carry explicit reference/start/end roles; image models treat selected images generically. Only Prompt is selected by default.

Preflight resolves the generation mode independently for every case and preserves strict start/end ordering. Invalid role combinations affect only their case. The persisted mapping contract, generation Worker, URL handling, dataset writeback, and evaluation handoff are unchanged.

Regression coverage is in `scripts/test-generation.ts`. Generation tests, both TypeScript builds, the Vite production build, mobile/desktop browser layout, role interaction, and text-only preflight all pass. No paid generation was submitted in the final verification.
