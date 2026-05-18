import type { NextFunction, Request, Response } from 'express';

import { dbPool } from '../db/client.ts';

export type RequestUser = {
  id: string;
  email: string;
  displayName: string;
  organizationId: string;
};

declare global {
  namespace Express {
    interface Request {
      user: RequestUser;
    }
  }
}

const readHeader = (req: Request, name: string) => {
  const value = req.header(name);
  return typeof value === 'string' ? value.trim() : '';
};

const resolveRequestUser = (req: Request): RequestUser => {
  const id = readHeader(req, 'x-user-id') || 'local-dev-user';
  const email = readHeader(req, 'x-user-email') || `${id}@local.eval`;
  const displayName = readHeader(req, 'x-user-name') || email;
  const organizationId = readHeader(req, 'x-organization-id') || 'default';
  return { id, email, displayName, organizationId };
};

export const ensureUserMembership = async (user: RequestUser): Promise<RequestUser> => {
  await dbPool.query(
    `
      INSERT INTO organizations (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
    `,
    [user.organizationId, user.organizationId === 'default' ? 'Default Workspace' : user.organizationId]
  );

  const existingUser = await dbPool.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE email = $1 AND deleted_at IS NULL
      LIMIT 1
    `,
    [user.email]
  );
  const canonicalUser = {
    ...user,
    id: existingUser.rows[0]?.id || user.id,
  };

  await dbPool.query(
    `
      INSERT INTO users (id, email, display_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        updated_at = now()
    `,
    [canonicalUser.id, canonicalUser.email, canonicalUser.displayName]
  );
  await dbPool.query(
    `
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES ($1, $2, 'member')
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        updated_at = now()
    `,
    [canonicalUser.organizationId, canonicalUser.id]
  );

  return canonicalUser;
};

export const attachRequestUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    req.user = await ensureUserMembership(resolveRequestUser(req));
    next();
  } catch (error) {
    next(error);
  }
};
