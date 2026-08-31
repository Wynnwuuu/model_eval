import { Pool } from 'pg';

import { serverConfig } from '../config.ts';

export const dbPool = new Pool({
  connectionString: serverConfig.databaseUrl,
  connectionTimeoutMillis: serverConfig.databaseConnectionTimeoutMs,
  max: serverConfig.databasePoolMax,
});

export type DatabaseHealth = {
  databaseName: string;
  userName: string;
  tableCount: number;
  checkedAt: string;
};

export const checkDatabaseHealth = async (): Promise<DatabaseHealth> => {
  const result = await dbPool.query<{
    database_name: string;
    user_name: string;
    table_count: string;
    checked_at: Date;
  }>(`
    SELECT
      current_database() AS database_name,
      current_user AS user_name,
      (
        SELECT count(*)::text
        FROM information_schema.tables
        WHERE table_schema = 'public'
      ) AS table_count,
      now() AS checked_at
  `);

  const row = result.rows[0];
  return {
    databaseName: row.database_name,
    userName: row.user_name,
    tableCount: Number(row.table_count),
    checkedAt: row.checked_at.toISOString(),
  };
};

export const closeDatabase = async (): Promise<void> => {
  await dbPool.end();
};
