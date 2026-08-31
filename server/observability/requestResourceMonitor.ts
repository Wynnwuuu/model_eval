import type { NextFunction, Request, Response } from 'express';
import { getHeapStatistics } from 'node:v8';

const MIB = 1024 * 1024;
const heapLimitBytes = getHeapStatistics().heap_size_limit;
const pressureThresholdBytes = heapLimitBytes * 0.85;
const diagnosticThresholdBytes = heapLimitBytes * 0.6;

const memorySnapshot = () => {
  const usage = process.memoryUsage();
  return {
    heapUsedMiB: Math.round(usage.heapUsed / MIB),
    heapLimitMiB: Math.round(heapLimitBytes / MIB),
    rssMiB: Math.round(usage.rss / MIB),
    externalMiB: Math.round(usage.external / MIB),
  };
};

export const logRuntimeMemoryBudget = () => {
  console.log('[runtime-memory]', {
    node: process.version,
    ...memorySnapshot(),
  });
};

export const requestResourceMonitor = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  const before = process.memoryUsage();
  const path = req.path;
  if (
    path.startsWith('/api/')
    && path !== '/api/health'
    && before.heapUsed >= pressureThresholdBytes
  ) {
    const memory = memorySnapshot();
    console.error('[api-resource] request rejected under heap pressure', {
      method: req.method,
      path,
      ...memory,
    });
    res.set('Retry-After', '5');
    res.status(503).json({
      error: {
        code: 'SERVER_MEMORY_PRESSURE',
        message: 'The service is temporarily busy. Retry shortly.',
      },
    });
    return;
  }

  res.once('finish', () => {
    const durationMs = Date.now() - startedAt;
    const after = process.memoryUsage();
    if (durationMs < 2_000 && after.heapUsed < diagnosticThresholdBytes) return;
    console.warn('[api-resource] slow or memory-intensive request', {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs,
      heapDeltaMiB: Math.round((after.heapUsed - before.heapUsed) / MIB),
      ...memorySnapshot(),
    });
  });
  next();
};
