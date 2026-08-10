CREATE TABLE IF NOT EXISTS generation_capacity_states (
  capacity_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'bucket')),
  model_config_id TEXT,
  model_name TEXT,
  group_id TEXT,
  generation_type TEXT,
  config_fingerprint TEXT,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_version INTEGER NOT NULL,
  enforce_after TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_capacity_group
ON generation_capacity_states (group_id, generation_type, updated_at DESC)
WHERE scope = 'bucket' AND group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_capacity_activity
ON generation_capacity_states (scope, last_activity_at DESC);

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_bucket_key TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_active_at_submit INTEGER;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_limit_at_submit INTEGER;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_global_active_at_submit INTEGER;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_global_limit_at_submit INTEGER;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_config_fingerprint TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_probe BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_global_probe BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_result_class TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS capacity_observed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_generation_items_capacity_active
ON generation_job_items (capacity_bucket_key, status, submission_started_at)
WHERE capacity_bucket_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_items_capacity_unobserved
ON generation_job_items (finished_at, capacity_bucket_key)
WHERE capacity_observed_at IS NULL
  AND status IN ('succeeded', 'completed', 'failed', 'submission_unknown');
