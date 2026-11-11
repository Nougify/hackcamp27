import { requireUser } from '@/lib/current-user';
import { RateLimitedError } from '@/lib/errors';
import { geminiJson } from '@/lib/gemini/client';
import { RECEIPT_SYSTEM_PROMPT, receiptJsonSchema, receiptSchema } from '@/lib/gemini/schemas';
import { handleRouteError, jsonOk } from '@/lib/http';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildReceiptResponse } from '@/server/vision/receipt';
import { readImages, visionUnavailable } from '@/server/vision/upload';

export const runtime = 'nodejs';

// Receipt scan: returns a draft list of food items only; nothing is saved until the user
// confirms the review list.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const limit = checkRateLimit(user.id, 'vision');
    if (!limit.ok) throw new RateLimitedError('Too many photos. Try again in a moment.', limit.retryAfterMs);

    const upload = await readImages(request, 'images', 3);
    if (!upload.ok) return upload.response;

    try {
      const { data, model } = await geminiJson({
        system: RECEIPT_SYSTEM_PROMPT,
        text: 'Read every purchased line item from this grocery receipt.',
        images: upload.images,
        jsonSchema: receiptJsonSchema,
        zod: receiptSchema,
      });
      return jsonOk(buildReceiptResponse(data, model));
    } catch (err) {
      return visionUnavailable(err);
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
