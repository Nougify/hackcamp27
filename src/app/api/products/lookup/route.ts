import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import { productFixture } from '@/contracts/fixtures';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function POST() {
  try {
    await requireUser();
    return jsonOk({ status: 'found', product: productFixture, cached: true, attempts: [] });
  } catch (err) {
    return handleRouteError(err);
  }
}
