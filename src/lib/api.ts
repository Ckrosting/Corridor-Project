import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';
import { AuthError } from './auth/guards';
import { GeometryError } from './geo/polygon';

/**
 * One place that converts thrown errors into HTTP responses, so no route handler
 * has to remember. Unexpected errors are logged in full server-side and reported
 * to the client as a generic message — stack traces and database text never reach
 * the browser.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message, code: err.status === 401 ? 'unauthenticated' : 'forbidden' }, { status: err.status });
  }

  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
  }

  if (err instanceof GeometryError) {
    return NextResponse.json({ error: err.message, code: 'invalid_geometry' }, { status: 422 });
  }

  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Some fields are invalid.',
        code: 'validation_failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }

  console.error('[api] Unhandled error:', err);
  return NextResponse.json({ error: 'Something went wrong. Please try again.', code: 'internal_error' }, { status: 500 });
}

/** Wraps a route handler with the shared error conversion. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse | Response>,
) {
  return async (...args: Args): Promise<NextResponse | Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export const ok = <T>(data: T, status = 200) => NextResponse.json(data, { status });

/** Parses and validates a JSON request body, rejecting oversized payloads. */
export async function readJson(req: Request, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new AppError(413, 'Request body is too large.', 'payload_too_large');
  }
  const text = await req.text();
  if (text.length > maxBytes) {
    throw new AppError(413, 'Request body is too large.', 'payload_too_large');
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, 'Request body is not valid JSON.', 'bad_json');
  }
}
