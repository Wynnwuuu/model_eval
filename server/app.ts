import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { authRoutes } from './auth/authRoutes.ts';
import {
  normalizeOwnerAccessKeySha256,
  verifyOwnerAccessFingerprint,
} from './auth/ownerAccessCrypto.ts';
import { serverConfig } from './config.ts';
import { datasetRoutes } from './datasets/datasetRoutes.ts';
import { attachRequestUser } from './auth/context.ts';
import { checkDatabaseHealth } from './db/client.ts';
import { generationPublicAssetRoutes } from './generation/generationPublicAssetRoutes.ts';
import { generationRoutes } from './generation/generationRoutes.ts';
import { badRequest, sendError } from './http/errors.ts';
import { mediaProxyRoutes } from './media/mediaProxyRoutes.ts';
import { projectRoutes } from './projects/projectRoutes.ts';
import { taskRoutes } from './tasks/taskRoutes.ts';
import { templateRoutes } from './templates/templateRoutes.ts';
import {
  getCanonicalPagePath,
  PageMetadataLoaders,
  renderSpaPage,
  resolveServerPageMetadata,
} from './pageMetadata.ts';

const firstForwardedValue = (value?: string) => value?.split(',')[0]?.trim();

const getRequestOrigin = (req: express.Request) => {
  const configuredOrigin = (process.env.PUBLIC_APP_URL || process.env.APP_URL)?.trim();
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      console.warn('Ignoring invalid configured public app URL');
    }
  }

  const forwardedProto = firstForwardedValue(req.header('x-forwarded-proto'));
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : req.protocol === 'https' ? 'https' : 'http';
  const host = firstForwardedValue(req.header('x-forwarded-host'))
    || req.header('host')
    || 'localhost';
  return `${protocol}://${host}`;
};

interface CreateAppOptions {
  staticDistPath?: string;
  pageMetadataLoaders?: PageMetadataLoaders;
}

export const createApp = (options: CreateAppOptions = {}) => {
  const app = express();
  const staticDistPath = path.resolve(
    options.staticDistPath
      || process.env.STATIC_DIST_PATH
      || path.resolve(process.cwd(), 'dist'),
  );

  app.use((req, res, next) => {
    const corsOrigin = process.env.CORS_ORIGIN || '*';
    res.header('Access-Control-Allow-Origin', corsOrigin);
    if (corsOrigin !== '*') res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-User-Id, X-User-Email, X-User-Name, X-Organization-Id');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

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

  app.get('/api/page-metadata', async (req, res) => {
    try {
      const requestedPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
      if (!requestedPath || !requestedPath.startsWith('/') || requestedPath.length > 2048) {
        throw badRequest('path must be a relative application URL');
      }
      const requestedUrl = new URL(requestedPath, 'https://metadata.manueval.local');
      const metadata = await resolveServerPageMetadata(
        requestedUrl.pathname,
        requestedUrl.searchParams,
        options.pageMetadataLoaders,
      );
      res.set('Cache-Control', 'no-store');
      res.json({ metadata });
    } catch (error) {
      sendError(res, error, 'Failed to resolve page metadata');
    }
  });
  app.use('/api/generation-assets', generationPublicAssetRoutes);

  app.use('/api/media-proxy', mediaProxyRoutes);
  app.use('/api/auth', authRoutes);

  app.use('/api/projects', attachRequestUser, projectRoutes);
  app.use('/api/datasets', attachRequestUser, datasetRoutes);
  app.use('/api/templates', attachRequestUser, templateRoutes);
  app.use('/api/tasks', attachRequestUser, taskRoutes);
  app.use('/api/generation', attachRequestUser, generationRoutes);

  app.use('/access', (_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    const keySha256 = normalizeOwnerAccessKeySha256(serverConfig.ownerAccessKeySha256);
    const fingerprint = _req.path.match(/^\/([a-f0-9]{32})\/?$/i)?.[1]?.toLowerCase() || '';
    if (
      !serverConfig.ownerAccessEnabled
      || !keySha256
      || !verifyOwnerAccessFingerprint(fingerprint, keySha256)
    ) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    next();
  });

  if (fs.existsSync(staticDistPath)) {
    const indexPath = path.join(staticDistPath, 'index.html');
    const indexTemplate = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
    app.use(express.static(staticDistPath, { index: false }));
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      if (!indexTemplate) {
        next();
        return;
      }

      try {
        const origin = getRequestOrigin(req);
        const requestedUrl = new URL(req.originalUrl, origin);
        const metadata = await resolveServerPageMetadata(
          requestedUrl.pathname,
          requestedUrl.searchParams,
          options.pageMetadataLoaders,
        );
        const html = renderSpaPage({
          html: indexTemplate,
          metadata,
          canonicalUrl: new URL(
            getCanonicalPagePath(requestedUrl.pathname, requestedUrl.searchParams),
            origin,
          ).toString(),
          origin,
        });
        res.set({
          'Cache-Control': 'private, no-cache, max-age=0, must-revalidate',
          'Content-Type': 'text/html; charset=utf-8',
          Vary: 'Host, X-Forwarded-Host, X-Forwarded-Proto',
        });
        res.send(html);
      } catch (error) {
        console.warn('Failed to render dynamic page metadata', error);
        res.sendFile(indexPath);
      }
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
