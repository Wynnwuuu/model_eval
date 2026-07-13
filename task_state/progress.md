# Arena Implementation Progress

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
