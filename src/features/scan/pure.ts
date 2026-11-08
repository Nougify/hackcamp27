import type { Nutrients, Product, ProductDraft } from '@/contracts/domain';
import type { BarcodeFormat } from '@/lib/gtin';
import type { ProductFormInitial } from '@/features/pantry/ProductForm';

// Pure helpers for the add-a-product flow (SPEC UF2, UF3).

/** Returns true exactly once per run of `needed` identical reads. Empty frames aren't reads. */
export function createReadConfirmer(needed = 2): (value: string) => boolean {
  let last: string | null = null;
  let count = 0;
  return (value) => {
    count = value === last ? count + 1 : 1;
    last = value;
    return count === needed;
  };
}

export function asBarcodeFormat(format: string): BarcodeFormat {
  return format === 'ean_13' || format === 'ean_8' || format === 'upc_a' || format === 'upc_e' ? format : 'unknown';
}

/** Scale (w, h) so the long edge is at most `max`, never enlarging. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

const hasAny = (n: Nutrients | null | undefined) => !!n && Object.values(n).some((v) => v !== null && v !== undefined);

/** Prefill for a product found by barcode: per-100 values and the package size as the quantity. */
export function productToFormInitial(p: Product): ProductFormInitial {
  const pack = p.packageQuantity;
  return {
    name: p.name,
    brand: p.brand,
    quantity: pack?.value ?? null,
    displayUnit: pack ? (pack.unit === 'count' ? 'pcs' : pack.unit) : p.basis === '100ml' ? 'ml' : 'g',
    nutritionBasis: p.basis,
    nutrition: hasAny(p.per100) ? p.per100 : null,
    servingSizeBase: p.servingSize?.value ?? null,
    allergenTags: p.allergenTags,
  };
}

const per100 = (v: number | null | undefined, serving: number) => (v == null ? null : Math.round(((v * 100) / serving) * 100) / 100);

/**
 * Prefill for a label-photo draft. Pantry items store per-100 values, so a per-serving label is
 * converted using its serving weight. Without one the numbers have no usable basis and are left
 * out (`nutritionDropped`) rather than saved as if they were per 100 g.
 */
export function draftToFormInitial(d: ProductDraft): { initial: ProductFormInitial; nutritionDropped: boolean } {
  const base: ProductFormInitial = {
    name: d.name,
    brand: d.brand,
    quantity: d.packageQuantity?.value ?? null,
    displayUnit: d.packageQuantity?.unit ?? 'g',
    servingSizeBase: d.servingSize?.value ?? null,
    allergenTags: d.allergenTags,
  };
  const n = d.nutrients;
  if (d.basis !== 'serving') {
    return { initial: { ...base, nutritionBasis: d.basis, nutrition: hasAny(n) ? n : null }, nutritionDropped: false };
  }
  if (!d.servingSize) return { initial: { ...base, nutrition: null }, nutritionDropped: hasAny(n) };
  const s = d.servingSize.value;
  return {
    initial: {
      ...base,
      nutritionBasis: d.servingSize.unit === 'ml' ? '100ml' : '100g',
      nutrition: {
        energyKcal: per100(n.energyKcal, s),
        proteinG: per100(n.proteinG, s),
        carbohydrateG: per100(n.carbohydrateG, s),
        fatG: per100(n.fatG, s),
      },
    },
    nutritionDropped: false,
  };
}
