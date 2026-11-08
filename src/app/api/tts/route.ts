import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonError } from '@/lib/http';

export const runtime = 'nodejs';

// Phase 0 stub (owner: A). 503 so the client uses speechSynthesis.
export async function POST() {
  try {
    await requireUser();
    return jsonError('UPSTREAM_UNAVAILABLE', 'TTS not configured; use device speech.');
  } catch (err) {
    return handleRouteError(err);
  }
}
