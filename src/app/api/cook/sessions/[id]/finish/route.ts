import { z } from 'zod';
import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { finishSession } from '@/server/cook/finish';

export const runtime = 'nodejs';

const bodySchema = z.object({
  servingsCooked: z.number().positive(),
  servingsEaten: z.number().min(0),
  deductions: z.array(z.object({ pantryItemId: z.string().uuid(), qtyBase: z.number().min(0) })),
  perServingOverride: z.object({ kcal: z.number().min(0), proteinG: z.number().min(0) }).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    return jsonOk(await finishSession(user.id, id, parsed.data));
  } catch (err) {
    return handleRouteError(err);
  }
}
