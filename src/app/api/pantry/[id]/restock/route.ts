import { requireUser } from '@/lib/current-user';
import { handleRouteError, isUuid, jsonError, jsonOk } from '@/lib/http';
import { restockPantryItem } from '@/server/pantry/repo';

export const runtime = 'nodejs';

// POST /api/pantry/:id/restock → PantryItem (team decision 2026-11-08, documented in contracts/api.ts).
// Refills an empty row to its initial quantity, clears the expiry, logs an 'add' event.
// 409 if the item is not empty; 422 if it has no recorded initial quantity.

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) return jsonError('NOT_FOUND', 'Pantry item not found');
    return jsonOk(await restockPantryItem(user.id, id, user.tz));
  } catch (err) {
    return handleRouteError(err);
  }
}
