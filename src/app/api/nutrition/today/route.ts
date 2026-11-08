import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import { getTodayTotals } from '@/server/nutrition/daily';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return jsonOk(await getTodayTotals(await requireUser()));
  } catch (err) {
    return handleRouteError(err);
  }
}
