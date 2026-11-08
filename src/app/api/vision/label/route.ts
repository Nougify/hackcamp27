import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import type { LabelExtractionResponse } from '@/contracts/api';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B).
export async function POST() {
  try {
    await requireUser();
    const body: LabelExtractionResponse = {
      isFoodProduct: true,
      draft: {
        gtin: null,
        name: 'Stub product (label photo)',
        brand: null,
        packageQuantity: { value: 500, unit: 'g' },
        servingSize: null,
        basis: '100g',
        nutrients: { energyKcal: null, proteinG: null, carbohydrateG: null, fatG: null },
        allergenTags: [],
        source: 'gemini_photo',
      },
      flaggedFields: ['name'],
      macrosConsistent: null,
      confidence: 'low',
      notes: 'Stub response — vision/label not implemented yet.',
      model: 'stub',
    };
    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
