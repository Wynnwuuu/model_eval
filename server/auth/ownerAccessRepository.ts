import type { Pool } from 'pg';

import { dbPool } from '../db/client.ts';
import { ApiError } from '../http/errors.ts';
import type { RequestUser } from './context.ts';

type Queryable = Pick<Pool, 'query'>;

interface OwnerAccessBindingRow {
  id: string;
  user_id: string;
  session_version: number;
  email: string;
  display_name: string | null;
  organization_id: string;
}

export interface OwnerAccessBinding {
  id: string;
  userId: string;
  sessionVersion: number;
  user: RequestUser;
}

const toBinding = (row: OwnerAccessBindingRow): OwnerAccessBinding => ({
  id: row.id,
  userId: row.user_id,
  sessionVersion: row.session_version,
  user: {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name || row.email,
    organizationId: row.organization_id || 'default',
  },
});

export const getOwnerAccessBinding = async (
  bindingId: string,
  queryable: Queryable = dbPool,
): Promise<OwnerAccessBinding | null> => {
  const result = await queryable.query<OwnerAccessBindingRow>(
    `
      SELECT
        binding.id,
        binding.user_id,
        binding.session_version,
        users.email,
        users.display_name,
        COALESCE(
          (
            SELECT organization_id
            FROM organization_members
            WHERE user_id = users.id AND organization_id = 'default'
            LIMIT 1
          ),
          (
            SELECT organization_id
            FROM organization_members
            WHERE user_id = users.id
            ORDER BY created_at ASC
            LIMIT 1
          ),
          'default'
        ) AS organization_id
      FROM owner_access_bindings binding
      JOIN users ON users.id = binding.user_id
      WHERE binding.id = $1
        AND users.deleted_at IS NULL
      LIMIT 1
    `,
    [bindingId],
  );
  return result.rows[0] ? toBinding(result.rows[0]) : null;
};

export const bindOwnerAccessToUser = async (
  bindingId: string,
  userId: string,
  queryable: Queryable = dbPool,
): Promise<OwnerAccessBinding> => {
  await queryable.query(
    `
      INSERT INTO owner_access_bindings (id, user_id)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
    `,
    [bindingId, userId],
  );
  const binding = await getOwnerAccessBinding(bindingId, queryable);
  if (!binding) {
    throw new ApiError(500, 'OWNER_ACCESS_BIND_FAILED', 'Owner access binding could not be created');
  }
  return binding;
};

export const revokeOwnerAccessSessions = async (
  bindingId: string,
  expectedSessionVersion: number,
  queryable: Queryable = dbPool,
) => {
  const result = await queryable.query<{ session_version: number }>(
    `
      UPDATE owner_access_bindings
      SET session_version = session_version + 1,
          updated_at = now()
      WHERE id = $1 AND session_version = $2
      RETURNING session_version
    `,
    [bindingId, expectedSessionVersion],
  );
  return result.rows[0]?.session_version || null;
};
