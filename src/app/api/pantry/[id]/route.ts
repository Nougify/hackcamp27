import { requireUser } from '@/lib/current-user';
import { handleRouteError, isUuid, jsonError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { deletePantryItem, updatePantryItem } from '@/server/pantry/repo';
import { updatePantryItemSchema } from '@/server/pantry/validation';

export const runtime = 'nodejs';

// SPEC F5 + §7. PATCH → PantryItem (quantity changes write pantry_events). DELETE → { ok: true }.
// Another user's id (or a malformed one) → 404, never 403 (§13).

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) return jsonError('NOT_FOUND', 'Pantry item not found');
    const body = await req.json().catch(() => undefined);
    if (body === undefined) return jsonError('BAD_REQUEST', 'Body must be JSON');
    const parsed = updatePantryItemSchema.safeParse(body);
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    return jsonOk(await updatePantryItem(user.id, id, user.tz, parsed.data));
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) return jsonError('NOT_FOUND', 'Pantry item not found');
    await deletePantryItem(user.id, id);
    return jsonOk({ ok: true as const });
  } catch (err) {
    return handleRouteError(err);
  }
}
