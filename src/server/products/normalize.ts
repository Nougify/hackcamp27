import type { Nutrients, Product } from '@/contracts/domain';
import { round } from './parse';
import { ATTRIBUTION, type ProviderProduct } from './provider';

// Merges the two provider views into one Product (SPEC F2 step 5).

const NUTRIENT_KEYS = ['energyKcal', 'proteinG', 'carbohydrateG', 'fatG', 'saturatedFatG', 'sugarsG', 'fibreG', 'sodiumMg'] as const;

/** The primary provider wins; gaps come from the other. Allergens are unioned, the safe direction. */
export function mergeProviders(primary: ProviderProduct, extra: ProviderProduct | null): ProviderProduct {
  if (!extra) return primary;
  const per100 = { ...primary.per100 };
  for (const k of NUTRIENT_KEYS) per100[k] = primary.per100[k] ?? extra.per100[k] ?? null;
  return {
    name: primary.name,
    brand: primary.brand ?? extra.brand,
    imageUrl: primary.imageUrl ?? extra.imageUrl,
    categories: primary.categories.length > 0 ? primary.categories : extra.categories,
    allergenTags: [...new Set([...primary.allergenTags, ...extra.allergenTags])],
    packageQuantity: primary.packageQuantity ?? extra.packageQuantity,
    servingSize: primary.servingSize ?? extra.servingSize,
    per100,
    // Printed per-serving values only describe the serving they came with.
    perServing: primary.servingSize ? primary.perServing : (primary.perServing ?? extra.perServing),
  };
}

export function perServingFromPer100(per100: Nutrients, servingBase: number): Nutrients {
  const out = {} as Nutrients;
  for (const k of NUTRIENT_KEYS) {
    const v = per100[k];
    out[k] = v == null ? null : round((v * servingBase) / 100);
  }
  return out;
}

export function buildProduct(gtin: string, source: Product['source'], data: ProviderProduct, fetchedAt: Date): Product {
  const packageUnit = data.packageQuantity?.unit;
  const liquid = packageUnit === 'ml' || (packageUnit !== 'g' && data.servingSize?.unit === 'ml');
  return {
    gtin,
    name: data.name,
    brand: data.brand,
    imageUrl: data.imageUrl,
    categories: data.categories,
    allergenTags: data.allergenTags,
    packageQuantity: data.packageQuantity,
    servingSize: data.servingSize,
    basis: liquid ? '100ml' : '100g',
    per100: data.per100,
    perServing: data.perServing ?? (data.servingSize ? perServingFromPer100(data.per100, data.servingSize.value) : null),
    source,
    attribution: ATTRIBUTION,
    fetchedAt: fetchedAt.toISOString(),
  };
}
