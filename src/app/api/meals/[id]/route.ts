import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function DELETE() {
  try {
    await requireUser();
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
