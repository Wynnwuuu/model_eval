# Arena Decision Log

## 2026-08-03: Reuse Aion-materialized VidMuse user assets

Aion Model API already materializes successful image/video outputs into the dedicated VidMuse user asset directory and returns `local_path`. ManuEval will use that existing copy instead of downloading and uploading the media again.

The conversion is fail closed: the path must belong to the configured evaluation user, match the requested media directory, and map to the configured VidMuse CDN origin. Invalid or absent paths do not fail or resubmit generation; the individual case keeps the provider URL and is marked temporary. Internal paths never enter API responses or dataset cells.

ManuEval OSS remains a separate future retention layer. Enabling it continues to archive the provider result and marks the output `manueval_oss` without a database migration or Aion change.

## 2026-08-01: Temporary URLs unblock dev generation without OSS

Until a least-privilege OSS identity is available, ManuEval dev uses `GENERATION_ASSET_MODE=temporary_url`. Public CSV URLs pass through unchanged, local uploads are disabled, and returned media URLs are written directly to the new dataset version. This mode preserves execution and human-evaluation flow but does not promise ManuEval-controlled retention.

Shared dev uses the cluster-internal Model API. Local browser diagnostics may use the existing VidFlow task-worker without Planner when the ClusterIP and runner JWT are unavailable. That fallback forwards only standard controls and returns the existing VidMuse CDN URL, so it is diagnostic compatibility rather than the deployment contract.

## 2026-08-01: CLI smoke is a diagnostic fallback, not the production executor

When OSS credentials are unavailable, an authenticated VidMuse CLI thread can verify that a user, model, billing path, and generation backend work end to end without changing Aion. This path is suitable only for a one-off smoke: it runs a Planner and may normalize or override generation parameters, so ManuEval batch execution will continue to call Aion Model API directly and archive outputs to its dedicated OSS prefix.

## 2026-08-01: Reuse verified dev routing, not unrelated storage credentials

ManuEval uses `http://dev-vidmuse-manager-service:443` inside the shared dev ACK namespace and `https://dev-vidmuse-admin.sandaii.cn/admin` for local direct discovery. The dev evaluation user stays in GitHub Actions Secrets. The public ManuEval base URL is derived from the already configured Feishu callback URL unless explicitly overridden.

Existing repository references to `vidmuse-playground`, `athena-artifacts-dev`, ACR credentials, or Aion's own OSS settings do not prove least-privilege ManuEval access, retention, or CORS. They are not reused without an administrator granting a dedicated prefix and RAM identity.

## 2026-08-01: VidMuse generation stays inside ManuEval

Only ManuEval will change. Runtime model discovery calls Aion's existing public configuration endpoint immediately before preflight confirmation, while image/video execution calls the existing Model API from the server with a dedicated dev evaluation user ID. The VidMuse CLI is intentionally not installed in the application container.

Generation runs as a PostgreSQL-backed worker in the existing Express process. Provider POST calls are never retried automatically after dispatch because Aion does not expose a media-generation idempotency key. Ambiguous submissions become `submission_unknown` and require an explicit force retry.

Local and remote media inputs plus generated outputs are archived in a dedicated dev OSS prefix. Dataset writeback happens once at terminal state and merges by stable dataset item ID without overwriting non-empty historical output cells.

## 2026-07-14: Dataset versions propagate while evaluated evidence remains immutable
Configured image/video concurrency is global across Express replicas, not per process. PostgreSQL advisory locks serialize slot acquisition, active item leases are renewed during long input/archive operations, and row locks still prevent duplicate case ownership.

The backend only archives public HTTP(S) media. It rejects local/private DNS results on every redirect, enforces time and byte limits while streaming, verifies the OSS object, and deletes partial objects after failure.


Every committed dataset version updates bound task content and the default result view. Votes keep their original `evaluatedItemSnapshot`; the current `itemSnapshot` may advance with the dataset so results can show the requested latest content without destroying audit evidence.

## 2026-07-14: Dataset source fields win during propagation

Dataset-bound prompt, inputs, dimensions, references, and selected model output columns overwrite task-local copies. Task identity, evaluation configuration, ordering, blind placement, and pair assignment metadata remain task-owned.

## 2026-07-14: Structural sync depends on task lifecycle

Draft and active tasks receive additions and archive removals. Removed active-task votes remain auditable but are excluded from current results. Completed tasks update common cases only and do not change their case set.

## 2026-07-14: Each interactive field save is a version

Case-cell and Dataset Card edits commit immediately as one new dataset version. Optimistic version checks reject stale writes rather than silently overwriting concurrent edits.

## 2026-07-14: Missing columns never shift model identity

Bound model outputs retain their model ID and position even when a source column is absent. A missing binding produces an empty artifact and warning; conservative value/role matching is used for real column renames instead of positional guessing.

## 2026-07-14: Archived votes are evidence, not current statistics

Votes for removed active-task cases are archived and excluded from progress, rankings, and current aggregates. They remain available through a separate audit export with removal version, reason, evaluated snapshot, and last current snapshot. Stale clients receive `409` if they submit against archived items.

## 2026-07-14: Dataset Card derived fields stay read-only

Only source, applicable tasks/stages, Rubric binding, and coverage gaps are editable inside Dataset Card. Sample size, modality/distributions, latest change, and timestamps remain derived from the committed dataset version.

## 2026-07-13: One battle per case per reviewer

Each reviewer sees at most one model pair for a case. Different reviewers may receive different pairs for that case. This avoids repeat-exposure bias and fits the existing `(task_item_id, user_id)` vote uniqueness constraint without a database migration.

## 2026-07-13: Coverage-first adaptive sampling

Sampling first connects the comparison graph and reaches a minimum model exposure, then prioritizes pairings with the largest expected Bradley-Terry uncertainty reduction while retaining uniform exploration.

## 2026-07-13: Partial contributions are first-class

Every saved valid vote enters analysis immediately. Reviewer targets are advisory, and completing all task cases is not required.

## 2026-07-13: Draft targets use automatic resolution

An untouched draft stores `suggestedBattlesPerReviewer: 0` as an internal auto sentinel. Task creation resolves and persists `min(eligible cases, max(20, 2 * model count))`. A positive user-entered value is preserved.

## 2026-07-13: Tiny-sample BT estimates stay conservative

The Bradley-Terry solver uses a symmetric weak penalty on centered model strengths and includes that prior in covariance stabilization. This prevents complete separation after one or two votes from producing runaway scores and falsely narrow intervals while keeping the effect small for mature data.

## 2026-07-13: CSV evidence is vote-specific

Raw Arena CSV imports create a vote item snapshot containing the exact pair IDs, names, URLs, prompt, dimensions, and media type from each row. This avoids attaching the first observed pair's media to other battles on the same case.

## 2026-07-13: Arena-rank is a complete weak order

Every rank ballot contains each eligible model exactly once, while repeated ranks encode ties. Imported non-competition numbering such as `1,1,2,3` is normalized to `1,1,3,4`; legacy strict rankings retain their original meaning.

## 2026-07-13: Media identity stays spatially stable

The randomized anonymous media cards never move while a reviewer edits the ranking. Ordering happens in a separate tier editor so reviewers do not need to visually reacquire moving videos or images.

## 2026-07-13: Arena-rank media order follows rank order

The stable-media decision above is superseded for reviewer usability. Arena-rank now uses the ranking tiers as the single source of truth for both media order and the side editor. Media cards move with rank changes, while anonymous Option labels remain stable so blindness is preserved.

## 2026-07-13: Ties share occupied rank value

A tie tier receives the average of its occupied ranks for both mid-rank and Borda. This preserves the total Borda mass of every ballot. Normalized Borda is averaged per ballot so cases with different candidate counts remain comparable.

## 2026-07-13: Agreement and distinction are separate claims

Exact pair-relation agreement is the primary intuitive agreement measure and Kendall tau-b is the tie-corrected secondary measure. Distinction is reported separately, so unanimous all-tied ballots read as high agreement with zero distinction rather than as a decisive model difference.

## 2026-07-13: Ties do not create significance

Pairwise dominance counts a tie as 0.5, but Wilson intervals and binomial sign tests use decisive relations only. An all-tied pair has 50% dominance and no reportable confidence interval or p-value.

## 2026-08-02: Image mapping is unified while roles remain explicit

The generation dialog uses one optional image-column multiselect, but each selected column retains a reference, start-frame, or end-frame role. This keeps the UI compact without asking Aion to infer keyframe semantics from image order. The existing `referenceImageColumns`, `startImageColumn`, and `endImageColumn` contract remains unchanged, so no migration or Worker change is required.

Generation mode is resolved per case from non-empty media rather than once per batch. Text-only, ordinary reference, start-frame, and start/end-frame cases may coexist; end-only, mixed reference/keyframe, unsupported-mode, and over-limit cases fail preflight independently.

Only Prompt is inferred by default. Image and audio columns remain empty until explicitly selected, and initialization is keyed by stable dataset ID/version so rerenders cannot overwrite user mapping edits.

## 2026-08-04: Generation subsets use stable dataset IDs

The browser always sends an explicit stable-ID selection. The server treats an omitted selection as full-dataset only for old-client compatibility; an explicit empty selection is an error. The selected set is restored to dataset order before validation and hashing so checkbox order cannot change idempotency.

## 2026-08-04: Existing generation results are immutable

A fill-existing batch may target only compatible output columns and only empty rows. Known model mismatches are rejected; old rows without model metadata require a warning. A changed model fingerprint is allowed with a warning because each generated row records its actual model and fingerprint. Writeback remains atomic and rejects any concurrent non-empty target.

## 2026-08-04: Unselected rows receive no generation audit fields

The output schema is dataset-wide, but result, status, error, seed, request ID, and parameter metadata are written only for actual batch items. Retrying stays scoped to failed items from that batch; previously unselected rows require a new fill-existing batch.
