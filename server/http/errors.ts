import type { Response } from 'express';

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'BAD_REQUEST', message, details);

export const notFound = (resource: string) =>
  new ApiError(404, 'NOT_FOUND', `${resource} not found`);

export const forbidden = (message = 'Forbidden') =>
  new ApiError(403, 'FORBIDDEN', message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'VERSION_CONFLICT', message, details);

export const unprocessableEntity = (code: string, message: string, details?: unknown) =>
  new ApiError(422, code, message, details);

export const sendError = (res: Response, error: unknown, fallbackMessage = 'Internal server error') => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
};
