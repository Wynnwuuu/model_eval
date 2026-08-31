import { createServer } from 'node:http';

import { serverConfig } from './config.ts';
import { closeDatabase } from './db/client.ts';
import {
  checkGenerationWorkerReadiness,
  getGenerationWorkerRuntimeState,
  startGenerationWorker,
  stopGenerationWorker,
} from './generation/generationWorker.ts';
import { logRuntimeMemoryBudget } from './observability/requestResourceMonitor.ts';

const healthServer = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health/live') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, service: 'eval-studio-generation-worker' }));
    return;
  }
  if (req.url === '/health/ready') {
    try {
      const readiness = await checkGenerationWorkerReadiness();
      res.statusCode = readiness.ready ? 200 : 503;
      res.end(JSON.stringify({ ok: readiness.ready, ...readiness }));
    } catch (error) {
      res.statusCode = 503;
      res.end(JSON.stringify({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false }));
});

healthServer.listen(serverConfig.generationWorkerHealthPort, () => {
  console.log(`[generation-worker] health server listening on http://localhost:${serverConfig.generationWorkerHealthPort}`);
  logRuntimeMemoryBudget();
});

const workerRun = startGenerationWorker();
if (!workerRun) {
  console.error('[generation-worker] process refused to start', getGenerationWorkerRuntimeState());
  process.exitCode = 1;
  healthServer.close();
} else {
  void workerRun.catch(async error => {
    console.error('[generation-worker] process failed', error);
    await new Promise<void>(resolve => healthServer.close(() => resolve()));
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
}

let shutdownStarted = false;
const shutdown = async () => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await stopGenerationWorker();
  await new Promise<void>(resolve => healthServer.close(() => resolve()));
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
