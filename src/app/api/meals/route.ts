import type { ManualMealRequest } from '@/contracts/api';
import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { listMeals, logMeal, manualMealSchema } from '@/server/nutrition/daily';
import { isIsoDate, todayInTz } from '@/server/pantry/dates';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const date = new URL(request.url).searchParams.get('date') ?? todayInTz(user.tz);
    if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'date must be YYYY-MM-DD');
    return jsonOk({ meals: await listMeals(user.id, date) });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = manualMealSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    return jsonOk(await logMeal(user, parsed.data as ManualMealRequest), { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
