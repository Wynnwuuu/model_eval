CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  external_auth_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  category TEXT,
  priority TEXT,
  type TEXT,
  goal TEXT,
  cycle TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  progress INTEGER NOT NULL DEFAULT 0,
  result_summary TEXT,
  analysis TEXT,
  link TEXT,
  support_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  dimensions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_data_status TEXT,
  source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_steps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  owner_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  execution_type TEXT,
  result_note TEXT,
  material_file_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, step_order)
);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  modality TEXT,
  input_type TEXT,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  category_path_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_version INTEGER NOT NULL DEFAULT 1,
  dataset_card_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  schema_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  column_mappings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_summary TEXT,
  item_count_before INTEGER NOT NULL DEFAULT 0,
  item_count_after INTEGER NOT NULL DEFAULT 0,
  changed_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version)
);

CREATE TABLE IF NOT EXISTS dataset_items (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  case_key TEXT,
  row_index INTEGER NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  dimension_values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, version_id, row_index)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  paradigm TEXT NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS template_dimensions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  dimension_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  weight NUMERIC,
  required BOOLEAN NOT NULL DEFAULT false,
  options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scale_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope TEXT,
  aggregation_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  dataset_id TEXT REFERENCES datasets(id) ON DELETE SET NULL,
  dataset_version_id TEXT REFERENCES dataset_versions(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  output_type TEXT,
  input_type TEXT,
  evaluation_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  dimension_columns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignees_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_items INTEGER,
  external_results_link TEXT,
  has_imported_data BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS eval_task_models (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES eval_tasks(id) ON DELETE CASCADE,
  model_order INTEGER NOT NULL DEFAULT 0,
  model_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  provider TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_task_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES eval_tasks(id) ON DELETE CASCADE,
  dataset_item_id TEXT REFERENCES dataset_items(id) ON DELETE SET NULL,
  row_index INTEGER NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  original_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  dimension_values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, row_index)
);

CREATE TABLE IF NOT EXISTS eval_task_assignees (
  task_id TEXT NOT NULL REFERENCES eval_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  progress_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS evaluation_votes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES eval_tasks(id) ON DELETE CASCADE,
  task_item_id TEXT NOT NULL REFERENCES eval_task_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT,
  choice TEXT,
  ranking_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rubric_responses_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pair_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_item_id, user_id)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  dataset_version_id TEXT REFERENCES dataset_versions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  model_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_column TEXT,
  input_mapping_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  controls_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  total INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  dataset_item_id TEXT REFERENCES dataset_items(id) ON DELETE SET NULL,
  row_index INTEGER NOT NULL,
  case_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT REFERENCES organizations(id),
  actor_user_id TEXT REFERENCES users(id),
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  action TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_org_status_updated ON projects (organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id);
CREATE INDEX IF NOT EXISTS idx_datasets_org_updated ON datasets (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_version_order ON dataset_items (dataset_id, version_id, row_index);
CREATE INDEX IF NOT EXISTS idx_dataset_items_dataset_case ON dataset_items (dataset_id, version_id, case_key);
CREATE INDEX IF NOT EXISTS idx_templates_org_updated ON templates (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_tasks_project_status_created ON eval_tasks (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_tasks_org_status_created ON eval_tasks (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_task_items_task_order ON eval_task_items (task_id, row_index);
CREATE INDEX IF NOT EXISTS idx_eval_task_assignees_user_status ON eval_task_assignees (user_id, status);
CREATE INDEX IF NOT EXISTS idx_evaluation_votes_task_item ON evaluation_votes (task_id, task_item_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_votes_task_user ON evaluation_votes (task_id, user_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_dataset_created ON generation_jobs (dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status_updated ON generation_jobs (status, updated_at DESC);

INSERT INTO organizations (id, name)
VALUES ('default', 'Default Workspace')
ON CONFLICT (id) DO NOTHING;
