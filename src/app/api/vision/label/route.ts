import { requireUser } from '@/lib/current-user';
import { RateLimitedError } from '@/lib/errors';
import { geminiJson } from '@/lib/gemini/client';
import { LABEL_SYSTEM_PROMPT, labelJsonSchema, labelSchema } from '@/lib/gemini/schemas';
import { handleRouteError, jsonOk } from '@/lib/http';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildLabelResponse } from '@/server/vision/label';
import { readImages, visionUnavailable } from '@/server/vision/upload';

export const runtime = 'nodejs';

// SPEC F3. Returns a draft only; nothing is saved until the user confirms the form.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const limit = checkRateLimit(user.id, 'vision');
    if (!limit.ok) throw new RateLimitedError('Too many photos. Try again in a moment.', limit.retryAfterMs);

    const upload = await readImages(request, 'images', 3);
    if (!upload.ok) return upload.response;
    const gtin = upload.form.get('gtin');

    try {
      const { data, model } = await geminiJson({
        system: LABEL_SYSTEM_PROMPT,
        text: 'Read this food product from its packaging and Nutrition Facts table.',
        images: upload.images,
        jsonSchema: labelJsonSchema,
        zod: labelSchema,
      });
      return jsonOk(buildLabelResponse(data, model, typeof gtin === 'string' ? gtin : null));
    } catch (err) {
      return visionUnavailable(err);
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
