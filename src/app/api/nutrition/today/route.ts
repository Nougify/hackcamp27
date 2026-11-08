import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import { dailyTotalsFixture } from '@/contracts/fixtures';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function GET() {
  try {
    await requireUser();
    return jsonOk(dailyTotalsFixture);
  } catch (err) {
    return handleRouteError(err);
  }
}
