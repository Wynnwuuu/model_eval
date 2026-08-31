# Arena Implementation Progress

## 2026-08-28: Generated result columns in material builder (implementation complete; release verification follows commit)

- Baseline is the private GitHub `main@271d1431`; implementation is isolated on `codex/fix-generated-result-columns` and will fast-forward `main` only after full validation.
- Confirmed root cause: generation writeback correctly persists the output schema and mapping, while `TaskBuilderScreen` projects columns from only the first row whenever rows exist. Sparse generated outputs can therefore appear in the dataset repository but disappear from material mapping.
- Added one shared task-builder projection over Schema plus every row. Normal business/output fields remain selectable; `_originalData`, `__*`, system fields, and exact generation status/seed/request/error/params companions stay out of the mapping UI. Ordinary selection, generation deep links, dataset normalization, mapping inference, and generation-column discovery no longer use row zero as a schema substitute.
- Dataset subscription refreshes now add eligible columns, retain still-valid input/output/dimension choices, and prune deleted choices. Generation prefill is consumed only after every requested result is visible; preferred output inference follows the requested column and includes audio.
- Regression coverage includes sparse row-zero failures, later-row-only business/output fields, audit isolation, an older image output plus a target video output, audio inference, invalid audit deep links, and add/delete version reconciliation in Chromium.
- Local validation passed: projection, generation, dataset sync/filter/import/deletion, task-case, owner-access, project/storage contracts, TypeScript, frontend/server builds, Playwright test discovery, and `git diff --check`. The intended pre-fix projection test first failed on the missing shared export and passed after implementation.
- Local PostgreSQL/API/Chromium execution could not start because Docker Desktop 4.67 crashed on its own stale `dockerInference` socket before any project container ran. Those unchanged CI gates remain mandatory in GitHub's isolated PostgreSQL/Chromium workflow before the dev rollout is accepted.
- No Aion request, paid generation, database migration, or production writeback-contract change is authorized for this repair.

## 2026-08-19: Result insight export consolidation (complete)

- Baseline is `main@84d9f855`; implementation is on the existing `codex/owner-magic-access` worktree and the release target is `main`.
- Replaced per-statistic CSV buttons with one lazy-generated, styled multi-sheet Excel workbook for A/B, Arena-rank, MOS/Rubric, and Pairwise. Reviewer-level detail CSVs remain separate, and Arena-rank/A-B evidence JSON now carries stable Case identity and audit snapshots.
- Export identity distinguishes 1-based `CaseIndex`, business `CaseID`, internal `TaskItemID`, and stable `DatasetItemID`. Vote-time `evaluatedItemSnapshot` and legacy `itemSnapshot` take priority over current item data; new votes persist `itemOrder`.
- CSV uses UTF-8 BOM and spreadsheet-formula hardening. Reviewer exports contain names only and never emit `ReviewerKey`. ExcelJS 4.4.0 is dynamically imported only for workbook downloads, with its uuid child pinned to the audited 11.1.1 release.
- `test:insight-exports`, dataset synchronization, insight/rank/task/model-feedback regressions, TypeScript, frontend build, server build, and `git diff --check` pass. Real browser downloads were parsed successfully; failure/retry behavior and 390x844 wrapping/no-overflow also passed.
- Browser fixtures and downloaded QA artifacts were removed. No database migration, server API change, or production data mutation occurred. The final release commit is recorded in git history.

## 2026-08-17: Reviewer-controlled reveal flow (complete)

- Added a top-of-evaluation “提交后揭示模型” switch for A/B, Pairwise, Arena-rank, MOS, and Rubric; it defaults off so a successful submission advances directly.
- The preference is scoped to the current evaluation session only, is not persisted, remains stable across cases in that session, and resets when the evaluation is re-entered.
- Enabling the switch preserves the existing save-then-reveal review phase. Changing it after a case is already revealed does not hide the identity and only affects a later submission.
- Focused Chromium coverage passes for default-off direct advance, explicit reveal, mid-session switching, re-entry reset, all formal evaluation methods, and mobile Arena-rank layout.
- Validation passed: every package `test:*` script, TypeScript lint, frontend/server production builds, 14 migrations on an ephemeral PostgreSQL 16 container, both database integration suites, isolated API smoke, and all 26 Chromium E2E tests. The browser suite includes Arena-rank media default-paused controls, desktop/mobile layout, failure protection, storage restore, and material navigation. `git diff --check` is clean.

## 2026-08-17: Per-case model reveal and per-model feedback (complete)

- Baseline is clean `main@40dddc7` in worktree `codex/model-feedback-reveal`.
- Approved scope covers A/B, Pairwise, Arena-rank, MOS, and Rubric for text/image/video/audio; Benchmark Preview is unchanged.
- A/B, Pairwise, Arena-rank, MOS, and Rubric now save the conclusion first, reveal actual model names in place after success, keep per-model notes editable, and advance only from `下一题` / `查看结果`; skip and Benchmark Preview retain direct advance without reveal.
- Notes reuse `VoteRecord.rubricResponses` / `rubric_responses_json`; score answers and scores survive note edits, the 1000-character limit is enforced in UI and normalization, and no migration, API, dependency, or external summarization service was added.
- Result insights now show a reviewer-scope-aware, case-filter-independent model feedback summary and attach matching model notes to raw per-case reviewer records.
- Validation passed: all package `test:*` scripts, lint, frontend/server builds, isolated PostgreSQL migrations and database tests, enhanced API smoke, 24 Chromium E2E tests, explicit mobile overflow assertion, and `git diff --check`.

## 2026-08-14: Single-material result insights

- Removed implicit comparable-task grouping and the merged/single-task analysis scope. Result insights now load exactly one explicitly selected evaluation material.
- Added an in-page reviewer boundary switch for all reviewers versus the current account. The same filtered vote set drives summaries, charts, case details, evidence, dimensions, and exports.
- Unified task-card, evaluation-completion, task-results, and legacy task-insights entry points on the project insight page with the corresponding material preselected. Project-level entry intentionally starts with no material selected.
- Project result snapshots are now one row per evaluation material, so votes and cases from different tasks cannot be merged accidentally.
- Old `group:*` deep links are normalized without restoring task grouping. Material and reviewer scope remain URL-addressable.
- Focused routing, summary, task-result, metadata, lint, frontend build, server build, diff, and desktop/mobile browser checks pass. Full local PostgreSQL/API startup remains blocked only because Docker Desktop is stopped; the offline Vite site is available at `http://localhost:3000/`.

## 2026-08-13: Evaluation material case selection

- Added case-ID and dimension cascading filters plus explicit replace/add/remove/current-row selection for dataset, CSV/TSV, and pasted-table task sources.
- New tasks persist `includedDatasetItemIds`; later dataset additions stay out, selected case updates and stable-ID restoration still synchronize, and legacy tasks retain dynamic scope.
- Removed the obsolete manual Model A/Model B editor. Task models now always derive from the selected result columns and the builder shows method-specific minimums and actual names.
- Invalid generated media, failure cells, and empty outputs cannot enter a task. Preview uses the first final selected case.
- `test:task-case-selection`, dataset filters/sync/column deletion, Arena, rank ties, TypeScript, frontend/server builds, PostgreSQL API smoke, local health, and desktop/mobile browser checks pass. The first API smoke hit a stale local API process; restarting the project stack resolved it without code changes.

## 2026-08-11: Live Aion 500 and optimistic-wave validation

### Completed

- Started from an idle dev lane at image `0/4` and video `0/24`, then made 34 bounded real Aion submissions: eight historical Seedance 2.0 Pro retries, one Seedance 2.0 Fast canary, one lowest-cost Seedance 1.0 Pro Fast canary, and two concurrent 12-case Seedance 1.0 Pro Fast batches from different datasets.
- All 34 requests received an explicit Aion HTTP 500 with `Billing failed while processing the request.` before any task ID was created. Every item was recorded as `failed / AION_HTTP_ERROR`, released its slot immediately, and retained the factual "Aion explicitly returned an error" UI. No item became `submission_unknown`, no automatic retry ran, and no five-minute model cooldown or global pause recurred.
- The two 12-case batches were created concurrently and drained in about 11 seconds. Their submission timestamps alternated across datasets from `19:44:06` through `19:44:17`, validating fair queue continuation under repeated capacity-neutral HTTP failures. Both writebacks completed, the queue returned to video `0/24` with zero waiting items, and both pages had zero browser console warnings/errors.
- Live batches: Pro retry `gen-06c4da28-692e-4205-a45b-67f8fae2a4ec`; Fast canary `gen-0c47a784-73eb-4dfb-a8ab-d34fd8069829`; low-cost canary `gen-458a14cb-40b5-4c84-849e-f90eb3d4879d`; 12-case batch A `gen-872cf536-0a61-408f-89aa-74accede2a4e`; 12-case batch B `gen-853ba0f1-606d-44d8-b27a-1e496549dc01`.
- Accepted-submission expansion `8 -> 16 -> 24`, unique task IDs, and one-attempt persistence could not be revalidated in this run because billing rejected even the 10-credit canary before provider submission. Aion source maps insufficient balance to a distinct `Insufficient credits` error; the observed generic billing failure instead covers billing-service authentication/network/configuration or another unclassified pre-deduction exception. Exact root cause requires Aion/Zeus logs or an authorized balance/configuration check.
- Generation planning/client, seed, and VidMuse MCP input-contract tests passed. The PostgreSQL generation suite exposed a one-millisecond Node/PostgreSQL clock-boundary flake in two due-poll assertions; moving the synthetic due time five seconds into the past made the test deterministic, after which the complete suite passed twice consecutively. No runtime scheduling logic changed.

## 2026-08-11: Aion HTTP 500 classification and queue recovery

### Release

- Commits `c5c5c3a` and `93fd2fd` were fast-forward pushed to `world-sim-dev/ManuEval` main without force-pushing.
- Test runs `31484484808` and `31485570663` succeeded. Dev CI/CD runs `31484484909` and `31485570826` passed tests, image builds, migrations, and Kubernetes rollouts.
- Public-dev refresh verification reopened batch `gen-730a1acb-50d5-4de9-9c14-a00e963e4c4c` from its deep link with no console warnings or errors. It showed 28 historical HTTP 5xx rows as explicit Aion errors and retained four real HTTP 400 submission rejections; no row used the lost-response text.
- The referenced batch had already reached 32 terminal failures before deployment, so no existing pending item was available for a post-fix live submission. No retry, generation request, or paid smoke batch was created.

### Completed locally

- Received Aion HTTP 4xx/5xx responses now become factual failures with bounded safe detail; only no-response transport failures remain `submission_unknown`.
- HTTP 5xx, real submission uncertainty, and generic availability failures are capacity-neutral. Explicit concurrency/queue/rate-limit signals still control the optimistic waves.
- Policy v5 resets old capacity state to window 8. Migration `013` idempotently reclassifies only historical HTTP 5xx rows without provider task IDs.
- The task center distinguishes explicit Aion responses from no-response uncertainty and applies duplicate-billing warnings only to the latter.
- Browser rollout QA exposed and fixed an existing refresh race: a batch deep link no longer loses its selected dataset while the asynchronous dataset list is still empty.
- Generation unit and PostgreSQL tests, TypeScript, dataset sync/clone/import/filter tests, Arena, rank ties, frontend/server builds, migration, and Worker-disabled API smoke all pass.

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
- No generation batch, paid request, or source-dataset mutation was performed.

### Release

- Commit `e9760eb` was rebased onto the latest `world-sim-dev/ManuEval` main, including adaptive-capacity commits `0c12ce0` and `83e09f5`, then fast-forward pushed without force.
- Eval Studio Test run `31387716322` and Dev CI/CD run `31387716394` succeeded. The latter passed tests, image build, and the Kubernetes dev rollout.
- `https://eval-studio.sandaii.cn/` returned HTTP 200 after rollout. The unauthenticated generation-health request returned the expected `AUTH_REQUIRED`, confirming the public auth boundary remains active.

## 2026-08-11: Optimistic-wave video capacity

### Completed

- Replaced policy v3 terminal-history learning, mode-specific cold starts, verified-window probes, and rollout shadowing with policy v4 optimistic waves `8 -> 16 -> 24`.
- A capacity group now uses an explicit Aion `groupId` when present and otherwise the stable model configuration ID. Generation modes share the same group.
- Aion task acceptance is recorded after its task ID is durably saved. Polling can idempotently repair a missed acceptance record; policy-v3 tasks cannot warm policy v4.
- Explicit capacity rejection halves the group, RPM feedback pauses without shrinking, repeated ambiguous 429 feedback halves, submission uncertainty pauses the whole video lane and halves the group, and terminal generation outcomes are capacity-neutral.
- Dev no longer contains Wan, H3, or Seedance model-name limits. Disabling policy v4 falls back to a uniform global-eight policy.
- Generation unit tests, TypeScript, and PostgreSQL generation integration pass. The DB test confirms two atomic submission workers, the ninth claim before any terminal result, unique task IDs/one attempt, and shared capacity across video generation modes.
- Cleared stale transient poll/reconciliation errors when a task later succeeds so successful rows cannot write a false `_error` value.
- Fast-forward released commits `301b931` and `e98f9e0` to `world-sim-dev/ManuEval` main while preserving intervening main commit `a16f063`. Both GitHub test workflows and both dev CI/CD rollouts succeeded.

### Validation

- Passed generation/MCP/Seed tests and PostgreSQL generation integration. The database test exercised the two submit workers, accepted-submission expansion, one-attempt/unique-task-ID invariants, shared capacity across modes, fair scheduling, retries, cancellation, writeback, and stable assets.
- Passed API smoke, dataset sync/clone/column deletion/import mapping/table projection/filtering, structured evaluation audit, Arena, rank ties, TypeScript, server build, frontend build, and `git diff --check`.
- Browser-validated the production task center at `1440x900` and `390x844`. The optimistic-wave summary and expanded detail render without page overflow; a pre-existing mobile intrinsic-grid overflow that clipped the new-production button was fixed and rechecked.
- The browser fixture was local-only, generated no Aion request, and was deleted after verification. Local web/API processes were stopped.
- Real Aion dev smoke used live `seedance-2.0-pro-t2v` configuration with 12 valid text-to-video cases at 4 seconds, 720p, 16:9, and audio disabled. All 12 received unique task IDs with one attempt: the first/eighth/ninth/twelfth submissions started at 0.786/4.497/5.253/6.398 seconds after confirmation, and the first terminal result arrived 1,865.486 seconds after the twelfth submission.
- The smoke proved the first eight accepted task IDs opened the 16-slot wave and cases 9-12 submitted before any terminal result. A controlled Worker restart preserved all 12 task IDs and `attempt=1`.
- Final smoke outcome was 11 succeeded and one explicit Aion provider timeout after 3600 seconds; no case was automatically retried. Dataset version 2 contains 12 statuses, 12 unique request IDs, 12 parameter JSON values, one accurate error, and 11 stable `vidmuse-dev-video.sandcdn.com` results.
- A stable result returned HTTP 206, `video/mp4`, `Accept-Ranges: bytes`, and a valid `Content-Range`. The final queue returned strategy `optimistic_waves`, global limit 24, and zero active/pending items. The isolated local API was stopped.
## 2026-08-12: Page titles and link previews

### Completed

- Replaced the Google AI Studio scaffold title with Manueval metadata, a favicon, a touch icon, and a 1200x630 original social preview image.
- Added one shared route-title resolver for projects, datasets, generation batches, tasks, results, insights, Rubrics, login, and list pages.
- Added server-side HTML metadata injection so link-unfurl crawlers receive resource-specific titles before React runs. Only resource names and page types are exposed; business content remains excluded.
- Added client-side metadata synchronization for SPA navigation, offline local data, canonical URLs, and resource renames.

### Validation

- Passed page metadata unit and HTTP integration tests, insight deep-link and summary tests, TypeScript, frontend build, server build, and `git diff --check`.
- Browser-validated homepage, project, dataset, and generation titles plus canonical and Open Graph updates during client-side navigation.
- Full shared-stack `local:check` and API smoke remain unavailable because Docker Desktop is not running. The offline frontend remains available at `http://localhost:3000/`.

## 2026-08-12: Human-friendly generation preflight

### Completed

- Started from `github/main@b0fc918` in an isolated worktree.
- Confirmed the reported `720p`/`1440p` defect is a browser select rendering mismatch: the controlled value is absent from its options, so the first supported option is displayed even though the server validated the original `720p` value.
- Defined regression gates before implementation for structured issue evidence, truthful replacement controls, parameter-column overrides, deterministic bulk media repairs, expert-review isolation, and current-selection-only exclusion.
- No generation POST or paid request is part of this work.
- Added server-owned issue evidence for raw and normalized values, source columns, enums/ranges, rule sources, config fingerprints, and deterministic repair actions.
- Grouped preflight issues by severity, error code, and field. Added a repair workspace with explicit case selection, before/after preview, fixed-value and alternate-column parameter repairs, semantic media repairs, and current-generation-only exclusion/restoration.
- Fixed the select mismatch: an unsupported current value is shown as evidence, while the replacement select remains unselected until the user chooses an allowed value.
- Added locked-version parameter-column overrides keyed by stable dataset item ID. Empty or invalid cells fail the affected case and never fall back to a batch value.
- Repair re-preflight now sends the prior configuration fingerprint. A changed Aion contract rejects the repair application and discards the stale preflight.
- Browser-validated a zero-cost `720p` / sole `1440p` candidate fixture on desktop and `390x844` mobile. The candidate remained unselected, raw/effective values stayed `720p`, tables scrolled without overlap, and the fixture/artifacts were removed.
- Passed generation/MCP/Seed, PostgreSQL generation integration, all dataset suites, structured evaluation audit, Arena, rank ties, insight summary/links, API smoke, TypeScript, frontend build, server build, and `git diff --check`.
- The first DB/API attempts failed only because local PostgreSQL/Express were stopped. The existing test container and temporary API were started, tests passed, and both were stopped afterward. No paid generation or source-dataset mutation occurred.

## 2026-08-12: Versioned dataset synchronization

### Completed locally

- Started from `github/main@76677e3` in an isolated worktree.
- Preserved the original worktree and its untracked reports/assets.
- Locked the approved behavior for composite identity, Feishu Base/manual snapshots, output merge policies, stale-result auditing, generation concurrency, column visibility, and view-only sorting.
- Validation gate: add deterministic unit and PostgreSQL integration coverage before implementation, then run all dataset/generation suites, API smoke, TypeScript, server/frontend builds, and desktop/mobile browser checks. No paid generation is permitted.
- Added exact `case_id + variant_label` synchronization with stable item identities, historical result restoration, source-authoritative row/schema ordering, explicit output merge policies, and stale-result auditing.
- Added full-table Feishu Base previews plus CSV/TSV/JSON/paste imports. Source headers are preserved exactly; a non-exact or missing `case_id` header blocks application instead of risking a delete-all update.
- Added active-generation blockers and a transactional dataset-version lock so synchronization and batch creation cannot race against stale source versions.
- Added result-column visibility controls, default-hidden output/system columns, and stable typed single-column sorting that never changes generation order.
- Browser QA passed at desktop and `390x844`: preview/apply produced one added, one updated, one deleted case and one stale result; result expansion and ascending case sorting behaved correctly with no console errors.
- Passed versioned sync unit/PostgreSQL tests, all dataset suites, generation/MCP/Seed and generation DB tests, structured evaluation audit, Arena/ranking/insights/page metadata, API smoke, TypeScript, server build, frontend build, and `git diff --check`. No paid generation was submitted.
- A real Feishu Base read was attempted locally and correctly failed with `FEISHU_NOT_CONFIGURED` because local `.env` has no Feishu app credentials. The dev deployment workflow already injects those secrets; live Base permission remains a post-deploy acceptance check.

### Release

- Fast-forward pushed commit `381652b` to `world-sim-dev/ManuEval` `main` without force-pushing or touching the original worktree's untracked reports/assets.
- Eval Studio Test run `31589206087` passed. Dev CI/CD run `31589206352` passed tests, migration `014`, image build, and Kubernetes rollout.
- Public dev `/datasets` and `/api/health` returned HTTP 200, and the Feishu login endpoint confirmed deployed app credentials are configured.
- A live Feishu Base preview still requires an authenticated user session; app `bitable:app:readonly` scope and target-Base collaborator access remain the only external acceptance condition.

## 2026-08-12: Resizable application and dataset workspace

### Completed

- Added a persistent 208-400px desktop navigation resize rail. The navigation, top bar, and page content move together; mobile navigation and evaluation focus mode keep their existing behavior.
- Replaced the dataset repository's small pane grips with full-height 12px splitters. The repository left filter pane supports 220-480px and the right inspector supports 300-720px while retaining a usable center workspace where the viewport permits it.
- Added Excel-style resizing for every dataset business column with synchronized `colgroup` sizing, horizontal table scrolling, 96-960px bounds, keyboard arrow adjustments, and direct CSS/`requestAnimationFrame` feedback during pointer drags.
- Stored app-shell and repository pane widths as local UI preferences, and dataset column widths by dataset ID. Column rename/delete and dataset deletion migrate or remove only the related local preferences; dataset copies start with their own defaults.

### Validation

- Passed `test:layout-sizing`, `test:dataset-table-columns`, `test:dataset-filters`, `test:dataset-column-deletion`, TypeScript, frontend build, and server build.
- Browser-validated navigation/content synchronization, full-height pane hit areas, table header/cell alignment, keyboard resizing, refresh persistence, and shared widths in the production workspace. A temporary local dataset was removed after the checks, and browser console logs were empty.
# 2026-08-13: Generation retry family and skipped-error writeback

## Release validation in progress

- Started from `github/main@b2c84ab` in an isolated clean worktree. The existing `ManuEval-friendly-preflight` worktree and its uncommitted mapping changes remain untouched.
- Confirmed the retry failure: the route selects only failed stable item IDs but forwards the parent batch's complete `caseReviews`; preflight correctly rejects reviews outside the selected retry scope.
- Confirmed retry children already inherit the same target column and fill only empty source cells, but task-center/detail APIs expose children as separate batches.
- Confirmed a post-writeback skip currently changes only `resolution_status`; the completed writeback lane cannot update the dataset target cell afterward.
- Validation gate: first add deterministic retry-scope/family/skip-writeback regressions, then run generation, database, dataset, Arena, API, TypeScript, builds, and browser QA. No paid generation is permitted.

### Implemented

- Retry preflight now scopes every stable-ID keyed review and reference-audio duration snapshot to the selected failed cases. Exact server validation remains in place to reject stale or foreign IDs.
- Retry descendants remain immutable physical attempts for billing and audit, while task-center/detail APIs aggregate the root family by stable item ID and preserve the root case order and target column.
- Skip acknowledgement writes a sanitized diagnostic into the target cell and companion metadata. Initial writeback and post-writeback incremental versions both use stable IDs and refuse to overwrite non-empty results.
- Dataset preview renders skipped failures as text. Human-evaluation creation excludes failed or empty media rows, records the excluded stable IDs, and dataset synchronization does not add them back later.

### Validation

- Passed generation unit tests, the exact `78 total / 71 success / 7 retry` regression, generation PostgreSQL integration tests, dataset sync (pure and PostgreSQL), clone, column deletion, import mapping, table projection, filters, structured evaluation audit, Arena, rank ties, insight links/summary, page metadata, layout sizing, Worker-disabled API smoke, TypeScript, server build, and frontend production build.
- Browser QA passed on desktop and 390x844 mobile. The task center showed one root row with two merged physical attempts; root and child deep links opened the same logical family; select-all changed from `0 / 1` to `1 / 1` and enabled retry/skip only after selecting the current failed case; attempt history rendered without console errors.
- Browser/API QA did not click retry or skip, and `GENERATION_WORKER_ENABLED=false`; no model request or paid generation occurred.

### Release

- Commit `99d318f` was fast-forward pushed to `world-sim-dev/ManuEval` main without force-pushing. The unrelated dirty `ManuEval-friendly-preflight` worktree remained untouched.
- Eval Studio Test run `31655632535` passed. Dev CI/CD run `31655632603` passed tests, image build/push, database configuration validation, and Kubernetes rollout.
- Public health returned successfully, and the deployed frontend bundle contains the retry select-all label, logical-attempt merge label, and skipped-failure prefix. The browser's Feishu session had expired, so the authenticated 78-case production batch was not mutated or claimed as a live interaction check.

## 2026-08-13: Generated result column visibility

### Completed

- Model result columns declared by schema or saved output mappings now display by default, including newly written image, video, audio, and text results.
- Exact output companion fields ending in `_status`, `_seed`, `_request_id`, `_error`, or `_params_json` now form a separate generation-record group and default hidden. Ordinary metadata with similar names remains visible.
- Existing per-dataset visibility overrides remain authoritative. Result expand/collapse controls affect only model outputs, while show-all still reveals every manageable column.
- Reused one shared exact companion-column matcher in dataset presentation and versioned synchronization without changing dataset schemas, generation writeback, task bindings, exports, or APIs.

### Validation

- Passed dataset table projection, synchronization, column deletion, and generation/MCP/seed suites, TypeScript, frontend build, server build, `local:check`, and `git diff --check`.
- Browser-validated the shared 12-case generated-video dataset: the output column appeared in the table, five generation-record columns showed as `0/5`, show-all/reset-default and output-only expand/collapse behaved correctly, media players mounted, and the console had no errors.

## 2026-08-13: Evaluation reference media strip

### Completed

- Replaced the collapsed reference thumbnail/count entry with one shared full-width strip below the prompt and above candidates in pairwise, Arena-rank, and score/Rubric evaluation screens.
- Added ordered recursive recovery for `image_urls`, nested `elements`, audio/video fields, first/end frames, saved references, and legacy tasks. URLs are normalized and deduplicated without collecting model outputs or ordinary links from Prompt, notes, descriptions, or nested element text.
- Images and videos use compact contained previews and an image/video-only fullscreen viewer; audio uses a compact native control. No per-item source names or count badges are rendered.
- Reference media stays independent from candidate load readiness, uses metadata-only media preload, wraps on narrow screens, and blocks voting shortcuts while the fullscreen viewer is open.

### Validation

- Passed `test:evaluation-reference-media`, `test:arena`, TypeScript, frontend build, server build, and `local:check`.
- Browser-validated a mixed image/audio/video case on desktop and `390x844`: all three references rendered in source order, audio/video remained paused with metadata preload, the strip wrapped without horizontal overflow, and image/video fullscreen navigation skipped audio and did not trigger voting shortcuts.
## 2026-08-14: Evaluation client storage root fix

### Implemented

- Removed the legacy full `items + votes` localStorage writers. Server-backed evaluations now rehydrate task data and current-user votes from the API, and vote-read failures are visible instead of being treated as zero progress.
- Added versioned IndexedDB stores for raw migration backups, offline sessions, history summaries/details, and one sampled-Arena pending checkpoint.
- Added copy, readback verification, and cleanup migration semantics. Corrupt input, quota failures, interrupted cleanup, and concurrent tabs retain recoverable source data without duplicate history records.
- Added revisioned offline writes, exact Arena checkpoint validation, task-ID route isolation, abortable stale requests, explicit 404/network states, and non-fatal browser-storage warnings.
- Added safe preference/auth storage boundaries. Auth token and user writes roll back on a partial quota failure.
- Added a real Chromium/PostgreSQL/API/Vite CI gate and `docs/evaluation-client-storage-migration.md`.

### Validation completed locally

- Storage unit tests passed for a 188-case rich fixture, quota errors, corrupt JSON, copy/readback/cleanup failures, interrupted migration resume, concurrent tabs, byte-equivalent CSV, out-of-order offline writes, Arena checkpoint invalidation, and auth rollback.
- Nine Chromium checks passed against the isolated worktree URL: near-quota migration and vote reload, missing task, transient network retry, stale task cancellation, IndexedDB unavailability, offline recovery, lazy history CSV, exact sampled-Arena recovery, and MOS/Rubric/Arena-rank/Preview server progress reload.
- Generation/MCP, generation PostgreSQL, dataset synchronization/import/clone/delete/filter/table projection, versioned sync PostgreSQL, structured evaluation audit, Arena, rank ties, insights, page metadata, layout, project contract, and API smoke tests passed.
- TypeScript, server build, and frontend production build passed. No paid generation request was executed.
- A previous local browser run used the wrong environment variable and opened an unrelated port 3000 app; that result was discarded. All browser results listed above use `E2E_BASE_URL=http://127.0.0.1:3003` and the current isolated worktree.

# 结果洞察单页合并与卡死修复（2026-08-14）

- 状态：已完成。
- 删除 `showInsights` 双页面与伪返回入口；项目、任务和离线结果统一进入一页洞察，顶部返回操作按实际来源返回。
- A/B、Arena-rank、评分/Rubric 和 Pairwise 共用逐 case 证据模型；核心结论与全部模型产物直接展示，逐评委原始记录在 case 内按需展开。
- 媒体仅在接近视口后加入全局 6 路初始化队列；离屏暂停播放器释放资源，播放中媒体保持挂载，单个媒体失败不影响整页。
- items 与 votes 并行读取，切换物料、评委范围或刷新时取消旧请求，并通过请求序号拒绝过期响应。
- 专项回归、统计与路由测试、TypeScript、前后端构建、API smoke 和本地连通检查全部通过。
- 浏览器验证桌面与 390x844 窄屏无横向溢出；视口外媒体不请求，滚入后加载、离开后释放，原始评审记录展开正常。

## 2026-08-17: 首页物料项目入口与详情弹窗修复

### Implemented

- 首页“最近评测物料”的名称、整行和操作按钮统一进入物料所属项目；未归属物料不再暴露行、名称或键盘交互。
- `/tasks/:id` 详情深链只自动打开一次；关闭会取消详情请求、清空局部状态并进入 `/tasks`，列表内“查看 / 编辑”仍保持本地弹窗语义。
- 详情 items 使用 `LatestRequestGate` 和 `AbortSignal`，空结果、失败、关闭、切换和卸载均不会形成请求循环或跨任务响应污染。
- 详情视频和音频默认暂停并保留独立原生 controls；弹窗补齐 dialog、标题关联和关闭按钮可访问性语义。

### Validation

- package.json 中全部 `test:*` 脚本通过，其中完整 Chromium E2E 为 16/16；新增六项覆盖首页三种入口、未归属行、深链关闭、空/失败单请求、慢响应隔离及音视频播放状态。
- TypeScript、前端生产构建、服务端构建、API smoke、数据库集成、当前 checkout 本地健康检查、Docker 生产镜像构建及 `git diff --check` 全部通过。
- `package-lock.json` 未修改。npm 审计显示锁文件既有的 15 项生产依赖告警；本次改动未引入或升级依赖，该跨范围升级债务未在本修复中处理。
## 2026-08-18: Hidden owner magic access

### Completed

- Baseline refreshed from official `origin/main` at `3e6f225`; implementation branch is `codex/owner-magic-access`.
- Added 256-bit generated keys, deployment-hash fingerprint matching, an immutable first binding, signed HttpOnly owner sessions, revocation versions, key-rotation invalidation, same-origin cookie mutations, and Bearer-first fallback authentication.
- Added the hidden fragment route, immediate URL cleanup, no-store/no-referrer/noindex controls, same-user browser recovery, a read-only generator, migration 015, optional GitHub/Kubernetes configuration, and feature-off 404 behavior.
- No phone number or Feishu contact invitation URL will be stored or used by the implementation.

### Validation

- Passed owner cryptography/Cookie tests, disabled-state 404 tests, PostgreSQL binding tests, complete API smoke, project/storage/metadata regressions, TypeScript, frontend and server production builds, and `git diff --check`.
- All 27 Chromium checks passed, including normal-login invisibility, fragment cleanup, same-user cookie access, and recovery after clearing browser data. Test bindings were removed and verified at zero rows.
- No production key was generated, no GitHub secret was changed, and no deployment was triggered. Production activation still requires the documented two-stage rollout and the intended user's one-time Feishu binding.

## 2026-08-18: Owner access Unicode identity hotfix

- Live diagnostics proved that existing data was not deleted: project requests never left the browser because the Chinese owner display name was copied into the legacy `X-User-Name` HTTP header and Fetch rejected the non-Latin-1 value.
- Cloud sessions without a Bearer token now rely exclusively on the signed HttpOnly owner Cookie. Legacy `X-User-*` headers remain unchanged for offline/local mode, while Feishu sessions continue to send the Bearer token.
- The owner browser regression now binds the Chinese display name `面包干`, verifies the same stored identity, and requires a real `/api/projects` request without the non-Latin-1 console failure.
- TypeScript lint, frontend/server production builds, owner security tests, project contracts, and `git diff --check` pass locally. The expanded browser regression will run in the required isolated PostgreSQL CI environment before deployment.

## 2026-08-30: Dataset direct import and Feishu Base intake

### Implemented

- New-dataset creation now defaults to direct import; every source column remains a root-level field with its exact name, order, and value. Legacy field mapping remains an explicit compatibility mode and existing append behavior is unchanged.
- File, paste, and one-time Feishu Base sources share one compiler and two-stage preview/apply contract. Base import reads the full table, ignores the linked view, rechecks the source hash at apply time, and does not persist a source binding.
- Exact known columns receive role/preview annotations only. Existing model-result columns are opt-in, default to none, keep source order, and identity/reserved columns are rejected by UI and server.
- Exact `case_id + variant_label` identities support later synchronization. Sources without `case_id` receive hidden stable IDs and persist an internal-only identity marker that disables synchronization in both UI and API.
- Duplicate/blank headers, reserved columns, missing/duplicate business identities, and over-limit sources fail before creation. CSV/TSV values are no longer trimmed or silently renamed by Papa Parse.

### Validation so far

- Passed direct import, versioned sync, Feishu Base pagination, legacy import mapping, clone, column deletion, table projection/filtering, generation/MCP/seed, evaluation reference media, task scope, Arena/rank, structured audit, projects, results, insights, page metadata, layout, TypeScript, frontend build, and server build.
- Browser QA passed on desktop and 390x844 mobile. It verified the direct mode default, Base/file/paste source tabs, N/N full-column confirmation, unknown-column retention, missing-case-ID warning, successful local import, disabled synchronization, and zero console errors.
- No paid generation ran and no Feishu source was modified. PostgreSQL/API smoke remains pending because the local Docker/PostgreSQL service is not running; the smoke script now includes preview hash conflict, direct persistence, source-binding absence, and internal-identity sync rejection.

## 2026-08-31: Synchronous image crash-loop incident

### Current status

- The 420-second image timeout release allowed 21 of 33 Seedream 5.0 Pro cases to succeed, proving the original 30-second timeout was fixed.
- Twelve remaining submissions were interrupted by repeated ManuEval container restarts. Kubernetes audit status records `lastState.terminated.reason=Error` and `exitCode=139`; the failures were not Aion model rejections.
- The container base is changed from Alpine/musl to pinned official `node:22.23.2-bookworm-slim` for both build and runtime stages. Dev image concurrency is temporarily reduced from four to one while the synchronous path is revalidated.
- A deployment regression test now prevents Alpine from returning and asserts the conservative dev concurrency. It failed against the old Dockerfile and passes after the change.

### Validation

- `test:generation`, TypeScript, frontend production build, server production build, and the deployment regression pass locally.
- Remaining gates: GitHub CI image build/deploy, post-rollout restart-count observation, then retry and verify only the 12 interrupted cases.

## 2026-08-31: Web-service stability isolation

### Evidence

- The Debian/glibc image also restarted repeatedly. Kubernetes events reached six container starts and fourteen BackOff events, including readiness connection resets.
- Aion manager logs for the replacement Pod IP contained model-config GETs but no generation POSTs, so a long paid image request is not required to trigger the native exit.
- Public `502/503` and browser `request failed` states coincide with the single Pod being unready or in restart backoff.

### Isolation release

- Dev generation execution is paused and batch confirmation is rejected with `GENERATION_WORKER_UNAVAILABLE`; preflight remains available and the UI shows an explicit maintenance state.
- Dev API replicas are increased from one to two while the Worker is isolated, removing the single ready-endpoint dependency.
- Deployment now observes Pod identity, readiness, and restart counts for 180 seconds after rollout. Diagnostics include current and previous container logs when the stability gate fails.
- No generation request or retry is part of this isolation release.

## 2026-08-31: Platform heap-exhaustion root cause and repair

### Root cause

- The two Worker-disabled Debian API Pods each restarted three times during the 180-second deployment observation. Both previous-container logs show `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` at roughly 511 MiB V8 heap usage, followed by exit code 139.
- `GET /api/datasets` loaded every `dataset_items` row for every historical version of every dataset on each list request, even though the response materialized only each dataset's current version.
- Dataset, task, project, template, and generation subscriptions used fixed five-second intervals. A slow request did not delay the next interval, so large dataset loads could overlap and multiply the retained PostgreSQL rows and JSON serialization buffers.
- With both service endpoints simultaneously restarting or unready, the public ALB returned 502/503 and the browser surfaced `request failed`.

### Repair

- Routine dataset list/current reads now select only one version ID per dataset; explicit historical-version reads still select the requested version, and the dedicated historical audit query remains unchanged.
- HTTP subscriptions now use single-flight, completion-relative polling. The existing five-second refresh experience remains; manual refresh and scheduled refresh share the same in-flight promise.
- The API logs slow or memory-intensive requests and rejects new non-health API work only after the V8 heap reaches 85% of its limit.
- Dev keeps two API replicas, a bounded 1 GiB V8 heap, and a 2 GiB container limit. Generation execution remains paused.
- Focused runtime regressions, generation regressions, TypeScript, server build, frontend build, and diff checks pass locally. PostgreSQL, browser, deployment soak, and public health verification are pending CI/deployment.

## 2026-08-31: Independent generation Worker implementation

### Implemented

- Added a PostgreSQL worker-instance registry with `starting`, `ready`, and `draining` heartbeats, a 20-second availability TTL, build-version reporting, and stale-row cleanup.
- API batch admission now checks the live Worker fleet. Generation health reports execution enablement, availability, ready count, heartbeat age, and Worker versions; the modal refreshes this state without discarding preflight work.
- Added a dedicated Worker process with internal live/ready endpoints, graceful 600-second drain, continued item lease renewal, and conservative interrupted-submission behavior.
- Added a two-replica Worker Deployment with a distinct selector, no public Service or web-auth secrets, a 768 MiB V8 heap, 1.5 GiB limit, and five-connection database pool. API remains two replicas with its existing memory fix and a five-connection pool.
- Deployment is phased as migration, API stabilization, first-enable queue audit, Worker rollout, joint API/Worker stability observation, and public health probes.

### Validation so far

- The new tests failed first on the missing Worker registry and deployment, then passed after implementation.
- Generation contracts, Worker heartbeat semantics, deployment runtime assertions, TypeScript, server build, Kustomize rendering, manifest phase splitting, and diff checks pass locally.
- PostgreSQL integration, full regressions, CI deployment, dev heartbeat/restart observation, and the independent one-case canary remain pending. No paid request or existing batch operation has run.

## 2026-08-31: Restore image generation concurrency

### Change

- Restored `GENERATION_IMAGE_CONCURRENCY` from the temporary recovery value of one to the established dev value of four in both the API and independent Worker manifests.
- Strengthened deployment regression coverage so API capacity reporting and Worker execution cannot drift.
- Strengthened the PostgreSQL capacity integration scenario to emulate two Worker replicas contending for eight image cases and require exactly four fleet-wide claims.

### Validation status

- Eval-first deployment regression failed against the old value of one as expected.
- `test:generation`, TypeScript, frontend production build, server production build, deployment regression, Kustomize rendering, and `git diff --check` pass locally.
- The rendered dev manifest contains exactly two image-concurrency declarations, one for API capacity reporting and one for Worker execution, and both are four.
- Local PostgreSQL integration could not run because Docker Desktop is not active. CI must pass the two-replica/eight-claim database scenario before the dev rollout is accepted. No paid generation is part of this change.
