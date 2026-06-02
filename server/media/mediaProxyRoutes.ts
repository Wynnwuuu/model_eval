import { Readable } from 'node:stream';
import express from 'express';

import { badRequest } from '../http/errors.ts';

const ALLOWED_MEDIA_HOSTS = new Set(['vidmuse.sandcdn.com', 'vidmuse-dev.sandcdn.com', 'vidmuse-video.sandcdn.com']);
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const PASSTHROUGH_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
];

export const mediaProxyRoutes = express.Router();

const resolveTargetUrl = (rawUrl: unknown) => {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    throw badRequest('url is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw badRequest('url must be an absolute URL');
  }

  if (!ALLOWED_MEDIA_HOSTS.has(parsed.hostname)) {
    throw badRequest('media host is not allowed');
  }

  return parsed;
};

mediaProxyRoutes.get('/', async (req, res, next) => {
  try {
    const targetUrl = resolveTargetUrl(req.query.url);
    const headers: Record<string, string> = {
      Accept: String(req.headers.accept || '*/*'),
      'User-Agent': String(req.headers['user-agent'] || 'EvalStudioMediaProxy/1.0'),
    };

    if (req.headers.range) {
      headers.Range = String(req.headers.range);
    }

    const upstream = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
    });

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type');

    upstream.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lowerKey)) return;
      if (PASSTHROUGH_HEADERS.includes(lowerKey)) {
        res.setHeader(key, value);
      }
    });

    if (!upstream.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstream.body as any).pipe(res);
  } catch (error) {
    next(error);
  }
});
