ALTER TABLE generation_job_items
DROP CONSTRAINT IF EXISTS generation_job_items_dataset_item_id_fkey;

ALTER TABLE generation_job_items
ADD CONSTRAINT generation_job_items_dataset_item_id_fkey
FOREIGN KEY (dataset_item_id) REFERENCES dataset_items(id) ON DELETE SET NULL;
