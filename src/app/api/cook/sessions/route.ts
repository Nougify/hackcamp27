import { z } from 'zod';
import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { createSession } from '@/server/cook/sessions';

export const runtime = 'nodejs';

const bodySchema = z.object({
  recipeId: z.string().uuid(),
  variantId: z.string().uuid(),
  servingsPlanned: z.number().positive(),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    return jsonOk(await createSession(user.id, parsed.data));
  } catch (err) {
    return handleRouteError(err);
  }
}
