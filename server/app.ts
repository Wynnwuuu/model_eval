import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { datasetRoutes } from './datasets/datasetRoutes.ts';
import { attachRequestUser } from './auth/context.ts';
import { checkDatabaseHealth } from './db/client.ts';
import { generationRoutes } from './generation/generationRoutes.ts';
import { badRequest, sendError } from './http/errors.ts';
import { mediaProxyRoutes } from './media/mediaProxyRoutes.ts';
import { projectRoutes } from './projects/projectRoutes.ts';
import { taskRoutes } from './tasks/taskRoutes.ts';
import { templateRoutes } from './templates/templateRoutes.ts';

export const createApp = () => {
  const app = express();
  const staticDistPath = path.resolve(process.env.STATIC_DIST_PATH || path.resolve(process.cwd(), 'dist'));

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-User-Id, X-User-Email, X-User-Name, X-Organization-Id');
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
      sendError(res, error, 'Unknown database error');
    }
  });

  app.use('/api/media-proxy', mediaProxyRoutes);

  app.use(attachRequestUser);

  app.use('/api/projects', projectRoutes);
  app.use('/api/datasets', datasetRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/generation', generationRoutes);

  if (fs.existsSync(staticDistPath)) {
    app.use(express.static(staticDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(staticDistPath, 'index.html'));
    });
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError) {
      sendError(res, badRequest('Malformed JSON request body'));
      return;
    }
    sendError(res, error);
  });

  return app;
};
