import 'server-only';
import type { Nutrients } from '@/contracts/domain';
import { kcalFromKj, mapAllergens, num, parsePackageText, round, servingFrom, sodiumMgFrom, str, type PackageQuantity } from './parse';
import { fetchProvider, type ParsedResponse, type ProviderResult } from './provider';

// SPEC §10.2, API v2, checked against live responses (docs/johnny-verify.md §17). Only this file
// knows the OFF shape, so a later v3 migration touches nothing else.

const FIELDS =
  'code,product_name,product_name_en,product_name_fr,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments,image_front_url,categories_tags,allergens_tags';

function nutrientsFor(n: Record<string, unknown>, suffix: '100g' | 'serving'): Nutrients {
  // OFF's plain `energy` key is always kJ.
  const kj = n[`energy-kj_${suffix}`] ?? n[`energy_${suffix}`];
  return {
    energyKcal: num(n[`energy-kcal_${suffix}`]) ?? kcalFromKj(kj),
    proteinG: num(n[`proteins_${suffix}`]),
    carbohydrateG: num(n[`carbohydrates_${suffix}`]),
    fatG: num(n[`fat_${suffix}`]),
    saturatedFatG: num(n[`saturated-fat_${suffix}`]),
    sugarsG: num(n[`sugars_${suffix}`]),
    fibreG: num(n[`fiber_${suffix}`]),
    sodiumMg: sodiumMgFrom(n[`sodium_${suffix}`], n[`salt_${suffix}`]),
  };
}

const hasAny = (n: Nutrients) => Object.values(n).some((v) => v !== null && v !== undefined);

/** `en:sweet-spreads` → "Sweet spreads". Other languages are dropped when English tags exist. */
function categoriesFrom(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const all = tags.filter((t): t is string => typeof t === 'string');
  const english = all.filter((t) => t.startsWith('en:'));
  return (english.length > 0 ? english : all).map((t) => {
    const label = t.replace(/^[a-z]{2}:/, '').replaceAll('-', ' ').trim();
    return label.charAt(0).toUpperCase() + label.slice(1);
  });
}

const PACKAGE_FACTORS: Record<string, [number, 'g' | 'ml']> = { g: [1, 'g'], kg: [1000, 'g'], ml: [1, 'ml'], l: [1000, 'ml'] };

function packageFrom(p: Record<string, unknown>, text: string | null): PackageQuantity | null {
  const parsed = parsePackageText(text);
  if (parsed) return parsed;
  const value = num(p.product_quantity);
  if (value === null || value <= 0 || value > 1_000_000) return null;
  const unit = str(p.product_quantity_unit)?.toLowerCase() ?? 'g';
  if (!Object.hasOwn(PACKAGE_FACTORS, unit)) return null;
  return { value: round(value * PACKAGE_FACTORS[unit][0], 3), unit: PACKAGE_FACTORS[unit][1], text };
}

export function parseOpenFoodFacts(status: number, body: unknown): ParsedResponse {
  if (status === 404) return { result: 'miss' };
  if (status < 200 || status >= 300) return { result: 'error' }; // includes the 503 rate limit
  const b = (body ?? {}) as Record<string, unknown>;
  const p = (b.product ?? {}) as Record<string, unknown>;
  const name = str(p.product_name_en) ?? str(p.product_name) ?? str(p.product_name_fr);
  if (b.status !== 1 || !name) return { result: 'miss' };

  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const perServing = nutrientsFor(n, 'serving');
  return {
    result: 'hit',
    data: {
      name,
      brand: str(p.brands),
      imageUrl: str(p.image_front_url),
      categories: categoriesFrom(p.categories_tags),
      allergenTags: mapAllergens(Array.isArray(p.allergens_tags) ? p.allergens_tags.filter((t) => typeof t === 'string') : []),
      packageQuantity: packageFrom(p, str(p.quantity)),
      servingSize: servingFrom(str(p.serving_size), p.serving_quantity, p.serving_quantity_unit),
      per100: nutrientsFor(n, '100g'),
      perServing: hasAny(perServing) ? perServing : null,
    },
  };
}

export function fetchOpenFoodFacts(code: string, config: { baseUrl: string; userAgent: string }): Promise<ProviderResult> {
  const headers: Record<string, string> = { 'User-Agent': config.userAgent, Accept: 'application/json' };
  // OFF's staging host sits behind a public basic-auth prompt (§10.2).
  if (new URL(config.baseUrl).hostname.endsWith('openfoodfacts.net')) headers.Authorization = `Basic ${btoa('off:off')}`;
  const url = `${config.baseUrl.replace(/\/$/, '')}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
  return fetchProvider(url, headers, parseOpenFoodFacts);
}
