# Arena Decision Log

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

## 2026-07-13: Ties share occupied rank value

A tie tier receives the average of its occupied ranks for both mid-rank and Borda. This preserves the total Borda mass of every ballot. Normalized Borda is averaged per ballot so cases with different candidate counts remain comparable.

## 2026-07-13: Agreement and distinction are separate claims

Exact pair-relation agreement is the primary intuitive agreement measure and Kendall tau-b is the tie-corrected secondary measure. Distinction is reported separately, so unanimous all-tied ballots read as high agreement with zero distinction rather than as a decisive model difference.

## 2026-07-13: Ties do not create significance

Pairwise dominance counts a tie as 0.5, but Wilson intervals and binomial sign tests use decisive relations only. An all-tied pair has 50% dominance and no reportable confidence interval or p-value.
