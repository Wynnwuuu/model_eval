import type { Request } from 'express';

import { serverConfig } from '../config.ts';
import { ApiError } from '../http/errors.ts';

const firstForwardedValue = (value?: string) => value?.split(',')[0]?.trim();

const toOrigin = (value: string | undefined) => {
  if (!value || value === '*') return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

const requestOrigin = (req: Request) => {
  const forwardedProto = firstForwardedValue(req.header('x-forwarded-proto'));
  const protocol = forwardedProto === 'https' || forwardedProto === 'http'
    ? forwardedProto
    : req.protocol === 'https' ? 'https' : 'http';
  const host = firstForwardedValue(req.header('x-forwarded-host')) || req.header('host') || '';
  return host ? `${protocol}://${host}` : '';
};

export const isMutatingRequest = (req: Request) =>
  !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());

export const assertSameOriginRequest = (req: Request) => {
  const suppliedOrigin = toOrigin(req.header('origin'));
  const configuredOrigins = [
    serverConfig.publicBaseUrl,
    process.env.PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.CORS_ORIGIN,
  ].map(toOrigin).filter(Boolean);
  const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : [toOrigin(requestOrigin(req))].filter(Boolean);

  if (!suppliedOrigin || !allowedOrigins.includes(suppliedOrigin)) {
    throw new ApiError(403, 'OWNER_ORIGIN_REQUIRED', 'Same-origin request required');
  }
};
