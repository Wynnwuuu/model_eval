import { createServer } from 'node:http';

import { createApp } from './app.ts';
import { serverConfig } from './config.ts';
import { closeDatabase } from './db/client.ts';
import { startGenerationWorker, stopGenerationWorker } from './generation/generationWorker.ts';
import { logRuntimeMemoryBudget } from './observability/requestResourceMonitor.ts';

const app = createApp();
const server = createServer(app);

server.listen(serverConfig.apiPort, () => {
  console.log(`Eval Studio API listening on http://localhost:${serverConfig.apiPort}`);
  logRuntimeMemoryBudget();
  void startGenerationWorker()?.catch(error => {
    console.error('[generation-worker] integrated worker stopped unexpectedly', error);
  });
});

let shutdownStarted = false;
const shutdown = async () => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await Promise.all([
    new Promise<void>(resolve => server.close(() => resolve())),
    stopGenerationWorker(),
  ]);
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
