/**
 * Consistent response helpers for the REST API.
 *
 * Success responses return data directly.
 * Error responses use a consistent { error, code } shape (with optional `issues` for validation).
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UPSTREAM_ERROR'
  | 'RATE_LIMITED';

export type ApiError = {
  error: string;
  code: ApiErrorCode;
  issues?: Array<{ path: string; message: string }>;
};

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function errorResponse(message: string, code: ApiErrorCode, status = 400): Response {
  const body: ApiError = { error: message, code };
  return Response.json(body, { status });
}

export const Errors = {
  validation: (message: string) => errorResponse(message, 'VALIDATION_ERROR', 400),
  notFound: (message: string) => errorResponse(message, 'NOT_FOUND', 404),
  upstream: (message: string) => errorResponse(message, 'UPSTREAM_ERROR', 500),
  rateLimited: (message: string) => errorResponse(message, 'RATE_LIMITED', 429),
};
