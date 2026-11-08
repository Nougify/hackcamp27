import { z } from 'zod';
import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { getSessionView, updateSession } from '@/server/cook/sessions';

export const runtime = 'nodejs';

const bodySchema = z.object({
  currentStep: z.number().int().min(0).optional(),
  status: z.enum(['abandoned']).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const view = await getSessionView(user.id, id);
    if (!view) return jsonError('NOT_FOUND', 'Cooking session not found');
    return jsonOk(view);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    return jsonOk(await updateSession(user.id, id, parsed.data));
  } catch (err) {
    return handleRouteError(err);
  }
}
