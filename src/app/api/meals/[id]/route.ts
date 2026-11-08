import { requireUser } from '@/lib/current-user';
import { handleRouteError, isUuid, jsonError, jsonOk } from '@/lib/http';
import { deleteMeal } from '@/server/nutrition/daily';

export const runtime = 'nodejs';

// DELETE /api/meals/:id?eatenAt=<ISO>. The composite primary key needs eatenAt.
export async function DELETE(request: Request, ctx: RouteContext<'/api/meals/[id]'>) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) return jsonError('NOT_FOUND', 'Meal not found');
    const eatenAt = new Date(new URL(request.url).searchParams.get('eatenAt') ?? '');
    if (Number.isNaN(eatenAt.getTime())) return jsonError('BAD_REQUEST', 'eatenAt must be an ISO date-time');
    await deleteMeal(user.id, id, eatenAt);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
