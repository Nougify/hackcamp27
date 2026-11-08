import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import { mealsFixture } from '@/contracts/fixtures';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function GET() {
  try {
    await requireUser();
    return jsonOk({ meals: mealsFixture });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST() {
  try {
    await requireUser();
    return jsonOk(mealsFixture[0]);
  } catch (err) {
    return handleRouteError(err);
  }
}
