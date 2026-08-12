CREATE TABLE IF NOT EXISTS dataset_sync_previews (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  expected_version INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decisions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ready',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_sync_previews_dataset
ON dataset_sync_previews (dataset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dataset_sync_previews_expiry
ON dataset_sync_previews (expires_at);
