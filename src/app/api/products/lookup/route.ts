import { z } from 'zod';
import type { ProductLookupResponse } from '@/contracts/api';
import { requireUser } from '@/lib/current-user';
import { RateLimitedError } from '@/lib/errors';
import { normalizeBarcode } from '@/lib/gtin';
import { handleRouteError, jsonErrorFromZod, jsonOk } from '@/lib/http';
import { checkRateLimit } from '@/lib/rate-limit';
import { lookupProduct } from '@/server/products/lookup';

export const runtime = 'nodejs';

const bodySchema = z.object({ barcode: z.string().max(40) });

// SPEC F2. An invalid barcode is a normal 200 answer and never reaches a provider.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const limit = checkRateLimit(user.id, 'products/lookup');
    if (!limit.ok) throw new RateLimitedError('Too many barcode lookups. Try again in a moment.', limit.retryAfterMs);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonErrorFromZod(parsed.error);

    const code = normalizeBarcode(parsed.data.barcode);
    if (!code.ok) return jsonOk<ProductLookupResponse>({ status: 'invalid_barcode', reason: code.reason });
    return jsonOk<ProductLookupResponse>(await lookupProduct(code.gtin, code.lookupCode));
  } catch (err) {
    return handleRouteError(err);
  }
}
