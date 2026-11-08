import type { LabelExtractionResponse } from '@/contracts/api';
import type { DisplayUnit, Nutrients, ProductDraft } from '@/contracts/domain';
import { normalizeBarcode } from '@/lib/gtin';
import type { LabelExtraction } from '@/lib/gemini/schemas';

// SPEC F3 server checks. Gemini's output is untrusted: every failed check adds to flaggedFields and
// the user confirms everything in the form before it is saved. Pure.
//
// `draft.basis` stays 'serving' for per-serving labels (team decision); the client works out
// per-100 values from `servingSize` when it fills the form, since ProductDraft carries one set of
// nutrients.

type Flag = LabelExtractionResponse['flaggedFields'][number];

const KJ_IN_NOTES = /(\d+(?:[.,]\d+)?)\s*kj\b/i;
/** Labels round small values, so near-zero foods need an absolute tolerance on top of ±20%. */
const MIN_KCAL_TOLERANCE = 5;

const PACKAGE_UNITS: Record<NonNullable<LabelExtraction['package_quantity_unit']>, DisplayUnit> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  oz: 'oz',
  lb: 'lb',
  fl_oz: 'fl_oz',
  count: 'pcs',
};

export function macrosConsistent(n: Pick<Nutrients, 'energyKcal' | 'proteinG' | 'carbohydrateG' | 'fatG'>): boolean | null {
  if (n.energyKcal == null || n.proteinG == null || n.carbohydrateG == null || n.fatG == null) return null;
  const estimate = 4 * n.proteinG + 4 * n.carbohydrateG + 9 * n.fatG;
  return Math.abs(estimate - n.energyKcal) <= Math.max(0.2 * n.energyKcal, MIN_KCAL_TOLERANCE);
}

function draftGtin(given: string | null, printed: string | null | undefined): string | null {
  for (const code of [given, printed]) {
    if (!code) continue;
    const r = normalizeBarcode(code);
    if (r.ok) return r.gtin;
  }
  return null;
}

export function buildLabelResponse(x: LabelExtraction, model: string, gtin: string | null): LabelExtractionResponse {
  const flags = new Set<Flag>();

  const clean = (key: keyof Nutrients, v: number | null | undefined): number | null => {
    if (v == null) return null;
    if (v < 0) {
      flags.add(key);
      return null;
    }
    return v;
  };

  const nutrients: Nutrients = {
    energyKcal: clean('energyKcal', x.calories_kcal),
    proteinG: clean('proteinG', x.protein_g),
    carbohydrateG: clean('carbohydrateG', x.carbohydrate_g),
    fatG: clean('fatG', x.fat_g),
    saturatedFatG: clean('saturatedFatG', x.saturated_fat_g),
    sugarsG: clean('sugarsG', x.sugars_g),
    fibreG: clean('fibreG', x.fibre_g),
    sodiumMg: clean('sodiumMg', x.sodium_mg),
  };

  // The prompt asks for null calories and a note when the label only prints kJ.
  if (nutrients.energyKcal === null && x.calories_kcal == null) {
    const kj = KJ_IN_NOTES.exec(x.notes ?? '');
    if (kj) {
      nutrients.energyKcal = Math.round((Number(kj[1].replace(',', '.')) / 4.184) * 10) / 10;
      flags.add('energyKcal');
    }
  }

  const consistent = macrosConsistent(nutrients);
  if (consistent === false) for (const k of ['energyKcal', 'proteinG', 'carbohydrateG', 'fatG'] as const) flags.add(k);

  let servingSize: ProductDraft['servingSize'] = null;
  const v = x.serving_size_value;
  if (v != null && x.serving_size_unit && v >= 1 && v <= 1000) {
    servingSize = { value: v, unit: x.serving_size_unit, text: x.serving_size_text ?? null };
  } else if (v != null || x.serving_size_text || x.basis === 'per_serving') {
    flags.add('servingSize');
  }

  // A label whose basis couldn't be read: its numbers can't be trusted to mean anything yet.
  if (x.basis === 'unknown') {
    flags.add('servingSize');
    for (const k of Object.keys(nutrients) as Array<keyof Nutrients>) if (nutrients[k] != null) flags.add(k);
  }

  const packageValue = x.package_quantity_value;
  let packageQuantity: ProductDraft['packageQuantity'] = null;
  if (packageValue != null && x.package_quantity_unit && packageValue > 0) {
    packageQuantity = { value: packageValue, unit: PACKAGE_UNITS[x.package_quantity_unit] };
  } else if (packageValue != null) {
    flags.add('packageQuantity');
  }

  const name = x.name?.trim() ?? '';
  if (x.is_food_product && name === '') flags.add('name');

  const basis: ProductDraft['basis'] =
    x.basis === 'per_100g' ? '100g' : x.basis === 'per_100ml' ? '100ml' : x.basis === 'per_serving' || servingSize ? 'serving' : '100g';

  return {
    isFoodProduct: x.is_food_product,
    draft: {
      gtin: draftGtin(gtin, x.barcode_digits_if_visible),
      name,
      brand: x.brand?.trim() || null,
      packageQuantity,
      servingSize,
      basis,
      nutrients,
      allergenTags: [],
      source: 'gemini_photo',
    },
    flaggedFields: x.is_food_product ? [...flags] : [],
    macrosConsistent: consistent,
    confidence: x.confidence,
    notes: x.notes ?? null,
    model,
  };
}
