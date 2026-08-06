# Arena Implementation Progress

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
