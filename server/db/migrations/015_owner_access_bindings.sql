CREATE TABLE IF NOT EXISTS owner_access_bindings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_access_bindings_user
  ON owner_access_bindings (user_id);
