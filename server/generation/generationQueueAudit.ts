import { closeDatabase, dbPool } from '../db/client.ts';

const main = async () => {
  const result = await dbPool.query<{ status: string; total: string }>(
    `
      SELECT status, count(*)::text AS total
      FROM generation_job_items
      WHERE status IN (
        'pending', 'submitting', 'submitted', 'processing', 'reconciling', 'archiving'
      )
      GROUP BY status
      ORDER BY status
    `,
  );
  const counts = Object.fromEntries(result.rows.map(row => [row.status, Number(row.total)]));
  const unsafeCount = (counts.pending || 0) + (counts.submitting || 0);
  console.log('[generation-queue-audit] active queue', counts);
  if (unsafeCount > 0) {
    throw new Error(
      `Worker release blocked: ${unsafeCount} pending/submitting item(s) predate worker isolation.`,
    );
  }
  console.log('[generation-queue-audit] safe to resume submitted task polling and writeback');
};

main()
  .catch(error => {
    console.error('[generation-queue-audit] failed', error);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeDatabase();
  });
