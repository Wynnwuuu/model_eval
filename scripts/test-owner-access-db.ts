import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  bindOwnerAccessToUser,
  getOwnerAccessBinding,
  revokeOwnerAccessSessions,
} from '../server/auth/ownerAccessRepository.ts';
import { closeDatabase, dbPool } from '../server/db/client.ts';

const main = async () => {
  const client = await dbPool.connect();
  const suffix = crypto.randomUUID();
  const organizationId = `owner-access-org-${suffix}`;
  const firstUserId = `owner-access-first-${suffix}`;
  const secondUserId = `owner-access-second-${suffix}`;
  const bindingId = `owner-access-binding-${suffix}`;

  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO organizations (id, name) VALUES ($1, $2)',
      [organizationId, 'Owner access transaction test'],
    );
    await client.query(
      'INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3), ($4, $5, $6)',
      [
        firstUserId,
        `${firstUserId}@example.test`,
        'First owner',
        secondUserId,
        `${secondUserId}@example.test`,
        'Second owner',
      ],
    );
    await client.query(
      `
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ($1, $2, 'member'), ($1, $3, 'member')
      `,
      [organizationId, firstUserId, secondUserId],
    );

    const firstBinding = await bindOwnerAccessToUser(bindingId, firstUserId, client);
    assert.equal(firstBinding.userId, firstUserId);
    assert.equal(firstBinding.sessionVersion, 1);
    assert.equal(firstBinding.user.organizationId, organizationId);

    const repeatedBinding = await bindOwnerAccessToUser(bindingId, secondUserId, client);
    assert.equal(repeatedBinding.userId, firstUserId, 'an existing owner binding must not be reassigned');

    assert.equal(await revokeOwnerAccessSessions(bindingId, 1, client), 2);
    assert.equal(await revokeOwnerAccessSessions(bindingId, 1, client), null, 'a stale session version must not revoke twice');
    assert.equal((await getOwnerAccessBinding(bindingId, client))?.sessionVersion, 2);

    await client.query('ROLLBACK');
    console.log('Owner access PostgreSQL tests passed');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
