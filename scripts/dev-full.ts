import { spawn, spawnSync } from 'node:child_process';

const POSTGRES_CONTAINER_NAME = 'eval-studio-postgres';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const needsShell = (command: string) => process.platform === 'win32' && command.endsWith('.cmd');

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: needsShell(command),
  });
  if (result.error) {
    console.error(`[dev:full] Failed to run ${command} ${args.join(' ')}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const read = (command: string, args: string[]) => spawnSync(command, args, {
  encoding: 'utf8',
  shell: false,
});

const ensureDockerAvailable = () => {
  const info = read('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (info.status !== 0) {
    console.error('[dev:full] Docker is required for the shared PostgreSQL data source, but Docker is not reachable.');
    if (info.stderr) console.error(info.stderr.trim());
    console.error('[dev:full] Start Docker Desktop, then run npm.cmd run local:start again.');
    process.exit(info.status || 1);
  }
};

const ensurePostgres = () => {
  const inspect = read('docker', ['inspect', POSTGRES_CONTAINER_NAME]);

  if (inspect.status === 0) {
    const running = read('docker', ['inspect', '-f', '{{.State.Running}}', POSTGRES_CONTAINER_NAME]);
    const isRunning = running.status === 0 && running.stdout.trim() === 'true';

    if (isRunning) {
      console.log(`[dev:full] Reusing running PostgreSQL container ${POSTGRES_CONTAINER_NAME}.`);
      return;
    }

    console.log(`[dev:full] Starting existing PostgreSQL container ${POSTGRES_CONTAINER_NAME}...`);
    run('docker', ['start', POSTGRES_CONTAINER_NAME]);
    return;
  }

  console.log('[dev:full] Creating PostgreSQL container...');
  run(npmCommand, ['run', 'db:up']);
};

console.log('[dev:full] Starting PostgreSQL...');
ensureDockerAvailable();
ensurePostgres();

console.log('[dev:full] Applying database migrations...');
run(npmCommand, ['run', 'db:migrate']);

const env = {
  ...process.env,
  VITE_USE_API_BACKEND: process.env.VITE_USE_API_BACKEND || 'true',
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || '',
  VITE_API_PROXY_TARGET: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8787',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
};

const children = [
  spawn(npmCommand, ['run', 'api:dev'], {
    stdio: 'inherit',
    env,
    shell: needsShell(npmCommand),
  }),
  spawn(npmCommand, ['run', 'dev'], {
    stdio: 'inherit',
    env,
    shell: needsShell(npmCommand),
  }),
];

const shutdown = () => {
  children.forEach(child => {
    if (!child.killed) child.kill('SIGTERM');
  });
};

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

children.forEach(child => {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown();
      process.exit(code);
    }
  });
});

console.log('[dev:full] API: http://localhost:8787');
console.log('[dev:full] Web: http://localhost:3000');
