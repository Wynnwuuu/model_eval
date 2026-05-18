import type { Pool, PoolClient } from 'pg';

import { dbPool } from '../db/client.ts';
import { badRequest, notFound } from '../http/errors.ts';

type ProjectRole = 'owner' | 'editor' | 'viewer';

export type ProjectMember = {
  projectId: string;
  userId: string;
  email: string;
  displayName: string;
  role: ProjectRole;
  updatedAt: number;
};

const toTimestamp = (date: Date | string | number | null | undefined) => {
  if (!date) return Date.now();
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
};

const assertRole = (role: unknown): ProjectRole => {
  if (role === 'owner' || role === 'editor' || role === 'viewer') return role;
  throw badRequest('member.role must be one of owner, editor, viewer');
};

const loadProjectOrganization = async (projectId: string) => {
  const result = await dbPool.query<{ organization_id: string }>(
    `
      SELECT organization_id
      FROM projects
      WHERE id = $1 AND deleted_at IS NULL
    `,
    [projectId]
  );
  const project = result.rows[0];
  if (!project) throw notFound('Project');
  return project.organization_id;
};

const ensureMemberUser = async (client: Pool | PoolClient, params: {
  userId: string;
  email: string;
  displayName: string;
}) => {
  const existingUser = await client.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE email = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [params.email]
  );
  const userId = existingUser.rows[0]?.id || params.userId;
  await client.query(
    `
      INSERT INTO users (id, email, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = now()
    `,
    [userId, params.email, params.displayName]
  );
  return userId;
};

export const listProjectMembers = async (projectId: string): Promise<ProjectMember[]> => {
  await loadProjectOrganization(projectId);
  const result = await dbPool.query<{
    project_id: string;
    user_id: string;
    email: string;
    display_name: string | null;
    role: ProjectRole;
    updated_at: Date;
  }>(
    `
      SELECT pm.project_id, pm.user_id, u.email, u.display_name, pm.role, pm.updated_at
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY
        CASE pm.role WHEN 'owner' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
        u.email
    `,
    [projectId]
  );

  return result.rows.map(row => ({
    projectId: row.project_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name || row.email,
    role: row.role,
    updatedAt: toTimestamp(row.updated_at),
  }));
};

export const upsertProjectMember = async (
  projectId: string,
  member: { userId?: string; email?: string; displayName?: string; role?: string }
): Promise<ProjectMember> => {
  const organizationId = await loadProjectOrganization(projectId);
  const email = String(member.email || '').trim();
  if (!email) throw badRequest('member.email is required');
  const role = assertRole(member.role);
  const requestedUserId = String(member.userId || email).trim();
  const displayName = String(member.displayName || email).trim();

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    const userId = await ensureMemberUser(client, { userId: requestedUserId, email, displayName });
    await client.query(
      `
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ($1, $2, 'member')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET updated_at = now()
      `,
      [organizationId, userId]
    );
    await client.query(
      `
        INSERT INTO project_members (project_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, user_id) DO UPDATE SET
          role = EXCLUDED.role,
          updated_at = now()
      `,
      [projectId, userId, role]
    );
    await client.query('COMMIT');
    const members = await listProjectMembers(projectId);
    return members.find(item => item.userId === userId)!;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const deleteProjectMember = async (projectId: string, userId: string): Promise<boolean> => {
  await loadProjectOrganization(projectId);
  const memberResult = await dbPool.query<{ role: ProjectRole }>(
    `
      SELECT role
      FROM project_members
      WHERE project_id = $1 AND user_id = $2
    `,
    [projectId, userId]
  );
  const member = memberResult.rows[0];
  if (!member) return false;

  if (member.role === 'owner') {
    const ownerCount = await dbPool.query<{ count: string }>(
      `
        SELECT count(*)::text
        FROM project_members
        WHERE project_id = $1 AND role = 'owner'
      `,
      [projectId]
    );
    if (Number(ownerCount.rows[0]?.count || 0) <= 1) {
      throw badRequest('Project must keep at least one owner');
    }
  }

  const result = await dbPool.query(
    `
      DELETE FROM project_members
      WHERE project_id = $1 AND user_id = $2
    `,
    [projectId, userId]
  );
  return (result.rowCount || 0) > 0;
};
