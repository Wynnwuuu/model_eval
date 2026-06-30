import { randomUUID } from 'node:crypto';

import type { EvalTask, EvaluationItem, VoteRecord } from '../../src/types.ts';
import type { RequestUser } from '../auth/context.ts';
import { dbPool } from '../db/client.ts';

type TaskRow = {
  id: string;
  project_id: string | null;
  dataset_id: string | null;
  dataset_version_id: string | null;
  template_id: string | null;
  name: string;
  status: EvalTask['status'];
  output_type: EvalTask['outputType'] | null;
  input_type: EvalTask['inputType'] | null;
  evaluation_config_json: EvalTask['evaluationConfig'] | null;
  dimension_columns_json: string[] | null;
  assignees_json: string[] | null;
  progress_json: Record<string, number> | null;
  total_items: number | null;
  external_results_link: string | null;
  has_imported_data: boolean;
  source_json?: Record<string, any> | null;
  created_at: Date;
};

type TaskModelRow = {
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
};

type VoteRow = {
  task_id: string;
  task_item_id: string;
  user_id: string;
  user_email?: string | null;
  user_display_name?: string | null;
  method: VoteRecord['method'] | null;
  choice: string | null;
  ranking_json: VoteRecord['ranking'] | null;
  scores_json: VoteRecord['scores'] | null;
  rubric_responses_json: VoteRecord['rubricResponses'] | null;
  pair_context_json: VoteRecord['pairContext'] | null;
  item_snapshot_json: VoteRecord['itemSnapshot'] | null;
  reason: string | null;
  submitted_at: Date;
};

const toTimestamp = (date: Date | string | number | null | undefined) => {
  if (!date) return Date.now();
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

const mapTask = (row: TaskRow, models: TaskModelRow[], reviewerNames?: Record<string, string>): EvalTask => {
  const source = row.source_json || {};
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id || undefined,
    datasetId: row.dataset_id || '',
    templateId: row.template_id || '',
    evaluationConfig: row.evaluation_config_json || undefined,
    models: models
      .filter(model => model.task_id === row.id)
      .sort((a, b) => a.model_order - b.model_order)
      .map(model => ({
        id: model.model_key,
        name: model.model_name,
      })),
    dimensionColumns: row.dimension_columns_json || [],
    outputType: row.output_type || 'text',
    inputType: row.input_type || undefined,
    assignees: row.assignees_json || [],
    progress: row.progress_json || {},
    reviewerNames: reviewerNames && Object.keys(reviewerNames).length ? reviewerNames : undefined,
    totalItems: row.total_items || undefined,
    status: row.status,
    externalResultsLink: row.external_results_link || undefined,
    hasImportedData: row.has_imported_data,
    creatorUid: source.creatorUid,
    creatorName: source.creatorName,
    createdAt: toTimestamp(row.created_at),
  };
};

// Resolve progress/assignee keys (Feishu userId, email, or legacy display name)
// to human-readable display names from the users table.
const loadReviewerNames = async (
  rows: TaskRow[]
): Promise<Map<string, Record<string, string>>> => {
  const keysByTask = new Map<string, Set<string>>();
  const allKeys = new Set<string>();
  for (const row of rows) {
    const keys = new Set<string>();
    Object.keys(row.progress_json || {}).forEach(key => keys.add(key));
    (row.assignees_json || []).forEach(key => key && keys.add(key));
    keysByTask.set(row.id, keys);
    keys.forEach(key => allKeys.add(key));
  }

  const result = new Map<string, Record<string, string>>();
  if (allKeys.size === 0) return result;

  const userResult = await dbPool.query<{ id: string; email: string | null; display_name: string | null }>(
    `SELECT id, email, display_name FROM users WHERE id = ANY($1) OR email = ANY($1)`,
    [Array.from(allKeys)]
  );
  const nameByKey = new Map<string, string>();
  for (const user of userResult.rows) {
    const name = user.display_name || user.email || user.id;
    if (user.id) nameByKey.set(user.id, name);
    if (user.email) nameByKey.set(user.email, name);
  }

  for (const [taskId, keys] of keysByTask) {
    const names: Record<string, string> = {};
    for (const key of keys) {
      const resolved = nameByKey.get(key);
      if (resolved && resolved !== key) names[key] = resolved;
    }
    if (Object.keys(names).length) result.set(taskId, names);
  }
  return result;
};

const loadTaskRows = async (params: { taskId?: string; projectId?: string } = {}) => {
  const clauses = ['deleted_at IS NULL'];
  const values: any[] = [];
  if (params.taskId) {
    values.push(params.taskId);
    clauses.push(`id = $${values.length}`);
  }
  if (params.projectId) {
    values.push(params.projectId);
    clauses.push(`project_id = $${values.length}`);
  }

  const taskResult = await dbPool.query<TaskRow>(
    `
      SELECT *, source_json
      FROM eval_tasks
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC
    `,
    values
  );
  const taskIds = taskResult.rows.map(row => row.id);
  if (taskIds.length === 0) return { tasks: [], models: [], reviewerNames: new Map() };

  const modelResult = await dbPool.query<TaskModelRow>(
    `
      SELECT *
      FROM eval_task_models
      WHERE task_id = ANY($1)
      ORDER BY task_id, model_order
    `,
    [taskIds]
  );
  const reviewerNames = await loadReviewerNames(taskResult.rows);
  return { tasks: taskResult.rows, models: modelResult.rows, reviewerNames };
};

export const listTasks = async (params: { projectId?: string } = {}): Promise<EvalTask[]> => {
  const rows = await loadTaskRows(params);
  return rows.tasks.map(task => mapTask(task, rows.models, rows.reviewerNames.get(task.id)));
};

export const getTask = async (taskId: string): Promise<EvalTask | null> => {
  const rows = await loadTaskRows({ taskId });
  const task = rows.tasks[0];
  return task ? mapTask(task, rows.models, rows.reviewerNames.get(task.id)) : null;
};

export const listTaskItems = async (taskId: string): Promise<EvaluationItem[]> => {
  const result = await dbPool.query<TaskItemRow>(
    `
      SELECT *
      FROM eval_task_items
      WHERE task_id = $1
      ORDER BY row_index, id
    `,
    [taskId]
  );

  return result.rows.map(row => ({
    id: row.id,
    ...row.payload_json,
    originalData: row.original_data_json,
    dimensionValues: {
      ...(row.payload_json.dimensionValues || {}),
      ...(row.dimension_values_json || {}),
    },
  } as unknown as EvaluationItem));
};

const replaceModels = async (client: any, taskId: string, models: EvalTask['models'] = []) => {
  await client.query('DELETE FROM eval_task_models WHERE task_id = $1', [taskId]);
  for (const [index, model] of models.entries()) {
    await client.query(
      `
        INSERT INTO eval_task_models (
          id,
          task_id,
          model_order,
          model_key,
          model_name
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [`${taskId}:model:${model.id || index}`, taskId, index, model.id || `model-${index}`, model.name || `Model ${index + 1}`]
    );
  }
};

const replaceItems = async (client: any, taskId: string, items: EvaluationItem[] = []) => {
  await client.query('DELETE FROM eval_task_items WHERE task_id = $1', [taskId]);
  const usedItemIds = new Set<string>();
  const usedRowIndexes = new Set<number>();
  let nextRowIndex = 0;
  for (const [index, item] of items.entries()) {
    const rawItemId =
      typeof item.id === 'string' && item.id.trim().length > 0
        ? item.id.trim()
        : `item-${index}`;
    let itemId = `${taskId}:${rawItemId}`;
    if (usedItemIds.has(itemId)) {
      itemId = `${taskId}:${randomUUID()}`;
    }
    usedItemIds.add(itemId);
    const preferredRowIndex = Number((item as any).itemOrder ?? index);
    let rowIndex = Number.isFinite(preferredRowIndex) ? Math.trunc(preferredRowIndex) : index;
    if (rowIndex < 0 || usedRowIndexes.has(rowIndex)) {
      while (usedRowIndexes.has(nextRowIndex)) {
        nextRowIndex += 1;
      }
      rowIndex = nextRowIndex;
    }
    usedRowIndexes.add(rowIndex);
    if (rowIndex >= nextRowIndex) {
      nextRowIndex = rowIndex + 1;
    }

    await client.query(
      `
        INSERT INTO eval_task_items (
          id,
          task_id,
          row_index,
          payload_json,
          original_data_json,
          dimension_values_json
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
      `,
      [
        itemId,
        taskId,
        rowIndex,
        JSON.stringify({ ...item, id: itemId }),
        JSON.stringify((item as any).originalData || {}),
        JSON.stringify(item.dimensionValues || {}),
      ]
    );
  }
};

export const createTask = async (
  task: Omit<EvalTask, 'id'> & Partial<Pick<EvalTask, 'id'>>,
  items: EvaluationItem[] = []
): Promise<EvalTask> => {
  const id = task.id || randomUUID();
  const createdAt = task.createdAt || Date.now();
  const sourceJson = {
    creatorUid: task.creatorUid,
    creatorName: task.creatorName,
  };

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO eval_tasks (
          id,
          organization_id,
          project_id,
          dataset_id,
          template_id,
          name,
          status,
          output_type,
          input_type,
          evaluation_config_json,
          dimension_columns_json,
          assignees_json,
          progress_json,
          total_items,
          external_results_link,
          has_imported_data,
          source_json,
          created_at,
          updated_at
        )
        VALUES (
          $1, 'default', $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
          $11::jsonb, $12::jsonb, $13, $14, $15, $16::jsonb,
          to_timestamp($17 / 1000.0), to_timestamp($17 / 1000.0)
        )
        ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          dataset_id = EXCLUDED.dataset_id,
          template_id = EXCLUDED.template_id,
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          output_type = EXCLUDED.output_type,
          input_type = EXCLUDED.input_type,
          evaluation_config_json = EXCLUDED.evaluation_config_json,
          dimension_columns_json = EXCLUDED.dimension_columns_json,
          assignees_json = EXCLUDED.assignees_json,
          progress_json = EXCLUDED.progress_json,
          total_items = EXCLUDED.total_items,
          external_results_link = EXCLUDED.external_results_link,
          has_imported_data = EXCLUDED.has_imported_data,
          source_json = EXCLUDED.source_json,
          updated_at = EXCLUDED.updated_at,
          deleted_at = NULL
      `,
      [
        id,
        task.projectId || null,
        task.datasetId || null,
        task.templateId || null,
        task.name,
        task.status || 'draft',
        task.outputType || 'text',
        task.inputType || null,
        JSON.stringify(task.evaluationConfig || {}),
        JSON.stringify(task.dimensionColumns || []),
        JSON.stringify(task.assignees || []),
        JSON.stringify(task.progress || {}),
        task.totalItems ?? items.length,
        task.externalResultsLink || null,
        task.hasImportedData ?? false,
        JSON.stringify(sourceJson),
        createdAt,
      ]
    );
    await replaceModels(client, id, task.models || []);
    await replaceItems(client, id, items);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const created = await getTask(id);
  if (!created) throw new Error('Created task was not found');
  return created;
};

export const updateTask = async (taskId: string, patch: Partial<EvalTask>): Promise<EvalTask | null> => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const assignments: string[] = [];
    const values: any[] = [];
    const add = (column: string, value: any, cast?: string) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}${cast ? `::${cast}` : ''}`);
    };

    if (patch.name !== undefined) add('name', patch.name);
    if (patch.projectId !== undefined) add('project_id', patch.projectId || null);
    if (patch.datasetId !== undefined) add('dataset_id', patch.datasetId || null);
    if (patch.templateId !== undefined) add('template_id', patch.templateId || null);
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.outputType !== undefined) add('output_type', patch.outputType);
    if (patch.inputType !== undefined) add('input_type', patch.inputType || null);
    if (patch.evaluationConfig !== undefined) add('evaluation_config_json', JSON.stringify(patch.evaluationConfig), 'jsonb');
    if (patch.dimensionColumns !== undefined) add('dimension_columns_json', JSON.stringify(patch.dimensionColumns), 'jsonb');
    if (patch.assignees !== undefined) add('assignees_json', JSON.stringify(patch.assignees), 'jsonb');
    if (patch.progress !== undefined) add('progress_json', JSON.stringify(patch.progress), 'jsonb');
    if (patch.totalItems !== undefined) add('total_items', patch.totalItems);
    if (patch.externalResultsLink !== undefined) add('external_results_link', patch.externalResultsLink || null);
    if (patch.hasImportedData !== undefined) add('has_imported_data', patch.hasImportedData);

    if (assignments.length > 0) {
      values.push(taskId);
      await client.query(
        `
          UPDATE eval_tasks
          SET ${assignments.join(', ')}, updated_at = now()
          WHERE id = $${values.length} AND deleted_at IS NULL
        `,
        values
      );
    }

    if (patch.models !== undefined) {
      await replaceModels(client, taskId, patch.models);
      await client.query('UPDATE eval_tasks SET updated_at = now() WHERE id = $1 AND deleted_at IS NULL', [taskId]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getTask(taskId);
};

export const updateTaskItem = async (
  taskId: string,
  itemId: string,
  patch: Partial<EvaluationItem>
): Promise<EvaluationItem | null> => {
  const existingResult = await dbPool.query<TaskItemRow>(
    `
      SELECT *
      FROM eval_task_items
      WHERE task_id = $1 AND id = $2
    `,
    [taskId, itemId]
  );
  const existing = existingResult.rows[0];
  if (!existing) return null;

  const payload = {
    ...existing.payload_json,
    ...patch,
    id: itemId,
  };
  const dimensionValues = {
    ...(existing.dimension_values_json || {}),
    ...(patch.dimensionValues || {}),
  };
  await dbPool.query(
    `
      UPDATE eval_task_items
      SET payload_json = $3::jsonb,
          original_data_json = $4::jsonb,
          dimension_values_json = $5::jsonb,
          updated_at = now()
      WHERE task_id = $1 AND id = $2
    `,
    [
      taskId,
      itemId,
      JSON.stringify(payload),
      JSON.stringify((payload as any).originalData || existing.original_data_json || {}),
      JSON.stringify(dimensionValues),
    ]
  );

  return {
    id: itemId,
    ...payload,
    dimensionValues,
  } as EvaluationItem;
};

const syncTaskItemCounts = async (client: any, taskId: string) => {
  const itemCountResult = await client.query(
    'SELECT COUNT(*)::int AS count FROM eval_task_items WHERE task_id = $1',
    [taskId]
  ) as { rows: Array<{ count: string }> };
  const totalItems = Number(itemCountResult.rows[0]?.count || 0);

  const taskResult = await client.query(
    'SELECT progress_json FROM eval_tasks WHERE id = $1 AND deleted_at IS NULL',
    [taskId]
  ) as { rows: Array<{ progress_json: Record<string, number> | null }> };
  const existingProgress = taskResult.rows[0]?.progress_json || {};

  const voteCountResult = await client.query(
    `
      SELECT user_id, COUNT(*)::int AS count
      FROM evaluation_votes
      WHERE task_id = $1
      GROUP BY user_id
    `,
    [taskId]
  ) as { rows: Array<{ user_id: string; count: string }> };
  const nextProgress: Record<string, number> = {};
  Object.keys(existingProgress).forEach(key => {
    nextProgress[key] = 0;
  });
  voteCountResult.rows.forEach(row => {
    nextProgress[row.user_id] = Math.min(Number(row.count || 0), totalItems);
  });

  await client.query(
    'UPDATE eval_tasks SET total_items = $2, progress_json = $3::jsonb, updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [taskId, totalItems, JSON.stringify(nextProgress)]
  );
};

export const deleteTaskItem = async (taskId: string, itemId: string): Promise<boolean> => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'DELETE FROM eval_task_items WHERE task_id = $1 AND id = $2',
      [taskId, itemId]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await syncTaskItemCounts(client, taskId);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getVoteUserLabel = (row: VoteRow) => row.user_display_name || row.user_email || row.user_id;

const mapVote = (row: VoteRow): VoteRecord => ({
  itemId: row.task_item_id,
  method: row.method || undefined,
  vote: row.choice === 'A' || row.choice === 'B' || row.choice === 'Tie' ? row.choice : undefined,
  choice: row.choice || undefined,
  ranking: row.ranking_json || undefined,
  scores: row.scores_json || undefined,
  rubricResponses: row.rubric_responses_json || undefined,
  pairContext: row.pair_context_json || undefined,
  itemSnapshot: row.item_snapshot_json && Object.keys(row.item_snapshot_json).length ? row.item_snapshot_json : undefined,
  reason: row.reason || undefined,
  timestamp: toTimestamp(row.submitted_at),
  user: getVoteUserLabel(row),
});

export const listTaskVotes = async (taskId: string): Promise<Array<{
  user: string;
  userId: string;
  displayName?: string;
  email?: string;
  votes: VoteRecord[];
}>> => {
  const result = await dbPool.query<VoteRow>(
    `
      SELECT
        ev.*,
        u.email AS user_email,
        u.display_name AS user_display_name
      FROM evaluation_votes ev
      LEFT JOIN users u ON u.id = ev.user_id
      WHERE ev.task_id = $1
      ORDER BY ev.user_id, ev.submitted_at, ev.id
    `,
    [taskId]
  );

  const grouped = new Map<string, {
    user: string;
    userId: string;
    displayName?: string;
    email?: string;
    votes: VoteRecord[];
  }>();
  result.rows.forEach(row => {
    const existing = grouped.get(row.user_id) || {
      user: getVoteUserLabel(row),
      userId: row.user_id,
      displayName: row.user_display_name || undefined,
      email: row.user_email || undefined,
      votes: [],
    };
    existing.votes.push(mapVote(row));
    grouped.set(row.user_id, existing);
  });
  return Array.from(grouped.values());
};

export const getTaskUserVotes = async (taskId: string, userName: string): Promise<VoteRecord[]> => {
  const result = await dbPool.query<VoteRow>(
    `
      SELECT
        ev.*,
        u.email AS user_email,
        u.display_name AS user_display_name
      FROM evaluation_votes ev
      LEFT JOIN users u ON u.id = ev.user_id
      WHERE ev.task_id = $1
        AND (
          ev.user_id = $2
          OR u.email = $2
          OR u.display_name = $2
        )
      ORDER BY ev.submitted_at, ev.id
    `,
    [taskId, userName]
  );
  return result.rows.map(mapVote);
};

export const getTaskCurrentUserVotes = async (taskId: string, user: RequestUser): Promise<VoteRecord[]> => {
  const stableKeys = Array.from(new Set([user.id, user.email].filter(Boolean)));
  const stableResult = await dbPool.query<VoteRow>(
    `
      SELECT
        ev.*,
        u.email AS user_email,
        u.display_name AS user_display_name
      FROM evaluation_votes ev
      LEFT JOIN users u ON u.id = ev.user_id
      WHERE ev.task_id = $1
        AND (
          ev.user_id = ANY($2)
          OR u.email = ANY($2)
        )
      ORDER BY ev.submitted_at, ev.id
    `,
    [taskId, stableKeys]
  );
  if (stableResult.rows.length > 0) {
    return stableResult.rows.map(mapVote);
  }

  const legacyKeys = Array.from(new Set([user.displayName].filter(Boolean)));
  if (legacyKeys.length === 0) return [];

  const legacyResult = await dbPool.query<VoteRow>(
    `
      SELECT
        ev.*,
        u.email AS user_email,
        u.display_name AS user_display_name
      FROM evaluation_votes ev
      LEFT JOIN users u ON u.id = ev.user_id
      WHERE ev.task_id = $1
        AND (
          ev.user_id = ANY($2)
          OR u.display_name = ANY($2)
        )
      ORDER BY ev.submitted_at, ev.id
    `,
    [taskId, legacyKeys]
  );
  return legacyResult.rows.map(mapVote);
};

const ensureVoteUser = async (client: any, userName: string) => {
  const safeName = userName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const email = `${safeName}@votes.local.eval`;
  await client.query(
    `
      INSERT INTO users (id, email, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = now()
    `,
    [userName, email, userName]
  );
};

const ensureAuthenticatedVoteUser = async (client: any, user: RequestUser) => {
  await client.query(
    `
      INSERT INTO users (id, email, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = now()
    `,
    [user.id, user.email, user.displayName]
  );
};

const deleteAuthenticatedVoteAliases = async (client: any, taskId: string, user: RequestUser) => {
  const directAliases = Array.from(new Set([user.id, user.email].filter(Boolean)));
  await client.query(
    `
      DELETE FROM evaluation_votes
      WHERE task_id = $1
        AND (
          user_id = ANY($2)
          OR user_id IN (
            SELECT id
            FROM users
            WHERE display_name = $3
              AND email LIKE '%@votes.local.eval'
          )
        )
    `,
    [taskId, directAliases, user.displayName]
  );
};

const insertVoteRows = async (client: any, taskId: string, userId: string, votes: VoteRecord[]) => {
  for (const [index, vote] of votes.entries()) {
    await client.query(
      `
        INSERT INTO evaluation_votes (
          id,
          task_id,
          task_item_id,
          user_id,
          method,
          choice,
          ranking_json,
          scores_json,
          rubric_responses_json,
          pair_context_json,
          item_snapshot_json,
          reason,
          submitted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, to_timestamp($13 / 1000.0))
      `,
      [
        `${taskId}:${userId}:${vote.itemId}:${index}`,
        taskId,
        vote.itemId,
        userId,
        vote.method || null,
        vote.choice || vote.vote || null,
        JSON.stringify(vote.ranking || []),
        JSON.stringify(vote.scores || {}),
        JSON.stringify(vote.rubricResponses || {}),
        JSON.stringify(vote.pairContext || {}),
        JSON.stringify(vote.itemSnapshot || {}),
        vote.reason || null,
        vote.timestamp || Date.now(),
      ]
    );
  }
};

const updateTaskProgress = async (client: any, taskId: string, userId: string, progress: number) => {
  const progressResult = await client.query(
    'SELECT progress_json FROM eval_tasks WHERE id = $1 AND deleted_at IS NULL',
    [taskId]
  ) as { rows: Array<{ progress_json: Record<string, number> | null }> };
  const nextProgress = {
    ...(progressResult.rows[0]?.progress_json || {}),
    [userId]: progress,
  };
  await client.query(
    'UPDATE eval_tasks SET progress_json = $2::jsonb, updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [taskId, JSON.stringify(nextProgress)]
  );
};

export const saveTaskUserVotes = async (
  taskId: string,
  userName: string,
  votes: VoteRecord[],
  progress: number
): Promise<VoteRecord[]> => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await ensureVoteUser(client, userName);
    await client.query('DELETE FROM evaluation_votes WHERE task_id = $1 AND user_id = $2', [taskId, userName]);
    await insertVoteRows(client, taskId, userName, votes);
    await updateTaskProgress(client, taskId, userName, progress);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getTaskUserVotes(taskId, userName);
};

export const saveTaskCurrentUserVotes = async (
  taskId: string,
  user: RequestUser,
  votes: VoteRecord[],
  progress: number
): Promise<VoteRecord[]> => {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await ensureAuthenticatedVoteUser(client, user);
    await deleteAuthenticatedVoteAliases(client, taskId, user);
    await insertVoteRows(client, taskId, user.id, votes);
    await updateTaskProgress(client, taskId, user.id, progress);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getTaskCurrentUserVotes(taskId, user);
};

export const deleteTask = async (taskId: string): Promise<boolean> => {
  const result = await dbPool.query(
    `
      UPDATE eval_tasks
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [taskId]
  );
  return (result.rowCount || 0) > 0;
};
