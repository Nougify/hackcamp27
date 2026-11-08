import { requireUser } from '@/lib/current-user';
import { RateLimitedError } from '@/lib/errors';
import { geminiJson } from '@/lib/gemini/client';
import { EXPIRY_SYSTEM_PROMPT, expiryJsonSchema, expirySchema } from '@/lib/gemini/schemas';
import { handleRouteError, jsonOk } from '@/lib/http';
import { checkRateLimit } from '@/lib/rate-limit';
import { todayInTz } from '@/server/pantry/dates';
import { assembleDate } from '@/server/vision/date';
import { readImages, visionUnavailable } from '@/server/vision/upload';

export const runtime = 'nodejs';

// SPEC F4. Gemini returns date components; the server assembles and range-checks the date.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const limit = checkRateLimit(user.id, 'vision');
    if (!limit.ok) throw new RateLimitedError('Too many photos. Try again in a moment.', limit.retryAfterMs);

    const upload = await readImages(request, 'image', 1);
    if (!upload.ok) return upload.response;

    try {
      const { data } = await geminiJson({
        system: EXPIRY_SYSTEM_PROMPT,
        text: 'Read the best-before or expiry date printed in this photo.',
        images: upload.images,
        jsonSchema: expiryJsonSchema,
        zod: expirySchema,
      });
      return jsonOk(assembleDate(data, todayInTz(user.tz)));
    } catch (err) {
      return visionUnavailable(err);
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
