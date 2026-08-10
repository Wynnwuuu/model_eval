# Arena Implementation Progress

## 2026-08-10: Generic adaptive video capacity control

### Completed

- Replaced normal-path video model-name limits with persistent capacity buckets keyed by Aion model configuration ID and `generation_type`; explicit `groupId` is the only warm-start bridge.
- Added a versioned controller with a 48 hard ceiling, platform window growth through 12, 24 and 48, cold bucket window 2, slow start, one-at-a-time probes, additive recovery after congestion, independent RPM throttling, timeout clustering, cooldowns and circuit breakers.
- Added a ten-minute shadow period and an immediate `GENERATION_VIDEO_ADAPTIVE_ENABLED=false` rollback to the existing global-8/model-limit scheduler.
- Split video execution into two submit workers and six poll workers. Existing provider tasks keep their IDs and are polled without consuming new-submission probes.
- Captured Aion error type/code/retryability/Retry-After metadata, while preserving the existing no-auto-resubmit rule for ambiguous POST outcomes.
- Added migration `012`, seven-day capacity history replay, config/idle decay, queue API detail and expandable task-center rows for each generation mode.
- Kept image concurrency at four and left Aion, VidMuse, MCP, assets, writeback and human-evaluation contracts unchanged.

### Validation

- Deterministic provider simulations converge at capacities 1, 5, 20 and 48 for a provider capacity of 100 without exceeding the hard ceiling.
- `test:generation` and `test:generation:db` pass, including shadow fallback, atomic cold-start/RPM gating, two-worker contention, generation-mode isolation, organization/dataset fairness and polling priority.
- Dataset sync/import/deletion/filter, Arena, rank-tie, API smoke, TypeScript, server build and frontend build pass.
- Browser QA passed at 1280x720 and 390x844. Capacity rows expand by generation mode, and mobile document overflow is zero with local horizontal scrolling for wide details.
- No Aion generation request or paid task was created during implementation or verification.

### Release

- Commits `a5514b8`, `fa9a691`, and `0c12ce0` reached `world-sim-dev/ManuEval` main without force-pushing. Version 3 synchronizes policy state at Worker startup and before queue snapshots, forcing a fresh ten-minute shadow period even when no case is pending.
- Final Test run `31383573140` and Dev CI/CD run `31383573640` succeeded, including migration, PostgreSQL generation integration, API smoke, image build, and Kubernetes rollout.
- Before the final startup synchronization fix, dev UI verification exposed the stale-policy display and confirmed the queue had naturally drained to zero active/pending video cases. The browser security policy later blocked a refresh-only recheck, so the shadow reset is covered by the deterministic database regression rather than a second UI assertion.
- No Aion generation request, retry, or paid batch was created during implementation or release.

## 2026-08-08: Structured evaluation Base import and audit

### In progress

- Added a preserved-source import path that keeps the Feishu Base's 16 visible columns, names, ordering, and values while storing record identity and source hashes only in hidden metadata.
- Fetched the `cases / Grid View` source twice and verified a stable 188-record snapshot: `sha256:00381745e0a61b29f665bd8ee031ec04ff9ecb7e85d5b20b8c7fcbf638530b34`.
- Added deterministic MCP/Aion dry-run auditing and evaluated 63 live image/video configurations across all modality-matching cases. The audit made 7,952 compiler evaluations and zero generation POST requests.
- Added media probing and per-case quality checks. The corrected run deduplicated 169 media references; 162 were HTTP reachable and 160 decodable. Findings remain separate from the immutable source dataset.
- Focused regression tests for source preservation, compatibility classification, and quality rules pass. Repository-wide regression, dev import, final report publication, and release validation remain pending.

## 2026-08-05: Generation task center and fair scheduling (implementation complete)

- Isolated clone: `ManuEval-generation-task-center`, branch `agent/generation-task-center`, based on `origin/main` at `e874eb7`.
- Preserved the original dirty `main` worktree without modifying or stashing it.
- Added an organization-wide paginated generation task center with status, dataset, model and creator filters, queue capacity, deep links, and Overview/dataset-history entry points.
- Added dataset-then-batch max-min submission scheduling while preserving polling priority and global image/video limits (4/2).
- Added atomic pending skip, failed-case acknowledgement, selective retry child batches, duplicate-billing confirmation, audit events and organization isolation.
- Retry children can execute early but wait for parent writeback, then fill only empty source cases without replacing prior results.
- Existing batch detail no longer depends on live model configuration; new generation and retry preflight still re-read live Aion configuration.
- No Aion, VidMuse, plugin, OSS or production-environment code was changed, and no paid generation was submitted during verification.

### Validation

- `npm.cmd run lint`
- `npm.cmd run test:generation`
- `npm.cmd run test:generation:db`
- `npm.cmd run test:api:smoke` against isolated API port 8788 with the generation worker disabled
- Dataset sync, clone, import mapping, column deletion and table-column tests
- Arena and rank-tie tests
- `npm.cmd run server:build`
- `npm.cmd run build`
- Playwright desktop/mobile checks for task list, creator filter, batch selection, Overview deep link and refresh recovery

### Release

- Confirmed GitHub `main` is still `e874eb7`, so no rebase was required.
- The complete post-sync regression passed; release uses a non-force push to `world-sim-dev/ManuEval` `main`.


## 2026-08-05: Independent dataset copies

- Added independent dataset copies for the current dataset or any immutable historical version.
- Copies preserve business rows, original data, schema, mappings, Dataset Card, generated media URLs, and metadata while regenerating dataset/item identities.
- Copies start at v1 with visible provenance and do not inherit projects, tasks, votes, generation jobs, synchronization summaries, or source version history.
- Shared PostgreSQL/API and offline localStorage paths use the same pure clone builder.
- The repository dialog suggests collision-aware names, supports edits, and automatically selects the new copy after creation.

### Validation

- Passed deterministic clone coverage and the extended API smoke for specified-version cloning, validation errors, source isolation, and clone edits.
- Browser regression passed for current v2 and historical v1 copies, persistence after refresh, provenance display, regenerated internal IDs, and mobile 390x844 layout.
- Deleting a case from the historical copy advanced only that copy to v2; the source remained unchanged at v2 with three cases.
## 2026-08-03: VidMuse stable generated assets

- ManuEval now prefers Aion-materialized user assets over expiring provider URLs in `temporary_url` mode.
- Only paths owned by `AION_EVAL_USER_ID` under the expected `assets/images` or `assets/videos` directory are converted to the configured VidMuse CDN.
- Missing, cross-user, wrong-media, traversal, and unknown paths fall back per case to the provider URL without exposing the local path.
- Batch items expose `vidmuse_asset`, `temporary`, or `manueval_oss` durability. Dataset result cells keep only the selected URL; audit metadata keeps the provider URL and durability.
- The execution modal shows a fallback warning only when a successful case actually used a temporary URL.

### Validation

- Passed generation, TypeScript, server build, production build, PostgreSQL generation, dataset sync/import, Arena, rank-tie, and API smoke suites.
- Browser verification passed at 1280x720 and 390x844 with no horizontal overflow or console errors.
- The stable video reached `readyState=4` and returned HTTP 200, `video/mp4`, `Accept-Ranges: bytes`, and no `Content-Disposition`.
- The isolated browser dataset/job was removed. A paid dev generation smoke remains the post-deploy acceptance step.

## 2026-08-01: no-OSS browser smoke complete

- Enabled `GENERATION_ASSET_MODE=temporary_url`: no OSS credentials are required, local uploads are disabled, and the returned media URL is written directly to the dataset.
- Added a local `task_worker` execution transport for diagnostics when the Aion ClusterIP and runner JWT are unavailable. It bypasses Planner, forwards standard image/video parameters, and maps VidFlow results to the existing VidMuse CDN.
- Completed a real browser smoke with `xai/grok-imagine-image`, `720p`, `1:1`: batch `gen-97c0abef-5726-4a87-98c9-a09b94351444` succeeded 1/1, wrote dataset v4, and rendered the 1024x1024 image.
- Fixed generated `*_request_id` columns being misclassified as the case-ID column and added a regression assertion.
- Shared dev remains on `AION_EXECUTION_TRANSPORT=model_api`; the local task-worker path is not the deployment executor. OSS archival and stable ManuEval capability URLs remain a later durability upgrade.

## VidMuse direct generation integration (complete)

- Branch: `feature/manueval-aion-generation` from `c3bbd53`.
- Scope stayed inside ManuEval dev: no Aion deployment/code changes, VidMuse CLI runtime, Redis, PVC, H3-specific logic, or AI scoring.

### Completed

- Replaced the browser mock executor with a three-step production modal backed by Aion live image/video model configuration, flexible schema-derived mappings/controls, explicit preflight, configuration fingerprinting, conservative cost display, and duplicate-billing acknowledgement.
- Added PostgreSQL preflights, idempotent batch creation, per-case state, global advisory-lock concurrency, renewable leases, restart recovery, cancellation gating, `submission_unknown` handling, and a separate recoverable writeback lane.
- Added browser-to-OSS single/multipart upload, relative-path/file-name matching, ownership checks, SSRF-safe public-material archival, streaming byte limits, output archival, and stable capability URLs.
- Added one-version stable-ID dataset writeback, conflict detection, companion metadata columns, retry preflights, and the existing evaluation-task shortcut with dataset/result-column prefill.
- Added dev-only Aion/OSS deployment variables, required-secret checks, migration `008`, the backend contract, and CI coverage for deterministic and live-PostgreSQL generation tests.

### Validation

- Passed: `npm.cmd run lint`, `npm.cmd run server:build`, `npm.cmd run build`, `npm.cmd run test:generation`, `npm.cmd run test:generation:db`, `npm.cmd run test:dataset-sync`, `npm.cmd run test:arena`, `npm.cmd run test:rank-ties`, and `npm.cmd run test:api:smoke`.
- PostgreSQL migration `008_generation_execution.sql` applied locally. Integration tests cover two-worker claiming, global capacity, lease renewal, cancellation after claim, ambiguous-submission non-retry, terminal writeback, and crash reconciliation without duplicate versions.
- Browser: live-config-shaped fake Aion model rendered all three modal steps; preflight returned 2/2 valid cases and a 10-credit upper bound. Desktop and 390x844 mobile passed with no horizontal overflow. The only console error is the pre-existing missing `favicon.ico`.
- Configured GitHub Actions secrets for the real dev Aion ClusterIP base URL and dedicated numeric evaluation user. The public base URL now falls back to the existing Feishu callback origin.
- Local direct discovery is live against the admin gateway: `/api/generation/models` returns the CLI-aligned 17 image and 44 video models, including `seedance-2.0-pro` and `minimax/hailuo-h3`. Twenty-nine disabled history/test configs are excluded; no paid generation was submitted.
- Real dev OSS smoke remains an environment acceptance step because least-privilege OSS RAM credentials, bucket authorization, and CORS still require an administrator.
- No-OSS model smoke passed through the authenticated VidMuse CLI/Planner path. Thread `a6d205b6-8d1a-4594-b494-fc2b0c81bad1` invoked `xai/grok-imagine-image` once and produced asset `asset-8e0313c0ff0b90c0` (`model_request_id=ff0bea03-4c05-4d36-8299-b99775db570a`). The downloaded JPEG is 1024x1024 and 152,334 bytes at `task_state/smoke-generation/grok-imagine-image-red-teapot.jpg`.
- The smoke also confirmed why the CLI/Planner path is not the batch-evaluation runtime: it added Planner work and changed the requested `720p` resolution to the model default `1080p`. Direct Aion execution remains necessary for exact parameter control, while OSS is still required for durable batch archiving and dataset writeback.

## Dataset live editing and propagation (complete)

- Baseline confirmed at `c1d3f4f`, matching `origin/main`.
- Scope locked: per-field immediate versions, editable case data and Dataset Card, forced latest-content propagation with immutable evaluated snapshots.
- Validation gate: deterministic dataset sync tests first, followed by API, TypeScript, build, existing Arena suites, and browser regression.

### Completed

- Added stable dataset item identities, explicit task bindings, lifecycle-aware draft/active/completed synchronization, conservative legacy matching, and column-rename detection.
- Added typed double-click editing for all visible and inspector case fields plus editable Dataset Card fields. Every real change creates a version; stale edits and rollbacks return `409`.
- Added full version manifests, rollback propagation, archived task items/votes, progress recomputation, restored-case re-voting, immutable evaluated snapshots, and latest-content result projection.
- Added separate archived evidence export so deleted cases remain auditable without entering current statistics.
- Added PostgreSQL migrations `006` and `007`, shared/offline parity, deterministic synchronization tests, and expanded API smoke coverage.

### Final validation

- `npm.cmd run test:dataset-sync`, `test:arena`, `test:rank-ties`, `lint`, `build`, `server:build`, `test:api:smoke`, and `local:check`: passed.
- PostgreSQL migrations `006` and `007`: applied successfully against the local shared database.
- Browser: desktop double-click edit/version creation, JSON validation/cancel, rollback/sync summary, internal-ID hiding, and 390x844 responsive layout passed. Temporary data and Playwright artifacts were removed.
- Remaining build output is limited to the pre-existing Vite mixed-import and chunk-size warnings.

## Completed

- Added `arena_sampled` while retaining `all_pairs` and `adjacent_pairs` compatibility.
- New Arena tasks keep one item per case with every model output; reviewer-specific assignments are created at runtime.
- Added deterministic coverage-first and adaptive 85/15 scheduling, stable left/right placement, missing-output filtering, assignment restoration, and one-case-per-reviewer protection.
- Added soft reviewer targets, early result access, continued contribution, and result-page model reveal.
- Added inverse-propensity weighted Bradley-Terry Arena Scores, symmetric weak regularization, sandwich confidence intervals, rank ranges, and disconnected-graph protection.
- Added Arena leaderboard, exposure and pair coverage diagnostics, dimension analysis, observed battle evidence, and summary/matrix/raw/case CSV exports.
- Added new raw Arena CSV import support with per-vote item snapshots so multi-model media links remain exact.

## Validation

- `npm.cmd run test:arena`: passed, including 3/5/10 models, determinism, graph coverage, exposure balance, left/right balance, missing outputs, tiny-sample regularization, propensity weights, disconnected graphs, legacy choice-only votes, and CSV fields.
- `npm.cmd run lint`: passed.
- `npm.cmd run build`: passed; only the existing Vite chunk-size/dynamic-import warnings remain.
- Browser: passed a full 3-model flow and 5/10-model smoke checks. Soft targets, blindness, assignment metadata, refresh restoration, early finish, continue contribution, and connected/disconnected result states were verified. Browser console had zero errors and warnings.
- `npm.cmd run local:check`: web app passed at `http://localhost:3000/`; API failed because no process is listening on port 8787.
- `npm.cmd run test:api:smoke`: blocked by the same unavailable local API. `local:start` previously reported Docker Desktop was not reachable.

## Arena-rank Weak-order Ties

### Completed

- Added complete weak-order ranking with competition numbering, multiple tie groups, all-tied ballots, stable anonymous media positions, and a separate tier editor for desktop/mobile.
- Added merge, split, tier drag, arrow movement, one-click all-tied, and reset-to-singleton controls without changing media positions or blind model identity.
- Added average mid-ranks, tie-adjusted Borda, per-ballot normalized Borda, outright/co-first counts, fractional first-place credit, and tie participation rates.
- Added pairwise win/tie/loss expansion, dominance with ties worth 0.5, decisive-only Wilson/sign tests, Kendall tau-b, relation agreement, and distinction rate.
- Updated result insights, case evidence, dimension aggregation, team analysis, history, CSV import/export, pairwise export, and legacy task normalization.
- Added strict CSV ranking validation when the expected task model set is known; `ranking_json` remains the round-trip authority.

### Validation

- `npm.cmd run test:rank-ties`: passed, including strict rankings, multiple tie groups, all ties, score conservation, normalized Borda, pairwise conservation, significance exclusion, tau-b boundaries, missing outputs, validation, and JSON round trips.
- `npm.cmd run test:arena`: passed; sampled Arena and Bradley-Terry behavior is unchanged.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run server:build`: passed.
- Browser: passed mobile drawer and desktop tier editor flows, merge/split/all-tied/drag, direct all-tied submission, full-media contain, and tie-aware insight rendering. Temporary browser data was removed after the run.
- `npm.cmd run local:check`: web app passed at `http://localhost:3000/`; API remains unavailable because Docker Desktop/PostgreSQL is not running locally.
- `npm.cmd run test:api:smoke`: attempted and failed with `ECONNREFUSED` for the same unavailable API; no rank-specific API or schema migration is required.

## Arena-rank Rank-sorted Media Interaction

### Completed

- Changed Arena-rank media display to use `rankTiers` as the single source of truth, so the image/video order now follows the current rank order.
- Restored direct media-card controls for moving a candidate up/down, merging with the previous rank, and splitting an item out of a tie group.
- Kept the desktop side tier editor and mobile bottom drawer synchronized with the media board.
- Added drag/drop source tracking through `dataTransfer` plus a ref fallback so card/tier drag operations update the same rank state as the buttons.

### Validation

- `npm.cmd run test:rank-ties`: passed.
- `npm.cmd run test:arena`: passed.
- `npm.cmd run lint`: passed.
- `npm.cmd run build`: passed; only the existing Vite dynamic-import and chunk-size warnings remain.
- Browser: passed desktop card move, merge, split, standard drag/drop event dispatch, mobile viewport, bottom drawer, tied submission, and result insight rendering. Temporary localStorage test session/history were removed.
- `npm.cmd run local:check`: web app passed at `http://localhost:3000/`; API failed because no process is listening on `http://localhost:8787` and Docker Desktop daemon is not running locally.

## Arena-rank Responsive Media Grid

### Completed

- Replaced the full-width per-tier media sections with a single rank-ordered responsive media grid.
- Preserved the current card/media size while allowing the number of cards per row to adapt to available browser width.
- Kept tied candidates adjacent in rank order with shared "并列第 N 名" labels and tie-group context.

### Validation

- `npm.cmd run lint`, `npm.cmd run test:rank-ties`, `npm.cmd run test:arena`, and `npm.cmd run build`: passed.
- Browser: at 1920px width, five test candidates rendered as four cards on the first row and one on the second, with cards around 360x360; at 390px width, cards rendered as a single-column stack. Tied candidates remained adjacent in the same row when width allowed.

## 2026-08-02: Unified generation input mapping

### Completed

- Replaced separate start-frame/end-frame selectors with one optional image-column multiselect while retaining the existing persisted mapping shape.
- Added per-column reference/start/end roles, semantic role inference, live model-role constraints, and empty-by-default image/audio mappings.
- Added per-case text, reference-image, start-frame, and start/end-frame mode resolution with strict conflict and ordering checks.
- Kept image generation generic and preserved the existing Worker, temporary URL/OSS, writeback, and human-evaluation flows.
- Fixed mapping initialization so parent object identity changes cannot erase an in-progress user selection.

### Validation

- `npm.cmd run test:generation`, `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run server:build`: passed.
- Browser: Seedance 2.0 Pro exposed reference/start/end roles, role changes persisted, empty media input produced a valid `text_to_video` preflight, and image/audio defaults remained empty.
- Browser: 390x844 and 1280x720 layouts had no modal or input-panel horizontal overflow; console logs were empty.
- No paid generation was submitted during this regression pass. Existing Vite mixed-import and chunk-size warnings remain unchanged.

## 2026-08-04: Generation case selection and same-column fill

### Completed

- Added explicit new-column and fill-existing target modes with modality, prior-model, fingerprint, completion, and legacy-audit checks.
- Added a searchable case selector with stable-ID selection, filtered tri-state selection, select-all/clear actions, target-filled row protection, batch-limit feedback, and lazy media mounting.
- Canonicalized selected case IDs in dataset order, persisted target/selection audit data, and exposed the server batch limit through generation health.
- Kept legacy omitted selections as full-dataset requests while rejecting explicit empty, unknown, duplicated, or ambiguous stable-ID selections.
- Added PostgreSQL coverage for two-case writeback, a later third-case fill, unchanged earlier results, no metadata on unselected rows, one output schema entry, overwrite conflict protection, and invalid-case exclusion.

### Validation

- `npm.cmd run test:generation`: passed.
- `npm.cmd run test:generation:db`: passed against Docker PostgreSQL.
- `npm.cmd run test:dataset-sync`: passed.
- `npm.cmd run test:arena`, `test:rank-ties`, `test:dataset-import-mappings`, and `test:dataset-column-deletion`: passed.
- `npm.cmd run test:api:smoke`: passed.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run server:build`: passed. Existing Vite mixed-import and chunk-size warnings remain.
- `npm.cmd run local:check`: web, API, and database health passed.
- Browser: passed default/full/partial/empty selection, filtered header selection, batch-limit disabling, preflight summary, back-navigation persistence, fill-existing exclusion, request payload audit, and 390px horizontal containment. UI-only API route mocks were used because local Aion model configuration is intentionally absent; no generation was submitted.
## 2026-08-05: Schema-driven dataset repository columns

### Completed

- Replaced the fixed ID/prompt/dimension/output/two-reference table with an `inputSchema`-ordered projection.
- Defaulted all business roles to visible and `system` roles to hidden while keeping the case ID first and locked visible.
- Appended valid legacy row-only columns, excluded trace/internal keys, and prevented duplicate projections.
- Added per-dataset localStorage visibility preferences with grouped controls, show-all, and reset-default actions.
- Added one-shot IntersectionObserver media mounting so off-screen horizontal media columns do not create requests.
- Moved the column manager into a document-level portal after browser QA found the right inspector could intercept its controls at 1280px.

### Validation

- `test:dataset-table-columns`, dataset import/deletion/sync tests, and `lint`: passed.
- `build`: passed outside the restricted sandbox; only existing mixed-import and chunk-size warnings remain.
- Browser: 17/18 default columns, 10 reference columns, delayed media mounting, persistent system-column override, reset-default, 1280px interaction, and 390x844 containment passed.
- `local:start`, `local:check`, and `test:api:smoke`: passed with the web app, API, and PostgreSQL healthy after starting Docker Desktop.

## 2026-08-05: Reference video and audio-follow duration

### Completed

- Added an explicit reference-video/Raw-elements input area. Simple video columns compile through verified live model contracts; Hailuo H3 uses `elements[].video_url`, explicit array/single fields remain model-driven, and Raw elements stays available for advanced `@ElementN` prompts.
- Added uniform, dataset-column, and reference-audio duration sources. Browser metadata probes are HTTP(S)-only, deduplicated, cached, concurrency-limited, timed out, and cancelled when model/mapping/selection changes.
- Recomputed audio duration per case on the server, including mode-specific duration options, 0.15-second codec-tail snapping, upward discrete selection, continuous millisecond precision, and per-case audit snapshots.
- Preserved old mappings, preflights, jobs, Worker behavior, stable assets, writeback, and human-evaluation handoff without a database migration.
- Fixed live `required_inputs` validation so resolved standard controls such as duration and resolution satisfy the model contract.

### Validation

- `test:generation`, `test:generation:db`, `test:dataset-sync`, `test:dataset-import-mappings`, `test:dataset-column-deletion`, `test:dataset-table-columns`, `test:dataset-clone`, `test:arena`, `test:rank-ties`, and `test:api:smoke`: passed on latest `origin/main`.
- `lint`, `server:build`, and `build`: passed; only existing Vite mixed-import and chunk-size warnings remain.
- Browser: live Hailuo H3 config exposed video-column/Raw-elements modes and all three duration sources. A 6.391-second reference audio resolved to 7 seconds; one valid and one multi-audio invalid case were isolated correctly, and the request/response snapshots contained stable item IDs, duration audit, and `elements[].video_url`.
- Browser: 1440x900 and 390x844 layouts had no horizontal overflow. A fresh page had zero console errors. The confirmation button stayed disabled and no paid generation was submitted.

## 2026-08-05: Fair scheduler and adaptive video capacity

- Captured the live dev queue before deployment, including both in-flight provider task IDs and the previously starved Wan batch.
- Replaced creation-time tie breaking with organization, dataset, and batch max-min rotation using active load, never-served priority, and least-recently-served timestamps.
- Raised the video hard limit to 8 and added strict JSON model limits: Wan 2-6, Hailuo H3 2-8, Seedance 2.0 Fast/Pro 2-8, and unknown video models 2-4.
- Added a 24-hour, last-12-valid-outcome adaptive policy with 30% and 60% capacity-failure thresholds and a 10-second cache.
- Counts leased pending submissions toward global and model occupancy so concurrent workers and rolling deployments cannot over-claim before the provider POST starts.
- Extended the queue API and task center with per-model active/pending counts, effective limits, samples, failure rates, and explicit global/model/fair-turn wait reasons.
- Added migration `010_generation_scheduler_health.sql` for terminal-window lookups.

Validation complete: `test:generation`, `test:generation:db`, dataset sync/clone/column/import/table tests, Arena, rank ties, API smoke, `lint`, `server:build`, and `build` passed. Desktop browser QA verified global 6/8, Wan 6/6, the model-capacity wait reason, and no page-level horizontal overflow. Mobile browser QA was blocked by the browser localhost URL policy after applying the viewport override; no policy bypass was attempted.

## 2026-08-06: VidMuse MCP input contract

### Completed

- Added a versioned VidMuse input compiler for video `prompt`, `image_urls`, `elements`, `audios`, controls, and image `prompt`/`images` inputs while leaving provider-specific request adaptation in Aion.
- Added MCP direct mapping and backward-compatible assisted mapping. Assisted keyframes, reference images/videos, and audio now compile into the same canonical structure with stable ordering.
- Added strict structural validation, prompt reference checks, Seedance/H3/Wan compatibility profiles, an explicit reference fallback for conflicting keyframes, and warnings for unverified model combinations.
- Added JSON dataset import for object arrays and `{ "items": [...] }`, preserving structured cells and unrelated evaluation or historical-result columns.
- Added per-case compiler audit and final Aion request previews without exposing local asset paths or changing the generation Worker, database schema, assets, writeback, or human-evaluation flow.

### Validation

- `npm.cmd run test:generation`, `test:dataset-import-mappings`, `test:dataset-sync`, `test:dataset-clone`, `test:dataset-column-deletion`, `test:dataset-table-columns`, `test:arena`, and `test:rank-ties`: passed.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd run server:build`: passed. Existing Vite mixed-import and chunk-size warnings remain unchanged.
- Browser: passed structured JSON import, exact MCP field auto-mapping, mixed per-case generation modes, ordered `elements`/`audios`, audio range preservation, request preview, desktop layout, and 390x844 containment with no console errors.
- PostgreSQL generation and API smoke tests were not rerun because the local Docker Desktop Linux engine was unavailable. No schema, Worker, queue, writeback, or API-route behavior was changed, and no paid generation was submitted.
## 2026-08-06: Wan conservative recovery (in progress)

- Diagnosis confirmed the max-on-cold-start policy amplified Wan timeout failures, while pre-policy batches already showed Aion 1200-second failures.
- Implementation is isolated to ManuEval dev on the latest GitHub main; Aion, VidMuse, historical terminal tasks, and automatic paid retry remain out of scope.
- Locked decisions: Wan stays at concurrency 1 during repair; adaptive limits ramp by one slot per three consecutive successes; capacity failures return to the configured minimum; local timeout uncertainty enters a two-hour reconciliation lane.
- Current phase: add failing regression coverage for scheduler cold start/ramp-down, prompt limits, reconciliation claiming, and timeout transition behavior before implementation.

### Implementation and validation

- Deployed emergency Wan concurrency 1 to dev in commit `f99aecf`; CI, image build, migration, and rollout succeeded.
- Rebased the full recovery onto the VidMuse MCP input-contract commit and preserved structured compilation, warnings, audit snapshots, and request previews.
- Added initial/ramp/reset concurrency policy, two-hour non-submitting reconciliation, prompt-limit policy, migration 011, queue diagnostics, and task detail status.
- Passed generation/MCP tests, PostgreSQL generation tests, API smoke, dataset sync/clone/import/column tests, Arena/rank tests, lint, server build, and frontend build.
- Remaining: desktop/mobile browser QA, publish full fix, observe dev, and run exactly one paid Wan smoke.

### Deployment, browser QA, and smoke

- Published the recovery implementation in `cb3d832` and its dev settings in `3d09d31`; both test and dev deployment workflows passed.
- Browser QA passed task-center deep links, refresh recovery, reconciliation status details, and desktop/mobile horizontal containment.
- Submitted exactly one Wan smoke batch, `gen-61830611-865e-4553-949f-63f623c247db`, using a previously successful prompt/reference-image pair and a two-second 480p request.
- The smoke entered `submission_unknown` immediately without an Aion task ID or result. It was not a 1200-second provider timeout and was not retried.
- Wan remains held at dev `min/initial/max = 1/1/1`; the planned restoration of max 6 is intentionally not performed.
- Local Aion SLS and database evidence could not be queried because this workspace has neither the SLS account configuration nor `AION_DEV_DB_URL`.
- Added safe submission diagnostics for HTTP status, error name, and transport code plus an execution timeline. Prompt, media URLs, credentials, and provider response bodies are never logged or returned.
- Diagnostic patch validation passed `lint`, `test:generation`, `test:generation:db`, `server:build`, and `build`.
- After diagnostic deployment, the preserved smoke record displayed `AION_SUBMISSION_UNKNOWN / HTTP 500`; submission and termination were both `2026-08-06 10:37:59`, and no provider task ID existed.
- This proves the smoke failed at the Aion submission boundary rather than from the 1200-second Wan task timeout, reconciliation, fair scheduling, or model concurrency.
- Public detail QA passed at a 524px viewport with no horizontal overflow. CI, image build, migration validation, and dev rollout for `9f06bca` all succeeded.

## 2026-08-06: Generation parameter source deduplication

### Completed

- Limited MCP mapping to case-content fields and changed fresh mappings to infer Prompt only.
- Added one persisted binding per standard or advanced parameter with uniform, dataset-column, or unused sources.
- Kept duration and Seed on their dedicated strategies; dedicated Seed wins over any legacy `extra_params.seed`.
- Added strict boolean, number, JSON, enum, range, empty-cell, and duplicate-source validation without changing historical preflight behavior.
- Classified non-contract live-config fields as disabled advanced parameters that only pass through `extra_params`; blocked `reference_image_urls` and `multi_shots` with replacement guidance.
- Preserved `false` and `0` in final Aion requests and stored source/value audit data in existing JSONB.

### Validation

- `test:generation`, `test:generation:db`, dataset sync/import/clone/column/table tests, Arena, rank ties, and API smoke passed.
- `lint`, `server:build`, and `build` passed; only existing Vite mixed-import and chunk-size warnings remain.
- Browser QA confirmed Prompt-only input mapping, every ordinary/advanced parameter initially unused, one source selector per parameter, dedicated duration/Seed sections, strict invalid-boolean isolation, and `false` preservation in final request audit.

## 2026-08-06: Explicit VidMuse video input intent (V2)

### Completed

- Added `GenerationContentMappingV2` so Prompt, keyframes, reference elements, and reference audios retain explicit user intent before MCP compilation.
- Reserved `image_urls` for one first frame or ordered first/last frames; ordinary reference images and videos compile only into ordered `elements`, and reference audio compiles only into ordered `audios`.
- Added per-case mode inference, strict keyframe/reference conflict rejection, V2 prompt formats, decimal multi-shot durations, exact audio ranges, prompt index auditing, and requested/effective generation-type audit for H3/Wan dual-frame requests.
- Replaced the duplicate MCP/assisted UI with one responsive mapping surface plus ordered element and audio builders. Fresh mappings select only Prompt.
- Preserved the V1 compiler and historical snapshots; no database migration, Worker, asset, writeback, or human-evaluation changes were required.

### Validation

- Generation/MCP, PostgreSQL generation, dataset sync/import/clone/column/table, Arena, and rank tests passed.
- Frontend and server TypeScript checks plus both production builds passed; only existing Vite chunk/import warnings remain.
- Browser QA passed at 1440x1000 and 390x844. The builders stayed contained and model descriptions were visible.
- A live H3 text-only preflight was valid as `text_to_video`; the final request contained Prompt, duration, resolution, and `auto_adjust_duration_to_supported=false` with no media fields. No paid generation was submitted.

## 2026-08-07: Generic VidMuse MCP contract review (implementation complete)

### Completed

- Added an exact `VidMuse evaluation` preset for `prompt`, `image_urls`, `elements`, `audio_url`, standard parameter columns, and modality-based row selection while preserving every source column.
- Added compiler v3 for new preflights. It derives each case mode from explicit MCP channels, removes new-task model-name profiles, preserves historical v1/v2 snapshots, and requires review for mixed or unresolved inputs.
- Added the reviewed `general-mv-main-dsl-v2-en-0721` Plugin snapshot at commit `1029c7970b7069f2e088247cc870992bc65d1424`; rules produce reviewable findings and never mutate requests silently.
- Added per-case finding acceptance/rejection, Prompt edits, final Aion JSON overrides, duplicate-billing confirmation, security validation, immutable account/model/features fields, and JSONB audit persistence without a migration.
- Preserved safe `online-mining/...` relative audio references for explicit risk-confirmed submission and rejected unsafe relative paths.
- Added stable dataset item IDs based on `case_id + variant_label + occurrence`, without modifying business columns.
- Updated the as-built MCP/Aion input contract document in `docs/manueval-vidmuse-mcp-video-input-contract-review.md`.

### Validation

- `test:generation`, `test:generation:db`, all dataset tests, Arena, rank ties, API smoke, `lint`, `server:build`, and the frontend production build passed. Existing Vite mixed-import and chunk-size warnings remain unchanged.
- The compact attachment fixture covers 18 element/`@imageN`, 3 inverse keyframe/`@ElementN`, and 11 mixed-input cases without committing the full business dataset.
- The real 188-row attachment imported with exact source-key resolution. Video preflight selected 164 video cases and isolated 54 invalid/review-required cases; image mapping selected only the 24 image cases.
- Browser QA confirmed exact mappings, per-case modes, request audit, no batch creation, desktop containment, and 390x844 mobile containment with wide case tables scrolling only inside their own container.
- Fixed duplicate React issue keys found during QA; a fresh video preflight produced no new browser console errors.
- Rebased onto GitHub main `4c12bbe` while preserving its Wan HTTP 500 incident record. The full generation/database/dataset/Arena/API/typecheck/build gate passed again after the rebase.
- Published source commit `eaca1ef` to `world-sim-dev/ManuEval` main without force-pushing. Eval Studio Test run `31185153047` and Dev CI/CD run `31185153483` succeeded, including migration validation, database integration, API smoke, image build, and dev rollout.
- `https://eval-studio.sandaii.cn/datasets` loaded under the online account with no browser console errors after deployment. The organization had no dataset, so no dev test data or paid generation request was created.

## 2026-08-08: Seed v2 and MCP/Aion request layering

### Completed

- Added Seed policy v2 with `unused` as the default plus deterministic per-case, fixed, and dataset-column strategies.
- Seed support now comes only from an exact `options.supported_params` `seed` declaration. Unsupported models and `task_worker` requests fail preflight instead of silently dropping Seed.
- New requests keep VidMuse MCP input, derived `generation_type`, and final Aion HTTP JSON as separate audited layers. Projection mismatches fail normal preflight; reviewed forced overrides retain an explicit diff.
- MCP audit excludes Aion-only `generation_type`, `features`, `extra_params`, Seed, and watermark. Aion requests preserve MCP public values and order, add immutable duration-adjustment behavior, and place enabled Seed only in `extra_params.seed`.
- Updated the VidMuse MCP video input contract document with five fully separated MCP/mode/Aion examples and the ManuEval/Aion Adapter guarantee boundary.
- Historical snapshots and legacy Seed retries retain their prior execution semantics; no database migration was added.

### Validation

- Passed generation, isolated PostgreSQL generation, API smoke, all dataset suites, Arena, rank ties, lint, server build, frontend build, and `git diff --check`.
- Browser QA passed live model-config gating, all four Seed strategies, model-switch reset, unsupported-model hiding, one-case preflight audit, and 1440x900 / 390x844 containment.
- The only current browser errors are 401 responses from an expired reference image already stored in the QA dataset; application API calls and the new preflight succeeded.
- No batch was created and no paid model generation was submitted.

### Release

- Fast-forwarded commit `4063e63` to `world-sim-dev/ManuEval` `main` without force-pushing.
- Eval Studio Test run `31243023889` and Dev CI/CD run `31243023947` succeeded, including PostgreSQL integration, API smoke, image build, and dev rollout.
- Public dev loaded successfully. Authenticated generation health returned HTTP 200 with `model_api`, Aion configured, Worker enabled, temporary asset mode, and a 500-case batch limit.
- Live model discovery returned 63 models and the expected strict Seed flags: Wan 3.0 supports Seed; Seedance 2.0 Pro and MiniMax H3 do not.

## 2026-08-08: Generation input reliability hardening

### Completed

- Replaced whitespace media splitting with one shared parser that preserves scalar URLs, ordered JSON/object inputs, signed query strings, and explicit multi-value delimiters. URL spaces normalize to `%20` in both MCP and Aion layers.
- Added per-case `vidmuse_evaluation_v1` parameter contract checks. Non-empty unsupported preset values now block with `UNSUPPORTED_PRESET_PARAMETER`; explicit `unused` records an audited omission.
- Added deterministic media-role checks from uploaded MIME or URL pathname extension plus public-host checks for localhost, loopback, private IP, and single-label hosts.
- Separated risk-only confirmation from manual Aion JSON overrides. Bulk confirmation never fabricates final JSON, and final-JSON-required findings remain invalid until each case supplies one.
- Preserved raw and normalized media references, expected channel, detected media type, evidence source, parameter disposition, and forced rules in existing JSONB audit snapshots.
- Updated the MCP input contract with the implemented parsing, omission, validation, force-boundary, and real dataset dry-run behavior.

### Validation

- `test:generation`, `test:generation:db`, all dataset suites, Arena, rank ties, API smoke, `lint`, `server:build`, frontend `build`, and `git diff --check` pass.
- Desktop and 390x844 browser checks passed with no console warnings or errors. The unsupported-parameter group remained invalid after a bulk reason/charge confirmation when per-case final JSON was absent.
- Read-only dry-run of dataset `ds-1786108187632` covered all 188 rows without a generation POST: 360 media references, 17 source URLs containing spaces, zero normalized whitespace, zero request-build failures, and zero MCP/Aion projection differences.
- Seedance 2.5 plus Gemini image dry-run produced 101 valid and 87 explicit invalid/review cases. Gemini Omni video produced 164 `UNSUPPORTED_PRESET_PARAMETER` cases (328 findings), proving non-empty unsupported preset values are no longer silently omitted.
- No batch was created and no paid image or video generation was submitted.

### Release

- Fast-forwarded source commit `0047b7c` to `world-sim-dev/ManuEval` main without force-pushing.
- Eval Studio Test run `31248453876` and Dev CI/CD run `31248453941` succeeded, including lint, generation tests, migrations, isolated PostgreSQL integration, API smoke, image build, and dev rollout.
- Authenticated public dev health returned HTTP 200 with `model_api`, Aion configured, Worker enabled, temporary asset mode, and a 500-case batch limit. Live model discovery returned 63 models and the browser console remained clean.
- Direct public requests with only `x-auth-user-id` were correctly rejected with `AUTH_REQUIRED`; the successful runtime check used the existing Feishu bearer login without exposing the token.
- A local worker-disabled API used for final source smoke remains bound to port 8789 because the process safety guard could not distinguish its shared `node_modules` path from another worktree. It cannot consume generation jobs and requires owner-confirmed cleanup.

## 2026-08-08: Production workspace and preflight review UX

### Completed

- Added canonical `tasks | new` generation routes. Batch deep links always resolve to tasks, dataset generation deep links resolve to new, and `/generation` defaults to tasks.
- Removed implicit first-dataset selection from the production new view while retaining repository behavior. Production preview is read-only and exposes one explicit `配置生成` action.
- Replaced duplicate task-center tabs with one stable page-level navigation and added the dataset repository handoff.
- Added a shared Chinese preflight issue catalog, status/issue/Case ID filtering, deduplicated issue counts, and filter-scoped bulk risk confirmation.
- Replaced dense inline case diagnostics with one-line rows and a responsive detail dialog for issues, Prompt/override editing, Plugin decisions, and request audit.
- Clarified the video duration title, meaning, and duration-column source.
- Cases missing a stable item ID remain openable for diagnosis but cannot save a review; unchanged dialogs also cannot create false pending-review state.

### Validation

- Passed `test:generation`, isolated `test:generation:db`, every dataset suite, Arena, rank ties, API smoke, `lint`, frontend `build`, server `server:build`, and `git diff --check`.
- The first database test attempts shared the live development queue with a running Worker and were externally claimed. A separately migrated `eval_studio_codex_ui_review` database removed that interference; the full PostgreSQL integration suite then passed.
- Browser QA verified canonical task/new routes, no implicit dataset selection, disabled configuration before an explicit selection, read-only production preview, and the clarified duration field against live model configuration.
- Mock-only preflight QA verified real status/issue/search filtering, deduplicated counts, filter-scoped bulk actions, Chinese issue copy, openable missing-ID cases, unchanged-save disabling, saved drafts, and explicit re-preflight state.
- Desktop and 390x844 mobile dialog checks passed with no internal horizontal overflow or overlapping controls. The only console error was the existing missing `/favicon.ico` resource.
- The preflight endpoint was intercepted for review QA. No batch was created and no paid image or video generation was submitted.

### Release

- Fast-forwarded source commit `2ffd4b4` to `world-sim-dev/ManuEval` `main` without force-pushing or staging the existing untracked report and report assets.
- Eval Studio Test run `31252776514` and Dev CI/CD run `31252776557` succeeded. The latter passed tests, image build, and the Kubernetes dev rollout.
- `https://eval-studio.sandaii.cn/generation?view=tasks` loaded the unified navigation after deployment. Switching to `view=new` retained no implicit dataset selection, kept configuration disabled, and produced no browser console errors or warnings.

## 2026-08-08: Structured Base import and no-cost quality audit (pre-release)

### Completed

- Added a local `lark-cli` importer that reads the specified Base/table/view twice and stops on schema, row-count, pagination, or snapshot drift.
- Added verified web import envelopes for the exact 16-column source dataset and versioned 17-column per-case audit dataset, including hidden Feishu provenance and overwrite protection.
- Added an all-live-model dry-run that reuses the production MCP compiler, preflight validation, generation-mode inference, and Aion request builder without issuing generation POSTs.
- Added deterministic Prompt/MCP/media auditing, HTTP/MIME/ffprobe checks, image/audio/video evidence generation, and a human-reviewed report pipeline. Complete business artifacts remain gitignored.
- The final source recheck contains 188 rows, the exact 16 visible columns, 618 transport-only normalizations, and stable snapshot `sha256:00381745e0a61b29f665bd8ee031ec04ff9ecb7e85d5b20b8c7fcbf638530b34`.
- The captured 63-model matrix contains 7,952 matching case-model compilations and exactly zero generation POSTs.

### Validation

- Passed focused structured-audit tests, generation/MCP/Seed tests, every dataset suite, Arena, rank ties, lint, server build, frontend build, and `git diff --check`.
- The shared PostgreSQL test was externally claimed by an existing Worker; the separately migrated `eval_studio_codex_base_audit` database passed the full generation integration suite and worker-disabled API smoke. The temporary API was stopped afterward.
- Manually read all 188 Prompts, reviewed all 167 unique visual/media previews, and checked 18 generated audio preview clips. No AI judge or paid model generation was used.
- Current quality result: 25 blocker, 52 high, 34 medium, and 77 informational cases. MCP status is 164 valid / 20 review / 4 blocked; media status is 109 valid / 58 review / 21 blocked.

### Pending Release

- Fast-forward GitHub main, verify CI/dev deployment, import both verified datasets through the authenticated public UI, upload the compatibility matrix, and publish the linked Feishu report.

## 2026-08-09: Root-cause generation case repair UX

### Locked behavior

- Replace the three-tab case dialog with `修复问题` and `生成预览`.
- Group derivative diagnostics under one actionable root cause; the `@imageN` versus `elements` example must render as one Prompt-channel repair.
- Add versioned, per-case canonical input overrides for Prompt, media arrays, and declared parameters. Overrides affect only the generation request snapshot and never mutate the source dataset.
- Keep guided MCP-aligned repair and full final-Aion-JSON override mutually exclusive for new reviews; preserve historical snapshots.
- Provide immediate save-and-repreflight plus draft-and-next flows. The server remains authoritative for regenerated MCP and Aion previews.

### Validation gate

- Add failing deterministic coverage for repair grouping and safe case overrides before implementation.
- Run generation, PostgreSQL generation, dataset, Arena/ranking, API smoke, TypeScript, server build, frontend build, desktop/mobile browser checks, and `git diff --check`.
- Do not submit any paid image or video generation.

### Completed

- Added root-cause repair groups, field-level Prompt/media/parameter editors, versioned `inputOverride`, guided/expert exclusivity, immediate authoritative re-preflight, and the two-tab read-only generation preview.
- The real 188-row dataset and live MiniMax H3 configuration were used for no-cost preflight QA. The sample Prompt-channel case changed `@image1` to `@Element1`; a case-level `1440p` resolution override then made the case valid without editing the source dataset.
- Immediate re-preflight now preserves the open case, switches to the refreshed preview, clears the stale-preview banner, and marks a repaired case that no longer matches the active filter.
- A real `elements[0]` union conflict displayed the reference-video type, current `video_url`, add/remove/reorder controls, and technical diagnostics directly under the root cause.
- Desktop and `390x844` mobile checks passed. The dialog had no internal horizontal overflow or overlapping controls; the only console error was the existing missing `/favicon.ico`.
- Passed generation/MCP/Seed tests, isolated PostgreSQL generation integration, every dataset suite, structured evaluation audit, Arena, rank ties, isolated API smoke, TypeScript, server build, frontend build, and `git diff --check`.
- No generation batch or paid image/video request was created.

### Release

- Fast-forwarded source commit `7843f5b` to `world-sim-dev/ManuEval` `main` without force-pushing or staging the existing untracked report and report assets.
- Eval Studio Test run `31269490007` and Dev CI/CD run `31269490078` succeeded. The latter passed tests, image build, and the Kubernetes dev rollout.
- `https://eval-studio.sandaii.cn/generation?view=tasks` loaded the deployed task workspace with live API data and no browser console errors. No generation action was opened or submitted.

## 2026-08-09: Dataset column filters and filtered generation scope

### Completed

- Added typed Excel-style value filters to every dataset business-column header. Same-column selections use OR, cross-column filters use AND, blank values share one option, and JSON cells remain whole values.
- Preserved original row indexes for repository view/edit/delete actions. Hidden filtered columns keep their conditions, and dataset/version changes clear the session-only filter state.
- Added a versioned frontend generation-scope snapshot. Active filters default the generation dialog to the frozen filtered result; the existing case selector then performs the final stable-ID selection within that scope.
- Added explicit filtered/all scope switching, mutually exclusive eligibility counts, zero-result blocking, and stable-ID-first snapshot resolution. No API, database, Worker, Aion, writeback, or historical batch contract changed.
- The supplied 188-row CSV passed a read-only dry-run: `cell_id=AI|AIM` matched 24 rows (`AI=10`, `AIM=14`) in original source order.

### Validation

- Passed `test:dataset-filters`, generation/MCP/Seed tests, every non-DB dataset suite, Arena, rank ties, TypeScript, server build, and frontend build.
- Local PostgreSQL and Docker Desktop were unavailable, so database generation and API smoke remain to be covered by CI/dev deployment.
- The local app is running at `http://localhost:3000/datasets`, but the Codex in-app browser blocked local HTTP navigation. Desktop/mobile UI verification remains a post-deploy check on the public dev URL.
- No preflight submission, generation batch, or paid image/video request was created.
- First public-dev interaction found that opening a header filter could immediately close it when locator/focus scrolling fired. Scroll and resize now recompute the portal position; only outside clicks or Escape close it. Desktop/mobile placement has deterministic regression coverage.
- The same public check exposed JSX text-node Unicode escapes rendering literally. All filter instructions, placeholders and actions now use normal Chinese labels; typed value names and counts were already correct.

## 2026-08-10: Generic Prompt length contracts

### Completed

- Replaced scalar-only Prompt length validation with a shape-aware contract for strings, per-array-item limits, and explicitly configured joined-array limits. Unicode code points are the only supported measurement unit; bytes and tokens are never approximated.
- Extracted string and array Prompt limits from Aion input/parameter JSON Schema, including `oneOf` and `anyOf`, with Aion options and validated ManuEval compatibility configuration as lower-priority sources.
- Removed the `String(array)` path. Arrays without a reliable contract now emit `PROMPT_LENGTH_NOT_VERIFIED`, preserve the final Aion request unchanged, and defer final enforcement to the Adapter.
- Added structured issue evidence and UI copy with measured value, maximum, unit, scope, source, and array item index. Online preflight and offline dataset audit now use the same resolver and compatibility configuration.
- Preserved the legacy `promptMaxLength` setting as a string-only fallback. No model-name branch, description parsing, database migration, Aion change, or paid generation was introduced.

### Validation

- Passed generation/MCP/Seed tests, structured evaluation audit, PostgreSQL generation integration, every dataset suite, Arena, rank ties, API smoke, TypeScript, server build, frontend build, and `git diff --check`.
- A zero-generation dry-run compiled 188 source cases against 63 captured live models: 7,952 case-model evaluations and exactly 0 generation POSTs.
- Independent Unicode code-point counting found 15 source Prompts over 5,000 characters. The dry-run reported the same 15 unique cases, with 0 false positives and 0 measurement mismatches.

## 2026-08-10: Excel-style cascading filter candidates

### Completed

- Reproduced the reported behavior: candidate counts honored other columns, but the menu still rendered every unique value, including unselected zero-count IDs.
- Changed candidate construction to return positive-count values plus only the current column's selected zero-count values. The latter render in a separate `已选但当前无匹配` section so an active condition is never hidden.
- Added candidate/full-column counts to the menu. Search and select-all operate only on currently available values; exact downstream selections remain active when an earlier filter is cleared.
- Confirmed the live source dataset contains 201 rows and the expected typed `cell_id`/`用例ID` columns. No generation request was submitted.

### Validation

- Passed filter tests, generation/MCP/Seed tests, every dataset suite, structured evaluation audit, Arena, rank ties, TypeScript, frontend build, and server build.
- Passed generation database integration and API smoke against an isolated PostgreSQL database. The temporary API, database, Docker network, volume, and logs were removed afterward.

## 2026-08-10: Bulk replacement for over-limit Prompts

### Completed

- Added a manual alternate-Prompt-column source for `PROMPT_TOO_LONG` cases. The bulk action always targets every matching case in the selected preflight scope; display status, issue, and Case ID filters do not narrow it.
- The server reads alternate values from the locked dataset version by stable item ID. Empty, malformed, and still-over-limit values never fall back to the primary Prompt and are reported by the immediate authoritative re-preflight.
- Bulk replacement clears only prior Prompt edits and Prompt Plugin decisions. Media, parameter, and unrelated review state remain intact. Any expert final Aion JSON blocks the entire bulk action.
- Candidate columns exclude the active Prompt, outputs, references/media, case IDs, system/internal fields, dimensions, and rubrics. The supplied structured dataset no longer offers `audio_url`, `image_urls`, `elements`, or `case_id` as alternate Prompt columns.
- Added the same source-column choice to the single-case repair dialog and recorded the source column/raw value in compiler audit without changing the source dataset.

### Validation

- Passed generation/MCP/Seed tests, PostgreSQL generation integration, structured evaluation audit, every dataset suite, Arena, rank ties, API smoke, TypeScript, server build, frontend build, and `git diff --check`.
- Browser-validated the real 188-row dataset with mocked zero-cost model/preflight responses on desktop and `390x844` mobile. Selecting an alternate column immediately changed the sample from one invalid case to one valid case with no new runtime error or layout overlap.
- No generation batch, paid request, source-dataset mutation, push, or deployment was performed.
