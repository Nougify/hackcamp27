import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { ApiError, ApiErrorCode } from '@/contracts/api';
import {
  ConflictError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  UnprocessableError,
} from './errors';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UPSTREAM_UNAVAILABLE: 502,
  UNPROCESSABLE: 422,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL: 500,
};

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(code: ApiErrorCode, message: string, details?: unknown): NextResponse<ApiError> {
  return NextResponse.json({ error: { code, message, details } }, { status: STATUS_BY_CODE[code] });
}

export function jsonErrorFromZod(error: ZodError): NextResponse<ApiError> {
  return jsonError('BAD_REQUEST', 'Validation failed', error.flatten());
}

/** Converts a thrown error into the right typed ApiError response. Catch-all for route handlers. */
export function handleRouteError(err: unknown): NextResponse<ApiError> {
  if (err instanceof UnauthorizedError) return jsonError('UNAUTHORIZED', err.message || 'Not signed in');
  if (err instanceof NotFoundError) return jsonError('NOT_FOUND', err.message || 'Not found');
  if (err instanceof ConflictError) return jsonError('CONFLICT', err.message || 'Conflict');
  if (err instanceof UnprocessableError) return jsonError('UNPROCESSABLE', err.message, err.details);
  if (err instanceof RateLimitedError) {
    const res = jsonError('RATE_LIMITED', err.message || 'Too many requests');
    res.headers.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
    return res;
  }
  if (err instanceof ZodError) return jsonErrorFromZod(err);
  console.error(err);
  return jsonError('INTERNAL', 'Something went wrong');
}

/**
 * Streams one JSON object per line as `application/x-ndjson`. `producer`
 * receives a `write` callback and should await every upstream step before
 * writing the matching event, so clients see progress instead of one
 * buffered burst at the end.
 */
export function ndjsonResponse<T>(producer: (write: (event: T) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: T) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await producer(write);
      } catch (err) {
        write({
          type: 'error',
          error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Unknown error' },
        } as T);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
