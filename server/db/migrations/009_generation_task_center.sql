ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS retry_of_item_id TEXT REFERENCES generation_job_items(id) ON DELETE SET NULL;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS resolution_status TEXT;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS resolution_by TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS resolution_at TIMESTAMPTZ;

UPDATE generation_job_items
SET resolution_status = CASE
  WHEN status IN ('failed', 'submission_unknown') THEN 'open'
  WHEN status IN ('succeeded', 'completed', 'cancelled') THEN 'resolved'
  ELSE resolution_status
END
WHERE resolution_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_generation_items_retry_source
ON generation_job_items (retry_of_item_id)
WHERE retry_of_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_generation_items_resolution
ON generation_job_items (resolution_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS generation_job_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  item_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_events_job_created
ON generation_job_events (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generation_events_org_created
ON generation_job_events (organization_id, created_at DESC);
