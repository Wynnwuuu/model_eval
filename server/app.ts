import express from 'express';

import { checkDatabaseHealth } from './db/client.ts';

export const createApp = () => {
  const app = express();

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'eval-studio-api',
    });
  });

  app.get('/api/db/health', async (_req, res) => {
    try {
      const database = await checkDatabaseHealth();
      res.json({
        ok: true,
        database,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown database error';
      res.status(503).json({
        ok: false,
        error: message,
      });
    }
  });

  return app;
};
