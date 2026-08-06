ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS reconciliation_started_at TIMESTAMPTZ;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS reconciliation_deadline_at TIMESTAMPTZ;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS last_poll_succeeded_at TIMESTAMPTZ;

ALTER TABLE generation_job_items
ADD COLUMN IF NOT EXISTS consecutive_poll_failures INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_generation_items_reconciliation_due
ON generation_job_items (next_poll_at, lease_expires_at, created_at)
WHERE status = 'reconciling';

CREATE INDEX IF NOT EXISTS idx_generation_items_reconciliation_deadline
ON generation_job_items (reconciliation_deadline_at)
WHERE status = 'reconciling';
