import { createServer } from 'node:http';

import { createApp } from './app.ts';
import { serverConfig } from './config.ts';
import { closeDatabase } from './db/client.ts';

const app = createApp();
const server = createServer(app);

server.listen(serverConfig.apiPort, () => {
  console.log(`Eval Studio API listening on http://localhost:${serverConfig.apiPort}`);
});

const shutdown = async () => {
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
