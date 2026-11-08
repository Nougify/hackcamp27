import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import type { ExpiryExtractionResponse } from '@/contracts/api';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function POST() {
  try {
    await requireUser();
    const body: ExpiryExtractionResponse = {
      rawText: null,
      dateType: 'unknown',
      suggestedDate: null,
      candidates: [],
      needsUserChoice: true,
      yearInferred: false,
      regexCrossCheck: 'no_match',
      confidence: 'low',
    };
    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
