import { readFile } from 'node:fs/promises';

import { closeDatabase } from '../server/db/client.ts';
import { migrateLocalPlatformState } from '../server/migrations/localPlatformMigration.ts';

type MigrationArgs = {
  source?: string;
  dryRun: boolean;
  userId: string;
  userEmail: string;
  userName: string;
  organizationId: string;
};

const usage = () => `
Usage:
  npm run migrate:postgres -- --source ./local-export.json --dry-run
  npm run migrate:postgres -- --source ./local-export.json

Options:
  --source <path>             JSON export file from localStorage/localPlatform or legacy collection-shaped export.
  --dry-run                   Parse and validate without writing PostgreSQL.
  --user-id <id>              Migration actor user id. Default: migration-user.
  --user-email <email>        Migration actor email. Default: migration-user@local.eval.
  --user-name <name>          Migration actor display name. Default: Migration User.
  --organization-id <id>      Organization id. Default: default.
`;

const parseArgs = (): MigrationArgs => {
  const args = process.argv.slice(2);
  const parsed: MigrationArgs = {
    dryRun: false,
    userId: 'migration-user',
    userEmail: 'migration-user@local.eval',
    userName: 'Migration User',
    organizationId: 'default',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[++index];
    if (arg === '--source') parsed.source = next();
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--user-id') parsed.userId = next() || parsed.userId;
    else if (arg === '--user-email') parsed.userEmail = next() || parsed.userEmail;
    else if (arg === '--user-name') parsed.userName = next() || parsed.userName;
    else if (arg === '--organization-id') parsed.organizationId = next() || parsed.organizationId;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.source) {
    throw new Error(`Missing --source.\n${usage()}`);
  }
  return parsed;
};

const main = async () => {
  const args = parseArgs();
  const localPlatformState = await readFile(args.source!, 'utf8');
  const result = await migrateLocalPlatformState(localPlatformState, {
    dryRun: args.dryRun,
    user: {
      id: args.userId,
      email: args.userEmail,
      displayName: args.userName,
      organizationId: args.organizationId,
    },
  });

  console.log('[migrate:postgres] source counts:', JSON.stringify(result.counts, null, 2));
  result.warnings.forEach(warning => console.warn(`[migrate:postgres] warning: ${warning}`));

  if (args.dryRun) {
    console.log('[migrate:postgres] dry-run completed, no database writes performed.');
  } else {
    console.log('[migrate:postgres] import completed:', JSON.stringify(result.counts, null, 2));
  }
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
