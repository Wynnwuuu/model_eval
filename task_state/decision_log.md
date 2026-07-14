# Arena Decision Log

## 2026-07-14: Dataset versions propagate while evaluated evidence remains immutable

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
