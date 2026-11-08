import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonError, jsonOk } from '@/lib/http';
import { MAX_HISTORY_DAYS, getHistory } from '@/server/nutrition/daily';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const raw = new URL(request.url).searchParams.get('days') ?? '7';
    const days = /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
    if (days < 1 || days > MAX_HISTORY_DAYS) return jsonError('BAD_REQUEST', `days must be between 1 and ${MAX_HISTORY_DAYS}`);
    return jsonOk({ days: await getHistory(user, days) });
  } catch (err) {
    return handleRouteError(err);
  }
}
