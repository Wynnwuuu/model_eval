ALTER TABLE evaluation_votes
DROP CONSTRAINT IF EXISTS evaluation_votes_task_item_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluation_votes_active_item_user
ON evaluation_votes (task_item_id, user_id)
WHERE archived_at IS NULL;
