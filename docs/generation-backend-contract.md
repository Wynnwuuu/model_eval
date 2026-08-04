# ManuEval VidMuse Generation Contract

This integration is enabled only in the shared ManuEval dev deployment. The browser never calls Aion directly and never receives the dedicated VidMuse account ID or OSS credentials.

```text
React -> ManuEval Express -> PostgreSQL worker queue -> Aion Model API -> VidMuse user asset, provider fallback, or dev OSS -> dataset version
```

## Model configuration

`GET /api/generation/models` refreshes Aion image and video configuration on every request. ManuEval has no hard-coded production model list and discards configurations explicitly marked `is_enabled=false`, matching the VidMuse CLI's usable-model catalog. Standard parameters become normal controls; other declared `supported_params` or parameter-schema fields become advanced controls.

If Aion is unavailable, the endpoint returns `503 MODEL_CONFIG_UNAVAILABLE` and new submissions are blocked. Existing batches keep using their saved configuration snapshot.
## Execution transports

`AION_EXECUTION_TRANSPORT=model_api` is the shared-dev deployment path. It calls the cluster-internal Model API with `AION_EVAL_USER_ID`, preserving configuration-declared image/video parameters without a Planner.

`AION_EXECUTION_TRANSPORT=task_worker` is a local diagnostic fallback for machines that cannot reach the ClusterIP and do not have a runner JWT. It calls the existing VidFlow task-worker without a Planner, forwards only standard image/video controls, and converts its result file path to the existing VidMuse image/video CDN. It requires a dedicated existing thread and must not replace `model_api` in the shared dev deployment.

## Preflight and submission

`POST /api/generation/preflights` accepts the dataset/version, model name, target column, input mapping, controls, seed policy, selected stable item IDs, and uploaded asset bindings.

The browser sends `targetMode` as `new` or `fill_existing`. New mode requires a column name that does not exist. Fill mode requires an existing compatible output column; known model mismatches are rejected, while legacy rows without model audit metadata produce a warning. `GET /api/generation/health` exposes `maxBatchSize` so clients can enforce the same selected-case limit before preflight.

`selectedDatasetItemIds` has strict compatibility semantics: an omitted field means all cases for legacy clients, but an explicit empty array returns `400`. Unknown, duplicated, or ambiguous stable IDs are rejected. The server restores dataset order before validation and request hashing, so the same selected set is idempotent regardless of checkbox order. Cost estimation, input validation, and task creation operate only on selected cases; invalid selected cases remain visible in preflight but are not queued.


The server reloads that dataset version, rebuilds every case, validates required inputs/assets/controls and target-column conflicts, and returns valid/invalid cases plus a conservative cost estimate. Unknown cost is explicitly reported as unknown.

`POST /api/generation/batches` accepts `{ "batch": { "preflightId": "..." } }`. It reloads live Aion configuration and compares the fingerprint. Changed configuration returns `409`; expired preflight returns `410`. Only valid cases are queued. A unique request hash prevents duplicate-click submissions.

Evaluation video requests always send `features.auto_adjust_duration_to_supported=false`; ManuEval never silently changes evaluation duration.

## Batch lifecycle

- `GET /api/generation/batches/:id`: batch and per-case state.
- `POST /api/generation/batches/:id/cancel`: cancel pending cases only.
- `POST /api/generation/batches/:id/retry`: create a new preflight for failed, cancelled, or ambiguous cases.

```text
pending -> submitting -> submitted -> processing -> archiving -> succeeded
                                  \-> failed
lost POST response -> submission_unknown
pending after cancellation -> cancelled
```

Aion has no submission idempotency key. `submission_unknown` is never resent automatically. Retrying it requires `forceSubmissionUnknown=true` after a duplicate-billing warning. PostgreSQL leases use `FOR UPDATE SKIP LOCKED`; advisory locks enforce image/video concurrency globally across replicas, and active work renews its lease. A process found in `submitting` after restart becomes `submission_unknown`.

## Assets

`GENERATION_ASSET_MODE=oss` remains the ManuEval-controlled durable path. In the dev fallback,
`GENERATION_ASSET_MODE=temporary_url`, public input URLs pass to Aion unchanged. For generated
outputs, ManuEval first validates Aion `local_path`/`file_path` against `AION_EVAL_USER_ID`, the
expected image/video asset directory, and the configured VidMuse CDN host. A valid user asset is
written as a stable VidMuse CDN URL. If the persisted path is missing or fails validation, only
that case falls back to the provider URL and is marked `durability=temporary`. Local uploads remain
disabled. Switching back to `oss` restores ManuEval archival without a schema migration.

- `POST /api/generation/assets/initiate`
- Browser `PUT` to the returned signed OSS URL, or upload all multipart parts.
- `POST /api/generation/assets/:assetId/complete`
- Stable media: `GET /api/generation-assets/:assetId/content?token=...`

CSV local paths match normalized relative paths first and a unique file name second. Public inputs are copied to dev OSS before submission after private-network and redirect checks. Input and output copies enforce the configured byte limit while streaming, then verify the archived OSS object. Dataset cells store stable ManuEval capability URLs that redirect to fresh signed OSS URLs; video Range requests follow the redirect.

OSS CORS must allow the ManuEval dev origin to use `PUT`, `GET`, and `HEAD`, allow `Content-Type`, and expose `ETag`. Multipart completion fails if browser JavaScript cannot read `ETag`.

## Dataset writeback

After all queued cases terminate, the worker creates at most one new dataset version. Rows merge by stable dataset item ID. Existing non-empty results are never overwritten.

Only actual batch items are visited during writeback. Unselected rows retain an empty result and receive no status, error, seed, request ID, or parameter metadata. Later `fill_existing` batches reuse the same output schema and fill only the remaining empty rows; retries remain scoped to failures from their original batch.

The worker writes the requested result column plus `<result>_status`, `<result>_seed`, `<result>_request_id`, `<result>_error`, and `<result>_params_json`. The result cell contains only the selected media URL; `_params_json` records `originalResultUrl` and `durability` for audit. Internal Aion file paths are never exposed through the API or dataset. If a safe merge is impossible, the batch becomes `writeback_conflict` and no partial version is created. Partial-success/cancelled batches still write successful cases and terminal metadata.

## Required dev configuration

- `AION_MANAGER_BASE_URL`, `AION_MODEL_API_BASE_URL`, `AION_EVAL_USER_ID`
- `AION_EXECUTION_TRANSPORT=model_api` in shared dev
- `MANUEVAL_PUBLIC_BASE_URL`
- `GENERATION_ASSET_MODE=temporary_url` while OSS is unavailable

For durable mode, set `GENERATION_ASSET_MODE=oss` and provide
`MANUEVAL_OSS_ACCESS_KEY_ID`, `MANUEVAL_OSS_ACCESS_KEY_SECRET`,
`MANUEVAL_OSS_ENDPOINT`, `MANUEVAL_OSS_REGION`, and `MANUEVAL_OSS_BUCKET`.

The OSS RAM identity must be limited to the configured bucket prefix. No VidMuse CLI, Redis, PVC, or Aion deployment change is required.
