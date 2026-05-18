import express from 'express';

import { datasetRoutes } from './datasets/datasetRoutes.ts';
import { checkDatabaseHealth } from './db/client.ts';
import { projectRoutes } from './projects/projectRoutes.ts';
import { templateRoutes } from './templates/templateRoutes.ts';

export const createApp = () => {
  const app = express();

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

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

  app.use('/api/projects', projectRoutes);
  app.use('/api/datasets', datasetRoutes);
  app.use('/api/templates', templateRoutes);

  return app;
};
