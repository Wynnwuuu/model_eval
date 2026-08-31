CREATE TABLE IF NOT EXISTS generation_worker_instances (
  instance_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('starting', 'ready', 'draining')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_version TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_generation_worker_instances_health
  ON generation_worker_instances (status, last_heartbeat_at DESC);
