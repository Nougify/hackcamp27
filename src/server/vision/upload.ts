import 'server-only';
import type { NextResponse } from 'next/server';
import type { ApiError } from '@/contracts/api';
import type { GeminiImage } from '@/lib/gemini/client';
import { jsonError } from '@/lib/http';

// Photos are held in memory for one request and never stored or logged (SPEC F3, F4, §13).

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** next's proxy buffers at most 10 MB of a body and silently truncates the rest. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export type ReadImagesResult = { ok: true; images: GeminiImage[]; form: FormData } | { ok: false; response: NextResponse<ApiError> };

const fail = (response: NextResponse<ApiError>): ReadImagesResult => ({ ok: false, response });

export async function readImages(request: Request, field: string, max: number): Promise<ReadImagesResult> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return fail(jsonError('PAYLOAD_TOO_LARGE', 'Those photos are too large. Try again with smaller ones.'));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(jsonError('BAD_REQUEST', 'Expected a photo upload.'));
  }

  const files = form.getAll(field).filter((f): f is File => f instanceof File);
  if (files.length === 0) return fail(jsonError('BAD_REQUEST', 'Add a photo first.'));
  if (files.length > max) return fail(jsonError('BAD_REQUEST', max === 1 ? 'Send one photo.' : `Send at most ${max} photos.`));
  if (files.some((f) => f.size > MAX_IMAGE_BYTES)) return fail(jsonError('PAYLOAD_TOO_LARGE', 'Each photo must be 4 MB or smaller.'));
  if (files.some((f) => !ALLOWED_TYPES.has(f.type))) return fail(jsonError('BAD_REQUEST', 'Photos must be JPEG, PNG, WebP or HEIC.'));

  const images = await Promise.all(
    files.map(async (f) => ({ mimeType: f.type as GeminiImage['mimeType'], base64: Buffer.from(await f.arrayBuffer()).toString('base64') })),
  );
  return { ok: true, images, form };
}

export function visionUnavailable(err: unknown): NextResponse<ApiError> {
  // Only the error's message: the request's photos must never reach the log.
  console.error('[vision] extraction failed:', err instanceof Error ? err.message : 'unknown error');
  return jsonError('UPSTREAM_UNAVAILABLE', "We couldn't read that photo. Try again, or enter the details by hand.");
}
