# Visual HTML report

## Status
- Baseline: main@6c42785; isolated branch codex/visual-insight-report.
- Regression defined before implementation: all formal methods, fixed reviewer/dimension scope, 33-case 72/17/10 sample, safe URLs and readable evidence.
- Implemented and verified. Five formal methods share a lazy-loaded, self-contained report generator.
- Passed: HTML unit checks; existing Excel/CSV/JSON, insight summary, dimension options, rank ties and insight-workspace regressions; lint; frontend and server builds.
- Passed: 26 Chromium cases, including real component download buttons, dimension AND scope, offline/no-script reading, image/video/audio decode and retry, 390px layout, actual PDF, and 240-case bounded media loading.
- Visual QA: desktop overview, image/video comparison, narrow screen and PDF first page inspected.
- Local preview: http://127.0.0.1:3011 (offline browser storage; synthetic entry fixture under /e2e/fixtures/insight-report-entry.html).
- Shared local check: frontend HTTP 200; API 8787 is not running, so database/API connectivity was not verified. No production data or generation service was called.
- Release target: main, explicitly authorized by the user. Pre-push checks passed again against remote main@6c42785; use a normal fast-forward push, never force.
- Deployment is handled by the existing test -> build -> deploy_dev GitHub workflow. A successful push is not deployment confirmation. Existing downloaded HTML must be re-exported after deployment.

## Decisions
- Single HTML, light report, inline charts and styles; media uses online portable sources.
- Report statistics are frozen at export. Case search/filter is presentation-only.
- Reuse statistics, top summaries, evidence view models and export identity; never recalculate formulas in the HTML runtime.
- All case entries are present, lazy media limits initialization to six, and print restores all cases/details.
- Existing Excel/CSV/JSON and on-platform chart layout stay intact.
- Missing scoped skip counts stay unknown; CSV imports do not inherit a previous platform import's count.
- Browser tests must scope dimension controls to their section: a similarly named chart drill-down has different export semantics. Verify existing export labels per method instead of assuming one CSV label.
