CREATE TABLE IF NOT EXISTS generation_preflights (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  dataset_version INTEGER NOT NULL,
  model_name TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_preflights_expiry
ON generation_preflights (expires_at);

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS source_dataset_version INTEGER;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS preflight_id TEXT REFERENCES generation_preflights(id) ON DELETE SET NULL;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS request_hash TEXT;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS retry_of_job_id TEXT REFERENCES generation_jobs(id) ON DELETE SET NULL;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS cost_estimate_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS writeback_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS writeback_dataset_version INTEGER;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS execution_error_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

ALTER TABLE generation_jobs
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_jobs_request_hash
ON generation_jobs (request_hash)
WHERE request_hash IS NOT NULL;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS stable_dataset_item_id TEXT;


ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS provider_task_id TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS provider_endpoint_type TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS provider_status TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS next_poll_at TIMESTAMPTZ;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS lease_owner TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS submission_started_at TIMESTAMPTZ;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS archived_asset_id TEXT;

CREATE INDEX IF NOT EXISTS idx_generation_items_claim
ON generation_job_items (status, next_poll_at, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS generation_assets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id TEXT REFERENCES datasets(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES generation_jobs(id) ON DELETE CASCADE,
  job_item_id TEXT REFERENCES generation_job_items(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  file_name TEXT NOT NULL,
  relative_path TEXT,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT,
  size_bytes BIGINT,
  source_url TEXT,
  capability_token_hash TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'generation_job_items_archived_asset_id_fkey'
  ) THEN
    ALTER TABLE generation_job_items
    ADD CONSTRAINT generation_job_items_archived_asset_id_fkey
    FOREIGN KEY (archived_asset_id) REFERENCES generation_assets(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_generation_assets_dataset_created
ON generation_assets (dataset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_assets_job
ON generation_assets (job_id, job_item_id);
