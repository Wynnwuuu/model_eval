CREATE INDEX IF NOT EXISTS idx_generation_items_scheduler_health
ON generation_job_items (finished_at DESC, job_id)
WHERE finished_at IS NOT NULL
  AND status IN ('succeeded', 'completed', 'failed', 'submission_unknown');
