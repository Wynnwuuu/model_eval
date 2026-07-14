ALTER TABLE dataset_versions
ADD COLUMN IF NOT EXISTS manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS sync_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE dataset_items
ADD COLUMN IF NOT EXISTS stable_item_id TEXT;

WITH ranked_items AS (
  SELECT
    id,
    dataset_id,
    version_id,
    row_index,
    case_key,
    ROW_NUMBER() OVER (
      PARTITION BY dataset_id, version_id, COALESCE(case_key, '__missing_case_key__')
      ORDER BY row_index, id
    ) - 1 AS duplicate_index
  FROM dataset_items
)
UPDATE dataset_items AS target
SET stable_item_id = CONCAT(
  ranked.dataset_id,
  ':item:legacy:',
  MD5(COALESCE(ranked.case_key, CONCAT('row:', ranked.row_index::text))),
  ':',
  ranked.duplicate_index::text
)
FROM ranked_items AS ranked
WHERE target.id = ranked.id
  AND target.stable_item_id IS NULL;

ALTER TABLE dataset_items
ALTER COLUMN stable_item_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dataset_items_version_stable
ON dataset_items (dataset_id, version_id, stable_item_id);

CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_stable
ON dataset_items (dataset_id, stable_item_id);

ALTER TABLE eval_task_items
ADD COLUMN IF NOT EXISTS source_dataset_item_id TEXT,
ADD COLUMN IF NOT EXISTS source_dataset_version INTEGER,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_reason TEXT;

-- Current task item ids retain the original `row-N` marker, which is the
-- strongest deterministic bridge for duplicate case ids and pair expansions.
UPDATE eval_task_items AS task_item
SET source_dataset_item_id = source_item.stable_item_id,
    source_dataset_version = source_dataset.current_version
FROM eval_tasks AS task,
     datasets AS source_dataset,
     dataset_versions AS source_version,
     dataset_items AS source_item
WHERE task_item.task_id = task.id
  AND task.dataset_id = source_dataset.id
  AND source_version.dataset_id = source_dataset.id
  AND source_version.version = source_dataset.current_version
  AND source_item.dataset_id = source_dataset.id
  AND source_item.version_id = source_version.id
  AND task_item.source_dataset_item_id IS NULL
  AND (regexp_match(task_item.payload_json->>'id', 'row-([0-9]+)'))[1] IS NOT NULL
  AND source_item.row_index = ((regexp_match(task_item.payload_json->>'id', 'row-([0-9]+)'))[1])::integer;

-- Fall back to case id only when it is unique. Ambiguous legacy rows remain
-- unbound and are surfaced as synchronization warnings instead of guessed.
WITH unique_source_items AS (
  SELECT
    source_dataset.id AS dataset_id,
    source_dataset.current_version,
    source_item.case_key,
    MIN(source_item.stable_item_id) AS stable_item_id
  FROM datasets AS source_dataset
  JOIN dataset_versions AS source_version
    ON source_version.dataset_id = source_dataset.id
   AND source_version.version = source_dataset.current_version
  JOIN dataset_items AS source_item
    ON source_item.dataset_id = source_dataset.id
   AND source_item.version_id = source_version.id
  GROUP BY source_dataset.id, source_dataset.current_version, source_item.case_key
  HAVING COUNT(*) = 1
)
UPDATE eval_task_items AS task_item
SET source_dataset_item_id = source_item.stable_item_id,
    source_dataset_version = source_item.current_version
FROM eval_tasks AS task,
     unique_source_items AS source_item
WHERE task_item.task_id = task.id
  AND task.dataset_id = source_item.dataset_id
  AND task_item.source_dataset_item_id IS NULL
  AND source_item.case_key = COALESCE(
    task_item.payload_json->>'originalItemId',
    task_item.payload_json->'pairContext'->>'originalItemId'
  );

ALTER TABLE eval_task_items
DROP CONSTRAINT IF EXISTS eval_task_items_task_id_row_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_task_items_active_order
ON eval_task_items (task_id, row_index)
WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_eval_task_items_source
ON eval_task_items (task_id, source_dataset_item_id)
WHERE archived_at IS NULL;

ALTER TABLE evaluation_votes
ADD COLUMN IF NOT EXISTS evaluated_item_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS dataset_version_evaluated INTEGER,
ADD COLUMN IF NOT EXISTS dataset_version_current INTEGER,
ADD COLUMN IF NOT EXISTS content_updated_after_vote BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_reason TEXT;

UPDATE evaluation_votes
SET evaluated_item_snapshot_json = item_snapshot_json
WHERE evaluated_item_snapshot_json = '{}'::jsonb
  AND item_snapshot_json <> '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_evaluation_votes_active_task
ON evaluation_votes (task_id, user_id, submitted_at)
WHERE archived_at IS NULL;
