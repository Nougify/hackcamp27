import 'server-only';
import { emptyNutrients, kcalFromKj, mapAllergens, num, parsePackageText, servingFrom, sodiumMgFrom, str } from './parse';
import { fetchProvider, type ParsedResponse, type ProviderResult } from './provider';

// SPEC §10.1, checked against live responses (docs/johnny-verify.md §17). Only this file knows the
// dataandapis response shape. Carbohydrates are stored as printed.

const BASE_URL = 'https://api-barcode-lookup.dataandapis.com/v1/products';

/** 401/402/429/5xx mean "we couldn't ask", which must never negative-cache a barcode. */
export function isDataAndApisError(status: number): boolean {
  return status === 401 || status === 402 || status === 429 || status >= 500;
}

export function parseDataAndApis(status: number, body: unknown): ParsedResponse {
  if (isDataAndApisError(status)) return { result: 'error' };
  if (status < 200 || status >= 300) return { result: 'miss' };
  const b = (body ?? {}) as Record<string, unknown>;
  const name = str(b.name);
  if (b.ok === false || !name) return { result: 'miss' };

  const n = (b.nutriments_per_100g ?? {}) as Record<string, unknown>;
  return {
    result: 'hit',
    data: {
      name,
      brand: str(b.brand),
      imageUrl: str(b.image_url),
      categories: (str(b.categories) ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      allergenTags: mapAllergens((str(b.allergens) ?? '').split(',')),
      packageQuantity: parsePackageText(str(b.quantity)),
      servingSize: servingFrom(str(b.serving_size), null, null),
      per100: {
        ...emptyNutrients(),
        energyKcal: num(n.energy_kcal) ?? kcalFromKj(n.energy_kj),
        proteinG: num(n.proteins),
        carbohydrateG: num(n.carbohydrates),
        fatG: num(n.fat),
        saturatedFatG: num(n.saturated_fat),
        sugarsG: num(n.sugars),
        fibreG: num(n.fiber ?? n.fibre),
        sodiumMg: sodiumMgFrom(n.sodium, n.salt),
      },
      perServing: null,
    },
  };
}

export function fetchDataAndApis(code: string, apiKey: string): Promise<ProviderResult> {
  return fetchProvider(`${BASE_URL}/${encodeURIComponent(code)}`, { 'X-Api-Key': apiKey, Accept: 'application/json' }, parseDataAndApis);
}
