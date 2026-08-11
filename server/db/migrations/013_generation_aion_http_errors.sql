UPDATE generation_job_items
SET status = 'failed',
    error_json = error_json || jsonb_build_object(
      'code', 'AION_HTTP_ERROR',
      'message', format(
        'Historical record confirms Aion returned HTTP %s, but the original response detail was not retained.',
        error_json->>'httpStatus'
      ),
      'responseReceived', true,
      'historicalReclassified', true
    ),
    capacity_result_class = 'neutral',
    capacity_observed_at = COALESCE(capacity_observed_at, now()),
    next_poll_at = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    finished_at = COALESCE(finished_at, now()),
    updated_at = now()
WHERE status = 'submission_unknown'
  AND provider_task_id IS NULL
  AND COALESCE(error_json->>'httpStatus', '') ~ '^[0-9]{3}$'
  AND (error_json->>'httpStatus')::integer BETWEEN 500 AND 599;

-- Version 5 changes the meaning of capacity feedback. Recreate every old
-- controller state at the optimistic cold-start window without touching work.
DELETE FROM generation_capacity_states
WHERE policy_version <> 5;
