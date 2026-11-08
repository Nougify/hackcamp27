import { forgetDevUser, requireUser } from '@/lib/current-user';
import { handleRouteError, jsonError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { deleteUserData, getProfile, updateProfile } from '@/server/pantry/profile';
import { updateMeSchema } from '@/server/pantry/validation';

export const runtime = 'nodejs';

// SPEC F1 + §7. GET/PATCH → UserProfile. DELETE → { ok: true } (Settings "Delete my data").

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk(await getProfile(user.id));
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => undefined);
    if (body === undefined) return jsonError('BAD_REQUEST', 'Body must be JSON');
    const parsed = updateMeSchema.safeParse(body);
    if (!parsed.success) return jsonErrorFromZod(parsed.error);
    return jsonOk(await updateProfile(user.id, parsed.data));
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await deleteUserData(user.id);
    forgetDevUser();
    return jsonOk({ ok: true as const });
  } catch (err) {
    return handleRouteError(err);
  }
}
