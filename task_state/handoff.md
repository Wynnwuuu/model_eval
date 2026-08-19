# Arena And Arena-rank Handoff

## Current work: result insight export consolidation

Implementation and local validation are complete on the existing `codex/owner-magic-access` worktree from `main@84d9f855`. Result insights now expose one lazy-generated Excel workbook plus one reviewer-level detail CSV for every formal method; Arena-rank and A/B evidence JSON include stable case identities, and Arena-rank includes nested ballots, snapshots, aggregate ranking, Borda, tie, and agreement evidence. Archived audit CSV, HTML snapshot, external CSV import, and the data template remain separate.

The shared implementation is `src/insightExports.ts`; focused regression coverage is `scripts/test-insight-exports.ts`. Vote creation and dataset synchronization now reuse the same `taskItemSnapshot` builder so `itemOrder` cannot produce a false content-update audit. ExcelJS 4.4.0 is a browser-only dynamic chunk, and only its uuid child is overridden to 11.1.1 to remove the new dependency audit finding. No database migration or server API change was added.

All requested insight/rank/task/model-feedback tests, TypeScript, frontend/server builds, and diff checks pass. A real offline browser session downloaded and parsed the five-sheet Arena-rank workbook, two-row UTF-8-BOM CSV, and schema-v2 JSON; forced download failure displayed an alert and a retry succeeded; 390x844 had three wrapped toolbar rows and no horizontal overflow. The isolated fixture and downloads were removed. The final release commit is recorded in git history; no deployment or production-data mutation was performed.

## Current work: per-case model reveal and per-model feedback

Implementation and full local validation are complete on `codex/model-feedback-reveal`, based on `main@40dddc7`. Formal A/B, Pairwise, Arena-rank, MOS, and Rubric flows now reveal actual model names only after the first durable save, retain editable per-model notes before and after submit, and use the original submit slot for `下一题` / `查看结果`. Skip and Benchmark Preview remain direct-advance paths. Ordinary re-evaluation is preserved.

Persistence reuses `rubricResponses` / `rubric_responses_json`; no migration, public API, dependency, or external service was added. Insights include a model feedback summary above case evidence and raw per-case reviewer records include corresponding notes. All deterministic and database `test:*` scripts, lint, frontend/server builds, enhanced PostgreSQL API smoke, 24 Chromium E2E tests, mobile overflow verification, and diff checks pass against an isolated disposable PostgreSQL container.

## Current work: evaluation material case selection

Implementation and local verification are complete on the current worktree. `TaskBuilderScreen` now exposes a bounded case-scope table with case-ID/dimension filters, explicit selection actions, invalid-output diagnostics, and first-selected-case preview. `task.models` derives only from selected output columns; the legacy manual Model A/Model B editor is removed.

New dataset-backed tasks persist `datasetBinding.includedDatasetItemIds`. `planDatasetTaskSync` applies inclusion before exclusion for additions, so new dataset cases do not enter fixed-scope tasks; tasks without the field retain legacy dynamic additions. Deterministic coverage is `npm.cmd run test:task-case-selection` plus the extended dataset sync suite.

All requested tests pass after restarting a stale local API process. The local stack is healthy at `http://localhost:3000/` and `http://localhost:8787/`. No task or dataset was created during browser QA, and no release or push was requested.

## Current work: Aion HTTP 500 classification and queue recovery

Implementation and local validation are complete on `codex/aion-500-fix`, based on GitHub main `9a44def`. Received HTTP errors now become `failed` and retain bounded safe Aion detail; only transport failures without an HTTP response remain `submission_unknown`. Both are capacity-neutral, while explicit 429/concurrency/queue/rate-limit feedback still controls optimistic waves.

Policy v5 resets old capacity state to window 8. Migration `013_generation_aion_http_errors.sql` reclassifies only historical `submission_unknown` rows with HTTP 5xx and no provider task ID, leaves genuine uncertainty untouched, and never resubmits terminal items. The task center labels explicit Aion errors separately from no-response uncertainty.

First-rollout browser QA also exposed an existing deep-link race: a fast batch response selected its dataset before the asynchronous dataset list arrived, then the generation workspace cleared that selection and failed to reopen the modal after refresh. The follow-up guards selection clearing until the dataset list is non-empty and has deterministic coverage.

Generation unit/PostgreSQL tests, TypeScript, dataset sync/clone/import/filter, Arena, rank ties, frontend/server builds, migration, and Worker-disabled API smoke pass. Commits `c5c5c3a` and `93fd2fd` are on GitHub main; both Test and Dev CI/CD runs succeeded. Public-dev refresh verification passed with no console warnings or errors. The referenced batch had already drained to 32 terminal failures before deployment, so there was no pending case to submit after the fix and no paid smoke batch was created.

## Current work: generic adaptive video capacity control

Implementation and local validation are complete on `codex/adaptive-video-capacity`, based on GitHub main `62f857d`. Normal video scheduling uses persistent buckets keyed by Aion model configuration ID plus `generation_type`, starts unknown buckets at two, and learns provider in-flight capacity independently from RPM. The platform window follows 12, 24, 48; bucket slow start follows 2, 4, 8, 16, 32, 48 with one unverified probe at a time. Explicit `groupId` is the only warm-start bridge.

Video execution now has two submit workers and six poll workers. Aion error headers and structured codes feed capacity classification; deterministic failures are excluded, ambiguous POST outcomes are never retried automatically, and cross-bucket availability evidence is required before shrinking the platform window. Policy version 3 synchronizes at Worker startup and before queue snapshots, then starts ten minutes of shadow mode before existing pending work is admitted adaptively; `GENERATION_VIDEO_ADAPTIVE_ENABLED=false` immediately restores the old global-eight/model-override scheduler without changing active task IDs.

Migration `012_generation_adaptive_capacity.sql`, queue API detail, and expandable task-center capacity rows are included. Generation simulations, PostgreSQL dual-worker tests, all relevant dataset/Arena suites, API smoke, TypeScript, server and frontend builds, and 1280x720/390x844 browser checks pass. Main now ends at `0c12ce0`; Test run `31383573140` and Dev CI/CD run `31383573640` succeeded. The final PostgreSQL regression proves a stale policy row becomes version 3 with a fresh ten-minute shadow deadline even when no case is pending. No Aion generation request or paid batch was created.

## Current work: generation input reliability hardening

Implementation and local validation are complete. Scalar media URLs no longer split on spaces, URL spaces normalize to `%20`, exact VidMuse preset parameters cannot disappear silently, and deterministic role/type/public-host findings are available per case. Risk-only confirmation remains distinct from manual Aion JSON override, and bulk review cannot make a final-JSON-required case valid.

The real imported 188-row QA dataset passed a GET-only dry-run with zero request-build failures, zero normalized whitespace, zero MCP/Aion projection differences, and no generation POST. A second model contract exposed all unsupported non-empty preset parameters explicitly. The as-built contract and exact statistics are in `docs/manueval-vidmuse-mcp-video-input-contract-review.md`.

All deterministic, isolated PostgreSQL, API smoke, TypeScript/build, and desktop/mobile browser checks pass without paid generation. Source commit `0047b7c` is on GitHub main; test run `31248453876` and dev run `31248453941` succeeded. Authenticated public health and the 63-model list both returned HTTP 200 with `model_api` and the Worker enabled. Preserve and exclude the unrelated untracked technical report and `docs/report-assets/`.

Local housekeeping: a worker-disabled API used for final smoke is still listening on port 8789. The process guard refused automatic termination because the command line resolves through the sibling worktree's shared `node_modules`; it cannot claim generation work but should be closed after explicit owner confirmation.

## Current work: Seed v2 and MCP/Aion request layering

The implementation and local validation are complete. New generation preflights default Seed to `unused`, expose it only when exact live `supported_params` contains `seed`, and reject unsupported or `task_worker` Seed instead of silently dropping it. Enabled Seed is an Aion extension at `extra_params.seed`, never part of VidMuse MCP input.

Every new case now audits source intent, normalized MCP tool input, derived `generation_type`, and final Aion JSON separately. Normal requests must pass a value-and-order projection check; reviewed forced overrides retain the diff and remain outside the MCP guarantee. The as-built contract is `docs/manueval-vidmuse-mcp-video-input-contract-review.md`.

All deterministic suites, isolated PostgreSQL generation/API tests, builds, and desktop/mobile browser checks pass. Commit `4063e63` is on GitHub main; test run `31243023889` and dev run `31243023947` succeeded, and public authenticated generation health is ready on `model_api`. No batch or paid generation was submitted. No release action remains for this feature.

## Current work: independent dataset copies

Dataset cloning is implemented on the latest ManuEval baseline. The repository can clone the current dataset or the historical version currently being viewed. Shared API and offline localStorage semantics match: new dataset/item identities, v1 reset, visible provenance, copied business content, and no linked task/vote/generation history.

Core logic is in `src/datasetClone.ts`, server persistence is in `server/datasets/datasetRepository.ts`, the route is `POST /api/datasets/:datasetId/clone`, and repository interaction is in `src/components/DatasetRepositoryScreen.tsx`. Deterministic coverage is available through `npm.cmd run test:dataset-clone`; the API smoke now covers validation and source isolation.

Browser verification covered current v2 and historical v1 copies, automatic unique naming, editable names, refresh persistence, source display, independent case deletion, and 390x844 layout. No database migration or production-workbench entry was added.
## Completed work: VidMuse stable generated assets

ManuEval dev now consumes Aion `local_path`/`file_path` results and emits trusted VidMuse image/video CDN URLs for the dedicated evaluation user. Provider URLs remain audit metadata and per-case fallback only. No Aion, VidMuse upload, OSS credential, or schema change is required.

The UI distinguishes VidMuse stable assets, temporary fallback links, and future ManuEval OSS assets. Local tests, builds, PostgreSQL/API smoke, desktop/mobile layout, inline video playback, Range support, and clean browser console all pass. The remaining release action is main push, CI/dev rollout, and one lowest-cost short-video generation without automatic paid retry.


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

## Completed work: generation case selection and same-column fill

Generation now supports explicit per-case selection in step 2 and later filling the same output column without overwriting completed rows. Shared selection/target validation is in `src/features/generation/caseSelection.ts`; the UI table is `src/components/GenerationCaseSelector.tsx`; server canonicalization lives in `server/generation/generationPreflightService.ts`.

All requested automated gates and browser regressions passed. Docker Desktop, PostgreSQL, the local web app, and the API were healthy at the end of validation. Browser preflight calls were intercepted only for UI verification because local Aion model configuration is absent, and no paid generation was submitted.
## Completed work: schema-driven dataset repository columns

The repository wide table now follows saved schema order and exposes every business field, including all reference images, videos, audio, additional inputs, and metadata. System fields default to hidden but can be enabled from the per-dataset column manager; preferences survive reload. Legacy row-only fields are appended, internal trace keys stay hidden, and the case ID remains sticky and non-hideable.

Media requests are one-shot lazy mounted against the horizontal table viewport. Deterministic projection coverage lives in `scripts/test-dataset-table-columns.ts`. All requested dataset tests, lint, production build, desktop/mobile browser regression, local stack health, and API smoke passed. The shared app and API are available at `http://localhost:3000/` and `http://localhost:8787/`.

## Completed work: reference video and audio-follow duration

The generation modal now supports simple reference-video columns or mutually exclusive Raw elements JSON, plus uniform, column, and reference-audio duration sources. Live-model contracts drive field compilation; Hailuo H3 compiles videos to ordered `elements[].video_url`. Audio metadata probing is browser-only and the server verifies per-case audit data before producing final controls.

No schema migration, Aion change, OSS activation, or paid generation was used. All generation/database/dataset/Arena/API tests, TypeScript checks, both builds, and live H3 desktop/mobile browser preflight passed on the latest main baseline. The live browser request demonstrated one valid 6.391s-to-7s case and one isolated multi-audio invalid case.

## Completed work: VidMuse MCP input contract

New generation preflights default to a VidMuse MCP mapping mode and compile standard video/image fields into the existing Aion unified API. Assisted mapping remains available and historical snapshots remain compatible. Structured JSON datasets, per-case mixed modes, model-profile constraints, prompt-token validation, explicit keyframe fallback, compiler audit, and final request preview are implemented without a database migration or Worker/writeback changes.

All non-database generation, dataset, Arena, TypeScript, production-build, and desktop/mobile browser gates pass. Docker/PostgreSQL was unavailable for the final database/API rerun; this feature does not change persistence, queue, or route behavior. No paid generation was submitted.
# 2026-08-14: Evaluation storage root fix

- Active branch: `codex/project-blank-fix`, clean baseline `c93a71b` before implementation.
- Root cause: `ModelEvalApp` writes complete `items + votes` into `modeleval_session` on each progress change and complete history arrays into `modeleval_history`; quota exceptions escape React effects and remove the route UI.
- Approved fix: versioned IndexedDB migration with raw backups, server-source shared tasks, minimal Arena checkpoints, revisioned offline sessions, per-session history, route isolation, and real Chromium quota coverage.
- Do not revert project commits `2beaa03` or `c93a71b`. Do not restore legacy whole-session writes in a rollback.
