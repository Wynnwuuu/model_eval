import type { PoolClient } from 'pg';

import {
  detectDatasetColumnRenames,
  inferTaskDatasetBinding,
  planDatasetTaskSync,
  remapTaskDatasetBinding,
} from '../../src/datasetSync.ts';
import { createVoteItemSnapshot } from '../../src/taskItemSnapshot.ts';
import type {
  DatasetSyncSummary,
  DatasetTaskBinding,
  EvalDataset,
  EvalTask,
  EvaluationItem,
} from '../../src/types.ts';

type TaskRow = {
  id: string;
  project_id: string | null;
  dataset_id: string | null;
  template_id: string | null;
  name: string;
  status: EvalTask['status'];
  output_type: EvalTask['outputType'] | null;
  input_type: EvalTask['inputType'] | null;
  evaluation_config_json: EvalTask['evaluationConfig'] | null;
  dimension_columns_json: string[] | null;
  source_json: Record<string, any> | null;
  created_at: Date;
};

type ModelRow = {
  task_id: string;
  model_order: number;
  model_key: string;
  model_name: string;
};

type TaskItemRow = {
  id: string;
  task_id: string;
  row_index: number;
  payload_json: Record<string, any>;
  original_data_json: Record<string, any>;
  dimension_values_json: Record<string, any>;
  source_dataset_item_id: string | null;
  source_dataset_version: number | null;
};

const emptySummary = (): DatasetSyncSummary => ({
  projects: 0,
  tasks: 0,
  taskItemsUpdated: 0,
  taskItemsAdded: 0,
  taskItemsArchived: 0,
  votesUpdated: 0,
  votesArchived: 0,
  warnings: [],
});

const mapTaskItem = (row: TaskItemRow): EvaluationItem => ({
  id: row.id,
  ...row.payload_json,
  itemOrder: row.row_index,
  originalData: row.original_data_json,
  dimensionValues: {
    ...(row.payload_json.dimensionValues || {}),
    ...(row.dimension_values_json || {}),
  },
  sourceDatasetItemId: row.source_dataset_item_id || row.payload_json.sourceDatasetItemId,
  sourceDatasetVersion: row.source_dataset_version || row.payload_json.sourceDatasetVersion,
} as EvaluationItem);

const synchronizeVotesForItem = async (
  client: PoolClient,
  taskId: string,
  item: EvaluationItem,
  previousVersion: number,
  nextVersion: number
) => {
  const snapshot = createVoteItemSnapshot(item) || {};
  const result = await client.query(
    `
      UPDATE evaluation_votes
      SET evaluated_item_snapshot_json = CASE
            WHEN evaluated_item_snapshot_json = '{}'::jsonb THEN item_snapshot_json
            ELSE evaluated_item_snapshot_json
          END,
          item_snapshot_json = $3::jsonb,
          dataset_version_evaluated = COALESCE(dataset_version_evaluated, dataset_version_current, $4),
          dataset_version_current = $5,
          content_updated_after_vote = (
            CASE
              WHEN evaluated_item_snapshot_json = '{}'::jsonb THEN item_snapshot_json
              ELSE evaluated_item_snapshot_json
            END - 'sourceDatasetVersion'
          ) <> ($3::jsonb - 'sourceDatasetVersion'),
          updated_at = now()
      WHERE task_id = $1
        AND task_item_id = $2
        AND archived_at IS NULL
    `,
    [taskId, item.id, JSON.stringify(snapshot), previousVersion, nextVersion]
  );
  return result.rowCount || 0;
};

const synchronizeTaskProgress = async (client: PoolClient, taskId: string) => {
  const [itemCountResult, progressResult, taskResult] = await Promise.all([
    client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM eval_task_items WHERE task_id = $1 AND archived_at IS NULL',
      [taskId]
    ),
    client.query<{ user_id: string; count: number }>(
      `
        SELECT vote.user_id, COUNT(*)::int AS count
        FROM evaluation_votes vote
        JOIN eval_task_items item ON item.id = vote.task_item_id
        WHERE vote.task_id = $1
          AND vote.archived_at IS NULL
          AND item.archived_at IS NULL
        GROUP BY vote.user_id
      `,
      [taskId]
    ),
    client.query<{ progress_json: Record<string, number> | null }>(
      'SELECT progress_json FROM eval_tasks WHERE id = $1',
      [taskId]
    ),
  ]);
  const totalItems = Number(itemCountResult.rows[0]?.count || 0);
  const progress: Record<string, number> = {};
  Object.keys(taskResult.rows[0]?.progress_json || {}).forEach(userId => {
    progress[userId] = 0;
  });
  progressResult.rows.forEach(row => {
    progress[row.user_id] = Math.min(Number(row.count || 0), totalItems);
  });
  await client.query(
    'UPDATE eval_tasks SET total_items = $2, progress_json = $3::jsonb, updated_at = now() WHERE id = $1',
    [taskId, totalItems, JSON.stringify(progress)]
  );
};

export const propagateDatasetVersion = async (
  client: PoolClient,
  previousDataset: EvalDataset | null,
  nextDataset: EvalDataset
): Promise<DatasetSyncSummary> => {
  const summary = emptySummary();
  if (!previousDataset || !nextDataset.id || nextDataset.id === 'external-csv') return summary;

  const taskResult = await client.query<TaskRow>(
    `
      SELECT *
      FROM eval_tasks
      WHERE dataset_id = $1
        AND deleted_at IS NULL
      ORDER BY created_at, id
    `,
    [nextDataset.id]
  );
  if (!taskResult.rows.length) return summary;

  summary.tasks = taskResult.rows.length;
  summary.projects = new Set(taskResult.rows.map(row => row.project_id).filter(Boolean)).size;
  const taskIds = taskResult.rows.map(row => row.id);
  const [modelResult, itemResult, currentDatasetItemResult] = await Promise.all([
    client.query<ModelRow>(
      'SELECT * FROM eval_task_models WHERE task_id = ANY($1) ORDER BY task_id, model_order',
      [taskIds]
    ),
    client.query<TaskItemRow>(
      `
        SELECT *
        FROM eval_task_items
        WHERE task_id = ANY($1)
          AND archived_at IS NULL
        ORDER BY task_id, row_index, id
      `,
      [taskIds]
    ),
    client.query<{ id: string; stable_item_id: string }>(
      `
        SELECT item.id, item.stable_item_id
        FROM dataset_items item
        JOIN dataset_versions version ON version.id = item.version_id
        WHERE item.dataset_id = $1
          AND version.version = $2
      `,
      [nextDataset.id, nextDataset.version || 1]
    ),
  ]);
  const datasetItemIdByStableId = new Map(currentDatasetItemResult.rows.map(row => [row.stable_item_id, row.id]));
  const columnRenameMap = detectDatasetColumnRenames(
    previousDataset.items || [],
    nextDataset.items || [],
    previousDataset.columnMappings,
    nextDataset.columnMappings
  );
  const nextColumnKeys = Array.from(new Set([
    ...nextDataset.inputSchema.map(field => field.key),
    ...(nextDataset.items || []).flatMap(row => Object.keys(row)).filter(key => !key.startsWith('__')),
  ]));

  for (const taskRow of taskResult.rows) {
    const models = modelResult.rows
      .filter(model => model.task_id === taskRow.id)
      .sort((left, right) => left.model_order - right.model_order)
      .map(model => ({ id: model.model_key, name: model.model_name }));
    const taskItems = itemResult.rows.filter(item => item.task_id === taskRow.id).map(mapTaskItem);
    const source = taskRow.source_json || {};
    const baseTask: EvalTask = {
      id: taskRow.id,
      name: taskRow.name,
      projectId: taskRow.project_id || undefined,
      datasetId: nextDataset.id,
      datasetBinding: source.datasetBinding,
      templateId: taskRow.template_id || '',
      evaluationConfig: taskRow.evaluation_config_json || undefined,
      models,
      dimensionColumns: taskRow.dimension_columns_json || [],
      outputType: taskRow.output_type || 'text',
      inputType: taskRow.input_type || undefined,
      status: taskRow.status,
      createdAt: taskRow.created_at.getTime(),
    };
    const inferredBinding = inferTaskDatasetBinding(baseTask, taskItems, previousDataset.columnMappings);
    const binding = {
      ...remapTaskDatasetBinding(
        inferredBinding,
        previousDataset.columnMappings,
        nextDataset.columnMappings,
        nextColumnKeys,
        columnRenameMap
      ),
      datasetVersion: nextDataset.version || inferredBinding.datasetVersion,
    };
    const task: EvalTask = {
      ...baseTask,
      datasetBinding: binding,
      models: models.map(model => ({
        ...model,
        name: binding.modelColumns[model.id] || model.name,
      })),
    };
    const plan = planDatasetTaskSync({
      task,
      previousRows: previousDataset.items || [],
      nextRows: nextDataset.items || [],
      taskItems,
      nextVersion: nextDataset.version || 1,
    });
    summary.warnings.push(...plan.warnings);

    for (const update of plan.updates) {
      const stableItemId = update.item.sourceDatasetItemId || null;
      await client.query(
        `
          UPDATE eval_task_items
          SET dataset_item_id = $3,
              payload_json = $4::jsonb,
              original_data_json = $5::jsonb,
              dimension_values_json = $6::jsonb,
              source_dataset_item_id = $7,
              source_dataset_version = $8,
              updated_at = now()
          WHERE task_id = $1 AND id = $2
        `,
        [
          task.id,
          update.itemId,
          stableItemId ? datasetItemIdByStableId.get(stableItemId) || null : null,
          JSON.stringify(update.item),
          JSON.stringify(update.item.originalData || {}),
          JSON.stringify(update.item.dimensionValues || {}),
          stableItemId,
          nextDataset.version || 1,
        ]
      );
      summary.taskItemsUpdated += 1;
      summary.votesUpdated += await synchronizeVotesForItem(
        client,
        task.id,
        update.item,
        previousDataset.version || 1,
        nextDataset.version || 1
      );
    }

    for (const item of plan.additions) {
      const stableItemId = item.sourceDatasetItemId || null;
      await client.query(
        `
          INSERT INTO eval_task_items (
            id, task_id, dataset_item_id, row_index, payload_json, original_data_json,
            dimension_values_json, source_dataset_item_id, source_dataset_version
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
          ON CONFLICT (id) DO UPDATE SET
            dataset_item_id = EXCLUDED.dataset_item_id,
            row_index = EXCLUDED.row_index,
            payload_json = EXCLUDED.payload_json,
            original_data_json = EXCLUDED.original_data_json,
            dimension_values_json = EXCLUDED.dimension_values_json,
            source_dataset_item_id = EXCLUDED.source_dataset_item_id,
            source_dataset_version = EXCLUDED.source_dataset_version,
            archived_at = NULL,
            archived_reason = NULL,
            updated_at = now()
        `,
        [
          item.id,
          task.id,
          stableItemId ? datasetItemIdByStableId.get(stableItemId) || null : null,
          item.itemOrder || 0,
          JSON.stringify(item),
          JSON.stringify(item.originalData || {}),
          JSON.stringify(item.dimensionValues || {}),
          stableItemId,
          nextDataset.version || 1,
        ]
      );
      summary.taskItemsAdded += 1;
    }

    for (const archive of plan.archives) {
      const archivedAt = Date.now();
      const reason = archive.item.archivedReason || `来源评测集 v${nextDataset.version || 1} 已移除`;
      await client.query(
        `
          UPDATE eval_task_items
          SET archived_at = to_timestamp($3 / 1000.0), archived_reason = $4, source_dataset_version = $5, updated_at = now()
          WHERE task_id = $1 AND id = $2
        `,
        [task.id, archive.itemId, archivedAt, reason, nextDataset.version || 1]
      );
      const voteResult = await client.query(
        `
          UPDATE evaluation_votes
          SET archived_at = to_timestamp($3 / 1000.0),
              archived_reason = $4,
              dataset_version_current = $5,
              content_updated_after_vote = TRUE,
              updated_at = now()
          WHERE task_id = $1 AND task_item_id = $2 AND archived_at IS NULL
        `,
        [task.id, archive.itemId, archivedAt, reason, nextDataset.version || 1]
      );
      summary.taskItemsArchived += 1;
      summary.votesArchived += voteResult.rowCount || 0;
    }

    for (const model of task.models) {
      await client.query(
        'UPDATE eval_task_models SET model_name = $3, updated_at = now() WHERE task_id = $1 AND model_key = $2',
        [task.id, model.id, model.name]
      );
    }
    const nextSource = {
      ...source,
      datasetBinding: plan.binding,
      datasetSync: {
        datasetVersion: nextDataset.version || 1,
        synchronizedAt: Date.now(),
        warnings: plan.warnings,
      },
    };
    await client.query(
      'UPDATE eval_tasks SET source_json = $2::jsonb, dimension_columns_json = $3::jsonb, updated_at = now() WHERE id = $1',
      [task.id, JSON.stringify(nextSource), JSON.stringify(plan.binding.dimensionColumns)]
    );
    await synchronizeTaskProgress(client, task.id);
  }

  return summary;
};
