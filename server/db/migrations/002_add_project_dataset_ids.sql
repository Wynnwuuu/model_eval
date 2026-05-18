ALTER TABLE projects
ADD COLUMN IF NOT EXISTS dataset_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;
