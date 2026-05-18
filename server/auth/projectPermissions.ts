import { dbPool } from '../db/client.ts';
import { forbidden, notFound } from '../http/errors.ts';
import type { RequestUser } from './context.ts';

type ProjectRole = 'owner' | 'editor' | 'viewer';

export const ensureProjectRole = async (
  user: RequestUser,
  projectId: string,
  allowedRoles: ProjectRole[]
) => {
  const projectResult = await dbPool.query<{ id: string; source_json: Record<string, any> | null }>(
    `
      SELECT id, source_json
      FROM projects
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [projectId]
  );
  if (!projectResult.rows[0]) {
    throw notFound('Project');
  }

  const roleResult = await dbPool.query<{ role: ProjectRole }>(
    `
      SELECT role
      FROM project_members
      WHERE project_id = $1 AND user_id = $2
    `,
    [projectId, user.id]
  );
  const role = roleResult.rows[0]?.role;
  const initiatorUid = projectResult.rows[0].source_json?.initiatorUid;
  if (!role && initiatorUid === user.id && allowedRoles.includes('owner')) {
    return;
  }
  if (!role || !allowedRoles.includes(role)) {
    throw forbidden('You do not have permission to modify this project');
  }
};

export const ensureTaskProjectRole = async (
  user: RequestUser,
  taskId: string,
  allowedRoles: ProjectRole[]
) => {
  const taskResult = await dbPool.query<{ id: string; project_id: string | null }>(
    `
      SELECT id, project_id
      FROM eval_tasks
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [taskId]
  );
  const task = taskResult.rows[0];
  if (!task) {
    throw notFound('Task');
  }
  if (!task.project_id) {
    return;
  }
  await ensureProjectRole(user, task.project_id, allowedRoles);
};
