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
  startGenerationWorker();
});

const shutdown = async () => {
  server.close(async () => {
    await stopGenerationWorker();
    await closeDatabase();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
