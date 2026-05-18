import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dbPool } from './client.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'migrations');

const ensureMigrationTable = async () => {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

const loadAppliedMigrations = async () => {
  const result = await dbPool.query<{ filename: string }>(`
    SELECT filename
    FROM schema_migrations
    ORDER BY filename
  `);
  return new Set(result.rows.map(row => row.filename));
};

const runMigration = async (filename: string) => {
  const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `
        INSERT INTO schema_migrations (filename)
        VALUES ($1)
        ON CONFLICT (filename) DO NOTHING
      `,
      [filename]
    );
    await client.query('COMMIT');
    console.log(`[db:migrate] applied ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[db:migrate] failed ${filename}`);
    throw error;
  } finally {
    client.release();
  }
};

const main = async () => {
  await ensureMigrationTable();
  const applied = await loadAppliedMigrations();
  const migrationFiles = (await readdir(migrationsDir))
    .filter(file => /^\d+.*\.sql$/.test(file))
    .sort();

  let appliedCount = 0;
  for (const filename of migrationFiles) {
    if (applied.has(filename)) {
      console.log(`[db:migrate] skipped ${filename}`);
      continue;
    }
    await runMigration(filename);
    appliedCount += 1;
  }

  console.log(`[db:migrate] done, applied ${appliedCount} migration${appliedCount === 1 ? '' : 's'}`);
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbPool.end();
  });
