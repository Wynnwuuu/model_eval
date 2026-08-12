# Arena Decision Log

## 2026-08-11: Separate failure-flow validation from accepted-capacity validation

Immediate Aion rejection cannot prove provider in-flight capacity, so failure-flow evidence and accepted-capacity evidence must be reported separately. The live run used immutable retry/new-batch audit trails and distinct output columns; it never overwrote an existing result or automatically retried an ambiguous or paid failure.

After eight historical HTTP 500 retries and two single-case model/cost canaries all failed in Aion pre-deduction, two concurrent 12-case batches were still run to exercise queue continuation and cross-dataset fairness at useful volume. Their 24 explicit failures drained in about 11 seconds with near-alternating dataset submissions and no capacity cooldown. This validates HTTP-error neutrality and fair scheduling, but not optimistic-wave growth: no request received a task ID, so `8 -> 16 -> 24`, task-ID uniqueness, and accepted-attempt persistence remain unclaimed for this run.

## 2026-08-11: Received HTTP errors are not submission uncertainty

An Aion POST that returns any HTTP response is a completed rejection from ManuEval's perspective. HTTP 4xx and 5xx items therefore become `failed`; only a timeout, reset, or disconnect before any response remains `submission_unknown`. Neither ordinary 5xx nor true submission uncertainty changes model or global capacity, because neither proves a concurrency boundary. Explicit 429, queue-full, concurrency-full, and request-rate signals remain the only capacity feedback.

The repair intentionally does not resubmit terminal items. Existing pending work continues in place, while historical `submission_unknown` rows that recorded HTTP 5xx and no provider task ID are reclassified idempotently with an honest fallback message when the discarded Aion detail cannot be recovered.

## 2026-08-08: Structured Base snapshots remain immutable audit evidence

The source dataset is imported with exactly the 16 visible Base fields and their original order. Transport-only Feishu Markdown URL wrappers may be unwrapped deterministically, but source values are retained in hidden audit metadata and business columns are never renamed, corrected, or augmented with visible audit fields.

The source snapshot is accepted only after two full paginated reads produce the same schema and content hash. Existing dataset IDs with a different source hash must never be overwritten. Stable item IDs derive from `case_id + variant_label + duplicate ordinal`; Feishu record IDs and source row positions remain hidden provenance.

Quality findings and model compatibility results are separate derived artifacts. Media-role mismatches, inaccessible assets, Prompt references, and model parameter conflicts do not silently rewrite requests. A case may become ready only through an explicit batch override or a reviewed source revision, and no audit path may call a paid generation endpoint.

## 2026-08-05: Generation capacity is shared but submission slots are dataset-fair

ManuEval keeps global image/video provider limits because every batch uses the same dedicated VidMuse evaluation account. New submission slots are allocated by least current dataset load, then least current job load, while due polling and archiving remain higher priority. Failed and ambiguous-terminal items never consume provider capacity.

## 2026-08-05: Failed-case skip is an acknowledgement, not an execution rewrite

Pending cases may be cancelled before submission. Failed and `submission_unknown` cases retain their factual execution status; a separate resolution state records that a team member chose not to retry. Selective retries remain child batches so every paid attempt keeps an immutable request/config/cost audit trail.

## 2026-08-05: Retry generation may run early but writeback remains parent-first

A retry child may enter the fair provider queue while its parent is still active, but it cannot write the dataset until the parent writeback succeeds. This preserves the parent's atomic result version and lets the child fill only the selected empty rows without overwriting prior results.


## 2026-08-05: Dataset copies are independent version forks

A dataset copy is built from the exact immutable version the user is viewing. It preserves all business content and visible case IDs, but receives a new dataset ID and regenerated stable item IDs so later task propagation, edits, evidence, and generation writeback cannot cross into the source dataset.

The copy starts at v1 with one version entry and a `copiedFrom` manifest reference. It does not inherit source snapshots, synchronization summaries, linked projects/tasks/votes, or generation jobs. Media objects are not duplicated; their URLs are copied as ordinary cell values.

Both shared and offline modes call the same pure clone builder. The server persists the target dataset and rows in the existing transaction, so partial copies are not exposed and no schema migration is required.
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
## 2026-08-05: Dataset table visibility follows schema roles

The repository table is projected from `inputSchema` order instead of special-casing prompt, dimensions, outputs, and the first two references. Input, output, dimension, reference/media, rubric, and ordinary metadata fields are visible by default. System audit fields remain available through column management but default to hidden. The case ID is first and cannot be hidden.

Visibility is a per-dataset local preference rather than persisted dataset data, so it does not change exports, versions, tasks, generation writeback, or shared API contracts. Media cells mount once when they approach the table viewport to avoid issuing requests for wide columns the reviewer has not reached.

## 2026-08-05: Reference video input remains contract-driven

Simple reference-video columns are exposed only when the live configuration declares `reference_video_urls`, `video_urls`, `video_url`, an element video count range, or the verified Hailuo H3 contract. H3 compiles ordered URLs into `elements[].video_url` with a three-video maximum. Raw elements remains a mutually exclusive advanced mode so existing `@ElementN` numbering is never rewritten.

## 2026-08-05: Duration source is explicit and per case

Uniform, column, and reference-audio duration sources cannot be combined. Audio metadata is measured in the browser without adding server media dependencies, then keyed by stable dataset item ID. The server verifies the URL and case identity and recalculates the supported duration. Missing, multiple, failed, mismatched, or out-of-range audio invalidates only that case.

Mode-specific duration options take precedence over global options when present. Discrete durations snap within 0.15 seconds or round upward; continuous numeric controls retain millisecond precision. The source, detected value, and final value are saved in existing JSON snapshots and `_params_json`, so no migration is required.

## 2026-08-05: Required model inputs include resolved controls

Live model `required_inputs` may list standard request controls such as duration and resolution. Preflight treats values in resolved controls as satisfying those requirements while preserving existing unsupported-input and control-range validation.
## 2026-08-05: Scheduler capacity decisions

The video concurrency value is a global hard ceiling, while each model receives an independent adaptive ceiling. Lowering the global limit alone is a valid emergency rollback even when configured model maxima remain higher.

Only successful outcomes and capacity failures enter the adaptive denominator. Submission uncertainty, 429, provider overload/timeouts, Aion 1200-second timeouts, and the ManuEval generation timeout count as capacity failures. Seed, prompt-length, request-validation, input-preparation, archive, and content-policy failures are excluded.

Pending items with an unexpired worker lease count as occupied submission slots. This closes the interval between claim and provider submission without treating terminal, skipped, or unleased pending items as active.

Polling and archiving existing work remain eligible regardless of model capacity. Capacity changes never cancel, requeue, or resubmit provider tasks.

## 2026-08-06: ManuEval compiles VidMuse inputs; Aion remains the provider adapter

ManuEval accepts VidMuse MCP-standard inputs and deterministically compiles them before calling the existing Aion unified Model API. It does not call provider APIs or duplicate provider field adapters. Every case retains the canonical input, compiler version/profile, asset bindings, compatibility decision, and final Aion request in the existing JSON snapshot.

MCP direct mapping is the default for new preflights, while missing `mappingMode` continues to mean assisted mapping for historical clients and saved snapshots. JSON import preserves structured values and arbitrary metadata; only explicitly mapped fields participate in generation.

Strict mode rejects incompatible keyframe/reference combinations. Seedance and H3 expose an explicit reference fallback that converts keyframes into appended elements and rewrites only the corresponding `@imageN` tokens. Unknown model combinations may proceed after generic and live-config validation with a visible unverified-combination warning; undeclared inputs and invalid prompt references are never silently dropped.
## 2026-08-06: Wan recovery keeps fairness and replaces aggressive adaptation

The task center and organization/dataset/batch max-min scheduler remain in place. They did not create the earliest Wan failures and reverting them would restore starvation without resolving Aion timeouts.

Model limits now have minimum, initial, and maximum values. Cold or stale models start at the initial value instead of the maximum. Every three consecutive successful capacity outcomes raise the effective limit by one; a capacity failure resets it to the minimum. Deterministic request and content failures remain excluded.

ManuEval will not treat a lost final poll as a confirmed generation failure. After the normal task deadline it performs one final Aion query, then uses a non-capacity `reconciling` lane for at most two hours. No reconciliation path resubmits a provider POST.

## 2026-08-06: Failed Wan smoke stays single-shot and concurrency stays at one

The only post-recovery Wan smoke failed at provider submission before ManuEval received a task ID. It is preserved as `submission_unknown`; no automatic or manual paid retry is performed as part of this release.

Wan dev remains fixed at `1/1/1`. A successful single-case smoke is still required before restoring the configured maximum to 6 and allowing the success-streak policy to ramp above one.

Submission diagnostics expose only bounded tokens: HTTP status, Error name, and transport code. Arbitrary error text, response bodies, prompts, media URLs, and credentials are excluded from logs and API diagnostics.

The deployed diagnostic view recovered an HTTP 500 from the existing smoke row. The incident should therefore be investigated as an Aion Manager submission-path failure. It must not be counted as evidence that the new reconciliation path or concurrency-one setting caused a provider generation timeout.

## 2026-08-06: Generation parameters have one explicit source

MCP mapping represents only per-case content. Duration and Seed retain dedicated source strategies; every other declared control or advanced parameter has exactly one binding: uniform, dataset column, or unused. Dataset-column blanks and malformed values invalidate that case and never fall back to a uniform value.

Only the known unified Aion controls are treated as verified top-level request fields. Other live-config parameters, including schema-declared unknowns, start disabled and may be explicitly typed for `extra_params` pass-through with a visible warning. Top-level `reference_image_urls` and `multi_shots` are rejected at the server boundary.

New requests use `parameterBindings` stored in existing JSONB. Omitted bindings retain the legacy compiler path so saved preflights, running jobs, retries, assets, writeback, and evaluation handoff remain compatible without a migration.

## 2026-08-06: Video media channels encode intent, never image-count guesses

New generation requests use `GenerationContentMappingV2`. `image_urls` is exclusively the keyframe channel: one image is a first frame and two ordered images are first/last frames. Ordinary reference images, multi-view identity references, reference videos, and existing element IDs are explicit mutually exclusive `elements` variants; audio references are ordered `audios` entries.

The V2 compiler infers `generation_type` independently per case from non-empty compiled channels. Keyframes mixed with `elements` or `audios`, a tail frame without a first frame, or more than two keyframes is invalid and is never auto-converted. H3 and Wan preserve `images_to_video` as ManuEval's requested semantic mode while recording their known Aion effective `image_to_video` normalization for audit and capability checks.

The MCP contract fixes field meaning and structure, live Aion configuration narrows supported modes and values, model descriptions are displayed but not parsed, and Aion remains the provider-specific adapter. Historical mappings continue through compiler V1 snapshots.

## 2026-08-07: New preflights use a generic reviewed MCP contract

Compiler v3 supersedes new-task model-name profiles. `image_urls` is limited by MCP semantics to one single-image driver or two ordered keyframes; ordinary image/video references and existing element IDs remain in `elements`, and reference audio remains in `audios`. Generation type is derived per case from actual non-empty channels, then narrowed by live structured Aion configuration.

The reviewed default Plugin snapshot can propose Prompt token corrections or an approximate keyframe-to-element conversion, but every proposal is inert until the operator accepts it. Model descriptions remain visible context and are never parsed into runtime rules. Future model support therefore begins with MCP revision 1813 plus live Aion structure, not a hidden model-name branch.

Unknown audio-only and mixed-channel semantics stop for review. A final Aion JSON override is available only with a reason and duplicate-billing confirmation; it is audited as no longer MCP-guaranteed and cannot alter the endpoint, evaluation account, selected model, immutable features, callbacks, output directories, credentials, or unsafe paths. Historical compiler snapshots and execution behavior remain unchanged.

## 2026-08-07: Imported business columns resolve through exact source keys

The VidMuse evaluation preset matches only the exact attachment column names. When import normalization reuses existing business columns, `DatasetSchemaField.sourceKey` is the authoritative bridge from raw names such as `prompt`, `audio_url`, and `case_id` to stored keys such as `完整Prompt`, `音频_URL`, and `用例ID`. Display labels and fuzzy name similarity never activate MCP inputs.

Prompt placeholder auditing is also contract-driven. Compiler v3 checks a token family only when live structured Aion configuration explicitly declares its corresponding media channel; it never infers support from model names or descriptions. Duplicate preflight issues are collapsed for display, while distinct missing indices remain separately auditable.

## 2026-08-08: Seed is an explicit Aion extension, not an MCP default

MCP revision 1813 does not define `seed`, `generation_type`, or `features`. New ManuEval preflights therefore default Seed to `unused`; this omits `extra_params.seed` and delegates behavior to the selected model. ManuEval does not describe that behavior as guaranteed randomness.

Seed support is true only when live `options.supported_params` contains the exact `seed` token. Model names, descriptions, `options.seed`, and camel-case aliases cannot enable it. Any non-unused Seed policy on an unsupported model or the `task_worker` transport is a preflight error, and a manually supplied v2 `extra_params.seed` is rejected.

The deterministic v2 key is `datasetId + stableDatasetItemId`, so the value is stable across model, target-column, and Prompt changes. Legacy running jobs and retries preserve their historical snapshot only when the original contract actually supported and sent Seed.

## 2026-08-08: MCP and Aion requests have a checked projection boundary

Each new case records source cells and mapping intent, normalized MCP tool input, ManuEval's derived `generation_type`, and final Aion JSON. MCP public fields must project from the final Aion request with identical values and ordering. A normal mismatch invalidates the case.

The final Aion request may add only transport-layer fields outside that projection, including top-level `generation_type`, immutable `features.auto_adjust_duration_to_supported=false`, and declared Aion extensions such as `extra_params.seed`. A reviewed forced override may bypass the projection check only with an audited diff and remains labeled as not MCP-guaranteed.

ManuEval guarantees the HTTP JSON it sends to Aion. Provider-specific field conversion performed later by an Aion Adapter is outside the MCP request contract and is not reimplemented in ManuEval.

## 2026-08-08: Media references preserve scalar URL boundaries

A non-JSON media cell is a single scalar unless it uses an explicit newline or pipe delimiter. Ordinary spaces are part of that scalar URL and normalize to `%20`; commas and whitespace are never implicit multi-value separators because signed queries and filenames may contain them. JSON arrays and `{url}` objects remain the preferred ordered multi-reference form.

The compiler records both source and normalized references, but MCP input and final Aion JSON use the same normalized values. Their existing value-and-order projection check remains authoritative.

## 2026-08-08: Preset values require an explicit disposition

For the exact `vidmuse_evaluation_v1` preset, a non-empty `duration`, `aspect_ratio`, `resolution`, or `generate_audio` cell must be sent through a supported binding, explicitly omitted by the operator, or blocked. Missing UI bindings can no longer imply omission.

Unsupported values use `UNSUPPORTED_PRESET_PARAMETER`. Bypassing that contract requires a per-case final Aion JSON; bulk review may share a reason and billing confirmation but never generate or copy request JSON.

## 2026-08-08: Media-role risks do not silently change intent

Image, video, and audio channels are checked against uploaded MIME first and URL pathname extension second. Known mismatches are forceable risks, unknown types are warnings, and localhost/private/single-label hosts are forceable non-public risks. Confirmation preserves the original channel, normalized URL, Prompt, and derived generation mode.

Risk-only confirmation can remain MCP-aligned and therefore does not need a replacement Aion JSON. Manual JSON overrides are a separate path and retain projection-difference audit. Neither path changes Aion, the worker, writeback, stable assets, or human evaluation.

## 2026-08-08: Production navigation and review use one explicit scope

The production workspace has one URL-backed view state. Task buttons switch to dataset selection without opening configuration, and configuration remains disabled until an operator explicitly selects a dataset. Dataset repository browsing keeps its historical first-item fallback, but the production new view never inherits it.

Preflight issue selection is both a presentation filter and the batch-review scope. Counts are deduplicated per case, search and status further narrow the same case array, and bulk confirmation consumes that exact visible array. Final-JSON-required errors remain invalid after bulk confirmation.

Per-case edits are local to the detail dialog until saved into the existing `caseReviews` snapshot. Saved reviews are visibly pending and only affect a request after one explicit re-preflight, preserving request-hash and billing confirmation semantics.

Cases without a stable dataset item ID use a presentation-only dialog key so the operator can still inspect their blocking error and request audit. They cannot save a review because there is no safe persistence key. Likewise, an unchanged dialog cannot be saved, preventing a false “pending re-preflight” state.

## 2026-08-08: Structured evaluation evidence is immutable and separately reviewable

The Feishu `cases / Grid View` source is imported only through the exact 16-column contract. Visible names, order, and values are retained; transport-only select wrappers and Markdown URL wrappers are normalized while the raw API values, record ID, row hash, snapshot hash, and normalization version remain hidden provenance.

The source dataset and the derived 17-column audit dataset use separately verified import envelopes. Existing IDs are accepted only when source hash, normalization version, schema, and every row match. Audit dataset IDs include an audit-contract version so a later rules revision cannot masquerade as the same artifact.

All-model compatibility is a zero-generation compilation against captured live Aion configuration. It records MCP input, ManuEval generation type, final Aion JSON, projection diff, and one of five fixed statuses. It never calls a generation POST and does not claim that the downstream provider Adapter was executed.

Prompt and media quality findings are evidence for human review, not AI scores. Relative, local, single-label, and private-literal media locations are rejected before `ffprobe` or network probing. Full source rows, media URLs, previews, matrices, and reports stay outside Git; only code and redacted fixtures are versioned.

## 2026-08-09: Case review is organized by repair cause, not diagnostic layer

Compiler errors, warnings, and Plugin findings that describe one actionable cause are presented as one repair group. Consequential diagnostics remain auditable but do not compete for separate user decisions.

Guided review edits canonical case inputs and then reruns the authoritative server preflight. The Aion request is read-only in that mode. A full final-request override is a mutually exclusive expert path because it supersedes normal compilation and may break MCP projection.

Per-case overrides are versioned and stored in the existing review JSON snapshot. They are applied after dataset mapping and before MCP compilation, are restricted to MCP content fields and live model parameters, and never update the source dataset or allow reserved request fields.

## 2026-08-09: Filters are temporary views; stable item IDs are generation facts

Dataset column filters are deterministic frontend state only. Exact typed values are compared case-sensitively, search is case-insensitive, same-column values use OR, and different columns use AND. Filters change the table view and generation candidate scope only; downloads, copies, deletion, versions, and stored dataset content remain full-dataset operations.

Opening generation freezes the current dataset ID, version, filter summary, stable item IDs, and presentation indexes for rows lacking stable IDs. Scope resolution treats stable IDs as authoritative; source indexes retain only otherwise unaddressable rows so the UI can report them as blocked. The server never receives a filter expression or source index, only the final ordered `selectedDatasetItemIds` from the existing selector.

Switching between filtered and full scope explicitly resets selection to every currently eligible case in that scope. A zero-row filtered result stays empty and blocked; it never falls back to full-dataset generation. Historical jobs and retries continue to use their stored task snapshots.

## 2026-08-10: Prompt length validation is shape- and contract-aware

Prompt length is measured on the final compiled Prompt using Unicode code points. A scalar limit applies only to a string; arrays require an explicit per-item or joined-text contract. Joined contracts own their separator, trimming, and empty-item behavior so ManuEval does not invent provider semantics.

Structured Aion schemas are authoritative when available, followed by Aion options and then validated ManuEval compatibility rules. Legacy `promptMaxLength` remains a string-only fallback. Model names and natural-language descriptions never select length behavior.

An array without a reliable contract is not converted with `String(array)` and is not approximately measured. It produces a visible `PROMPT_LENGTH_NOT_VERIFIED` warning and is sent unchanged for Aion Adapter validation. Online preflight and offline compatibility audit share this resolver and configuration, preventing the same case from receiving contradictory conclusions.

## 2026-08-10: Column filter menus expose the current cascading domain

When a column menu opens, ManuEval applies every other active column filter and ignores only the current column. Unselected values with zero matching rows are omitted, matching Excel's cascading AutoFilter behavior. A current-column value that was already selected but has become unavailable remains visible in a separate zero-match section until the operator removes it or clears that column.

Filter criteria remain independent. Selecting exact case IDs after a broader `cell_id` filter stores those IDs as their own condition; clearing the earlier `cell_id` filter does not silently expand the selected case set. Generation continues to freeze only the final visible stable item IDs, not candidate-list expressions.

## 2026-08-10: Video capacity is learned from configuration-and-mode evidence

Normal scheduling no longer infers provider capacity from model names, display names or public provider labels. A capacity bucket is the stable Aion model configuration ID plus the compiled `generation_type`; only an explicit Aion `groupId` may warm a replacement configuration, and inheritance is capped at four.

The controller separates provider in-flight capacity from request rate and Worker HTTP concurrency. Video uses two submission executors and six polling executors; RPM errors reduce only the bucket token rate, while confirmed concurrency boundaries reduce its in-flight window. A single timeout is reliability evidence only, and deterministic validation, content, billing and input failures do not train capacity.

New bucket targets grow through 2, 4, 8, 16, 32 and 48 after saturated successes. Capacity beyond the verified window is submitted one probe at a time and becomes verified only after Aion explicitly accepts the request. The first congestion event switches future recovery to additive increase.

Platform capacity starts at 12 and can grow to the hard ceiling of 48. A failure in one bucket cannot reduce the platform window; platform circuit breaking requires recent availability evidence from at least two distinct buckets. Capacity reductions never cancel submitted work.

Policy version changes restart a ten-minute shadow period. During shadow mode and whenever `GENERATION_VIDEO_ADAPTIVE_ENABLED=false`, the existing global-eight and configured model limits remain authoritative. This is the operational rollback path and does not rewrite active or pending task records.

## 2026-08-10: Alternate Prompt columns are explicit review sources

An alternate Prompt column is a versioned per-case review source, not an automatic language fallback. ManuEval does not translate, infer language, judge semantic equivalence, or update the dataset. The existing Prompt format remains authoritative, so text, typed values, and multi-shot JSON are compiled through the same path after replacement.

The server resolves the selected cell from the locked dataset version and stable item ID. Empty values intentionally remove Prompt and must fail normal validation; client-supplied row values are never trusted. Output, reference/media, case-ID, system/internal, dimension, and rubric columns are not eligible sources.

Bulk replacement consumes all `PROMPT_TOO_LONG` cases in the selected preflight, independent of presentation filters. It supersedes Prompt-only edits and Prompt Plugin decisions while preserving other repairs. Expert final Aion JSON is mutually exclusive and blocks the entire operation. Every application creates a new preflight/hash; old preflights remain immutable and cannot silently become the submitted request.

## 2026-08-11: Video capacity uses optimistic accepted-submission waves

Aion returning a task ID is the capacity signal. Video terminal success, timeout, historical replay, saturation ratios, and one-at-a-time probes do not affect admission. A new or stale capacity group starts at eight, opens sixteen after eight accepted submissions, and opens twenty-four after eight more.

Capacity identity is an explicit Aion group ID when one exists and otherwise the model configuration ID. Generation type is audit/display data, not capacity identity. For an explicit group, the group ID is also the stable configuration identity so alternating grouped configurations cannot repeatedly reset the same capacity state.

The platform window is fixed at twenty-four and submission traffic is globally limited to two requests per second with burst two. Provider in-flight capacity remains separate from two submit workers and six poll workers. Policy v4 takes over immediately; there is no terminal-history replay or shadow period.

An explicit concurrency rejection halves a group and cools it for at least sixty seconds. RPM feedback only pauses submission. A second ambiguous 429 within ten minutes also halves the group. Submission uncertainty never retries the case, halves and pauses the group for five minutes, and pauses all new video submissions for sixty seconds. Three availability failures within two minutes open a two-minute group circuit without claiming a discovered concurrency boundary.

The Aion task ID is persisted before acceptance updates and downstream response handling. This separates provider submission ambiguity from local polling, result handling, and archive failures; a local failure after task-ID persistence resumes by polling the existing task instead of fabricating a submission-unknown state.

Successful result archival clears transient poll and reconciliation errors. Provider failures remain immutable evidence, but a task that later succeeds must not carry a stale transport error into the dataset `_error` column.

The live smoke confirmed that supplier completion time is not a useful admission signal: twelve accepted Seedance tasks were submitted in 6.398 seconds, while the first terminal result arrived more than thirty minutes later and one provider task reached its explicit 3600-second timeout. Terminal timeout remains reliability evidence only and does not reduce the accepted-submission window.
## 2026-08-12: Link previews expose names but not business content

Manueval uses `resource name + page type + Manueval` for browser and link-preview titles. The user explicitly accepted unauthenticated preview crawlers seeing resource names. Server-rendered metadata therefore queries names without a user session, but never includes goals, votes, prompts, members, media, production parameters, or result summaries.

Browser metadata and crawler metadata share one deterministic resolver. Static defaults remain generic, missing resources fall back to their page type, HTML values are escaped, and metadata failures cannot block SPA delivery. Search indexing is disabled with `noindex,nofollow`; this does not replace application authorization.

## 2026-08-12: Preflight repair decisions

Preflight diagnostics are a server-owned repair contract, not English strings for the frontend to parse. The server will expose source evidence, model constraints, and only deterministic repair actions supported by the current request snapshot.

Bulk repairs target the same issue code and field, default to all eligible matching cases, and may be narrowed explicitly. They never copy media URLs or final Aion JSON between cases. Expert-request cases and rows without stable IDs remain excluded from ordinary repair actions.

Every applied repair creates a new preflight immediately. Case exclusion changes only the current `selectedDatasetItemIds`; the dataset is immutable and excluded cases can be restored.

## 2026-08-12: Dataset synchronization is identity-based and versioned

Structured dataset maintenance uses the exact composite business key `case_id + variant_label`; `case_id` is required and `variant_label` may be blank, but the pair must be unique in every source snapshot. Source column names and ordering are authoritative. Generation outputs and internal audit columns that are absent from a new source snapshot are retained and merged by stable dataset item ID.

A synchronization is a two-step preview/apply operation. Feishu Base previews read the entire table without applying the linked view filter, then re-read and compare the source snapshot hash at apply time. CSV, TSV, JSON, and pasted data use the immutable preview snapshot. Applying always creates one dataset version and never mutates historical task, vote, or generation snapshots.

Existing cases retain `__datasetItemId`; re-added cases recover the most recent historical ID and platform results; genuinely new identities receive a deterministic ID derived only from the composite identity. Deleting a case removes it from the current version while historical versions and evaluation evidence remain intact.

For each output column, synchronization explicitly chooses preserve-platform, fill-platform-blanks, or source-overwrite-including-blanks. Preserve is the default and overwrite requires a second confirmation. Retained results are marked stale only when generation-relevant source inputs changed. Metadata-only edits do not mark outputs stale, and a successful generation writeback records a fresh input fingerprint.

Dataset synchronization and generation submission take the dataset-row lock first. A stale preflight cannot create a batch after the dataset version changes. Active generation blocks only destructive changes to its selected cases, generation inputs, or target result column; metadata-only edits and unrelated new cases remain allowed.

Column visibility and sorting are presentation state. Output and technical columns default hidden; operators can show individual outputs or all outputs. One-column typed sorting is stable with blanks last and never changes source order, stored order, or generation execution order.

Existing datasets may store an imported `case_id` under a mapped display column such as `用例ID`. Current identity therefore resolves through saved column mappings, while historical restoration falls back to the persisted dataset-item `case_key`; new source snapshots still require an exact `case_id` header.

Replacement controls never infer a pending value from the first allowed option. Raw source value, normalized effective value, model constraints, and the unselected replacement control are separate states.

Repair application uses optimistic concurrency on the Aion configuration fingerprint. A changed fingerprint is a contract change, so the old repair decision is rejected instead of being silently reinterpreted against the new model configuration.

## 2026-08-12: Resizable layout is a local presentation preference

Navigation width, dataset repository pane widths, and per-dataset business-column widths are browser-local presentation state. They do not belong to dataset versions, collaboration records, task snapshots, or server APIs. Dataset copies therefore receive independent default widths even though their business content is cloned.

Pointer drags update CSS geometry through `requestAnimationFrame` and commit React state only at the end of the gesture. Dataset columns use a fixed-layout table plus `colgroup`, keeping the header, every cell, and media preview aligned without re-rendering large case tables on every pointer move. Hidden columns retain their preferences; rename and delete operations explicitly migrate or remove the matching local keys.
