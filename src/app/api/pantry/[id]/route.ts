import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import { fixturePantry } from '@/contracts/fixtures/pantry';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function PATCH() {
  try {
    await requireUser();
    return jsonOk(fixturePantry[0]);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE() {
  try {
    await requireUser();
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
