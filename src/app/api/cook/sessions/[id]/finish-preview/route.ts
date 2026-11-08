import { requireUser } from '@/lib/current-user';
import { handleRouteError, isUuid, jsonError, jsonOk } from '@/lib/http';
import { getFinishPreview } from '@/server/cook/sessions';
import { getProfileFilters } from '@/server/recipes/pantry-view';

export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) return jsonError('NOT_FOUND', 'Cooking session not found');
    const servingsCooked = Number(new URL(req.url).searchParams.get('servingsCooked'));
    if (!Number.isFinite(servingsCooked) || servingsCooked <= 0) {
      return jsonError('BAD_REQUEST', 'servingsCooked must be a positive number');
    }
    const profile = await getProfileFilters(user.id);
    return jsonOk(await getFinishPreview(user.id, profile.tz, id, servingsCooked));
  } catch (err) {
    return handleRouteError(err);
  }
}
