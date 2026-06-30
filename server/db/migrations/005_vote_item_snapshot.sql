ALTER TABLE evaluation_votes
ADD COLUMN IF NOT EXISTS item_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb;
