import type { ReceiptExtractionResponse } from '@/contracts/api';
import type { ReceiptExtraction } from '@/lib/gemini/schemas';

// Receipt-scan server checks. Gemini's output is untrusted: non-food lines are dropped here
// (this is the actual food-only enforcement point, not just UI), and every quantity/unit is
// sanity-checked before the user ever sees it. Pure.

const UNIT_MAP: Record<NonNullable<ReceiptExtraction['items'][number]['unit']>, ReceiptExtractionResponse['items'][number]['displayUnit']> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  oz: 'oz',
  lb: 'lb',
  fl_oz: 'fl_oz',
  count: 'pcs',
};

export function buildReceiptResponse(x: ReceiptExtraction, model: string): ReceiptExtractionResponse {
  const foodLines = x.items.filter((item) => item.is_food_item);
  const nonFoodCount = x.items.length - foodLines.length;

  const items = foodLines
    .map((item) => {
      const name = item.name.trim();
      const quantity = item.quantity != null && item.quantity > 0 ? item.quantity : null;
      const displayUnit = item.unit ? UNIT_MAP[item.unit] : 'pcs';
      return { name, quantity, displayUnit };
    })
    .filter((item) => item.name !== '');

  return {
    items,
    nonFoodCount,
    confidence: x.confidence,
    notes: x.notes ?? null,
    model,
  };
}
