import { z } from 'zod';
import type { ListPantryResponse } from '@/contracts/api';
import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { createPantryItem, listPantry } from '@/server/pantry/repo';
import { createPantryItemSchema } from '@/server/pantry/validation';

export const runtime = 'nodejs';

// SPEC F5 + §7. GET /api/pantry?sort=expiry|name&includeEmpty=false → { items }. POST → PantryItem.

const listQuery = z
  .object({
    sort: z.enum(['expiry', 'name']).default('expiry'),
    includeEmpty: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  })
  .strict();

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const parsed = listQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    const items = await listPantry(user.id, user.tz, parsed.data);
    return jsonOk({ items } satisfies ListPantryResponse);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => undefined);
    if (body === undefined) return jsonError('BAD_REQUEST', 'Body must be JSON');
    const parsed = createPantryItemSchema.safeParse(body);
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    return jsonOk(await createPantryItem(user.id, user.tz, parsed.data), { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
