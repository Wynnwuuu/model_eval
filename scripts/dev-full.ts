import { spawn, spawnSync } from 'node:child_process';

const POSTGRES_CONTAINER_NAME = 'eval-studio-postgres';

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const read = (command: string, args: string[]) => spawnSync(command, args, {
  encoding: 'utf8',
  shell: false,
});

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
  run('npm', ['run', 'db:up']);
};

console.log('[dev:full] Starting PostgreSQL...');
ensurePostgres();

console.log('[dev:full] Applying database migrations...');
run('npm', ['run', 'db:migrate']);

const env = {
  ...process.env,
  VITE_USE_API_BACKEND: process.env.VITE_USE_API_BACKEND || 'true',
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || 'http://localhost:8787',
};

const children = [
  spawn('npm', ['run', 'api:dev'], {
    stdio: 'inherit',
    env,
  }),
  spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    env,
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
