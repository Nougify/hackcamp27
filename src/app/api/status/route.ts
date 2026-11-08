import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import { getStatusChecks } from '@/server/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return jsonOk(await getStatusChecks());
  } catch (err) {
    return handleRouteError(err);
  }
}
