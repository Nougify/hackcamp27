import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import { fixtureDailyTotals } from '@/contracts/fixtures/meals';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function GET() {
  try {
    await requireUser();
    return jsonOk({ days: [fixtureDailyTotals] });
  } catch (err) {
    return handleRouteError(err);
  }
}
