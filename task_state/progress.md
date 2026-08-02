# Arena Implementation Progress
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
