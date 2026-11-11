import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDataAndApis, parseDataAndApis } from './dataandapis';
import { createLookup, type LookupDeps } from './lookup';
import { buildProduct, mergeProviders } from './normalize';
import { fetchOpenFoodFacts, parseOpenFoodFacts } from './openfoodfacts';
import { kcalFromKj, mapAllergens, parsePackageText, parseServingText, servingFrom, sodiumMgFrom } from './parse';
import type { ProviderProduct, ProviderResult } from './provider';
import dnaNutella from './__fixtures__/dataandapis.nutella.json';
import dnaMiss from './__fixtures__/dataandapis.miss.json';
import offNutella from './__fixtures__/off.nutella.json';
import offInvalid from './__fixtures__/off.invalid.json';
import offStaging from './__fixtures__/off.staging.0036000291452.json';

function hit(p: ReturnType<typeof parseDataAndApis>): ProviderProduct {
  if (p.result !== 'hit') throw new Error(`expected hit, got ${p.result}`);
  return p.data;
}

describe('dataandapis adapter', () => {
  it('maps the Nutella fixture', () => {
    const d = hit(parseDataAndApis(200, dnaNutella));
    expect(d.name).toBe('Nutella');
    expect(d.brand).toBe('Nutella, Ferrero');
    expect(d.packageQuantity).toEqual({ value: 400, unit: 'g', text: '400 g e' });
    expect(d.servingSize).toBeNull();
    expect(d.per100).toMatchObject({ energyKcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9, saturatedFatG: 10.6, sugarsG: 56.3, sodiumMg: 43 });
    expect(d.allergenTags.toSorted()).toEqual(['milk', 'soy', 'tree_nut']);
    expect(d.categories).toContain('Spreads');
  });

  it.each([400, 403, 404])('treats HTTP %i as a miss', (s) => expect(parseDataAndApis(s, dnaMiss).result).toBe('miss'));
  it.each([401, 402, 429, 500, 503])('treats HTTP %i as an error', (s) => expect(parseDataAndApis(s, {}).result).toBe('error'));
  it('treats ok:false and a missing name as a miss', () => {
    expect(parseDataAndApis(200, dnaMiss).result).toBe('miss');
    expect(parseDataAndApis(200, { ok: true, name: null }).result).toBe('miss');
  });
});

describe('Open Food Facts adapter', () => {
  it('maps the Nutella fixture', () => {
    const d = hit(parseOpenFoodFacts(200, offNutella));
    expect(d.name).toBe('Nutella');
    expect(d.packageQuantity).toEqual({ value: 400, unit: 'g', text: '400 g e' });
    expect(d.per100).toEqual({ energyKcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9, saturatedFatG: 10.6, sugarsG: 56.3, fibreG: 0, sodiumMg: 42.8 });
    expect(d.perServing).toBeNull();
    expect(d.categories).toContain('Sweet spreads');
    expect(d.categories).not.toContain('Goûter');
  });

  it('keeps the unit of a serving and ignores a bare package number', () => {
    const d = hit(parseOpenFoodFacts(200, offStaging));
    expect(d.servingSize).toEqual({ value: 360, unit: 'ml', text: '1 Container (1.5 cup)' });
    expect(d.packageQuantity).toBeNull();
    expect(d.allergenTags.toSorted()).toEqual(['peanut', 'soy', 'wheat_gluten']);
  });

  it('prefers the English name, then generic, then French', () => {
    const name = (product: object) => hit(parseOpenFoodFacts(200, { status: 1, product })).name;
    expect(name({ product_name_en: 'Milk', product_name: 'Lait entier', product_name_fr: 'Lait' })).toBe('Milk');
    expect(name({ product_name: 'Lait entier', product_name_fr: 'Lait' })).toBe('Lait entier');
    expect(name({ product_name_fr: 'Lait' })).toBe('Lait');
  });

  it('converts kJ when kcal is absent, and salt when sodium is absent', () => {
    const d = hit(parseOpenFoodFacts(200, { status: 1, product: { product_name: 'x', nutriments: { energy_100g: 418.4, salt_100g: 1 } } }));
    expect(d.per100.energyKcal).toBe(100);
    expect(d.per100.sodiumMg).toBe(400);
  });

  it('reads printed per-serving values', () => {
    const d = hit(parseOpenFoodFacts(200, { status: 1, product: { product_name: 'x', nutriments: { 'energy-kcal_serving': 80, sodium_serving: 0.1 } } }));
    expect(d.perServing).toMatchObject({ energyKcal: 80, sodiumMg: 100 });
  });

  it('classifies misses and errors', () => {
    expect(parseOpenFoodFacts(200, offInvalid).result).toBe('miss');
    expect(parseOpenFoodFacts(404, { status: 0 }).result).toBe('miss');
    expect(parseOpenFoodFacts(200, { status: 1, product: {} }).result).toBe('miss');
    expect(parseOpenFoodFacts(503, {}).result).toBe('error');
    expect(parseOpenFoodFacts(429, {}).result).toBe('error');
  });
});

describe('parsing helpers', () => {
  it('converts sodium grams to mg and salt to sodium', () => {
    expect(sodiumMgFrom(0.043, 0.107)).toBe(43);
    expect(sodiumMgFrom(null, 2.5)).toBe(1000);
    expect(sodiumMgFrom(null, null)).toBeNull();
  });
  it('converts kJ to kcal at 4.184', () => expect(kcalFromKj(2252)).toBe(538.24));

  it.each([
    ['400 g e', 400, 'g'],
    ['1.89 L', 1890, 'ml'],
    ['500ml', 500, 'ml'],
    ['1,5 l', 1500, 'ml'],
    ['1,000 g', 1000, 'g'],
    ['1 kg', 1000, 'g'],
    ['33 cl', 330, 'ml'],
    ['6 x 330 ml', 1980, 'ml'],
    ['16 oz (454 g)', 454, 'g'],
    ['1 lb', 453.592, 'g'],
    ['12 fl oz', 354.882, 'ml'],
    ['12 eggs', 12, 'count'],
  ])('parses package "%s"', (text, value, unit) => {
    expect(parsePackageText(text)).toEqual({ value, unit, text });
  });

  it.each(['400', 'big jar', '', '0 g', '5000000 kg'])('rejects package "%s"', (t) => expect(parsePackageText(t)).toBeNull());

  it('prefers the metric amount of a serving', () => {
    expect(parseServingText('2 tbsp (30 g)')).toEqual({ value: 30, unit: 'g', text: '2 tbsp (30 g)' });
    expect(parseServingText('1 cup')).toBeNull();
  });
  it('rejects implausible serving quantities', () => {
    expect(servingFrom(null, 5000, 'g')).toBeNull();
    expect(servingFrom('15 g', 0, 'g')).toEqual({ value: 15, unit: 'g', text: '15 g' });
  });

  it('maps provider allergens, including French and unknown terms', () => {
    expect(mapAllergens(['en:crustaceans', 'en:molluscs', 'en:sesame-seeds']).toSorted()).toEqual(['sesame', 'shellfish']);
    expect(mapAllergens(['Lait', 'Œufs', 'Blé']).toSorted()).toEqual(['egg', 'milk', 'wheat_gluten']);
    expect(mapAllergens(['en:sulphur-dioxide-and-sulphites', 'en:celery'])).toEqual(['sulphite']);
    expect(mapAllergens(['Almonds'])).toEqual(['tree_nut']);
  });
});

describe('normalize', () => {
  const dna = hit(parseDataAndApis(200, dnaNutella));
  const off = hit(parseOpenFoodFacts(200, offNutella));

  it('fills gaps from the enrichment provider without overriding the primary', () => {
    const merged = mergeProviders(dna, { ...off, servingSize: { value: 15, unit: 'g', text: '15 g' }, per100: { ...off.per100, energyKcal: 1 } });
    expect(merged.per100.energyKcal).toBe(539);
    expect(merged.per100.fibreG).toBe(0);
    expect(merged.servingSize?.value).toBe(15);
  });

  it('derives per-serving values and the basis', () => {
    const p = buildProduct('3017620422003', 'dataandapis', { ...dna, servingSize: { value: 15, unit: 'g', text: null } }, new Date(0));
    expect(p.basis).toBe('100g');
    expect(p.perServing?.energyKcal).toBe(80.85);
    expect(p.attribution).toBe('Open Food Facts, ODbL');
  });

  it('uses a per-100 ml basis for liquids', () => {
    const p = buildProduct('3017620422003', 'openfoodfacts', { ...off, packageQuantity: { value: 1000, unit: 'ml', text: '1 L' } }, new Date(0));
    expect(p.basis).toBe('100ml');
  });
});

describe('fetch adapters', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status: number, body: string) {
    const f = vi.fn().mockResolvedValue(new Response(body, { status }));
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('sends the API key to dataandapis', async () => {
    const f = stubFetch(200, JSON.stringify(dnaNutella));
    const r = await fetchDataAndApis('3017620422003', 'k');
    expect(r.result).toBe('hit');
    expect(r.httpStatus).toBe(200);
    expect(f.mock.calls[0][1].headers['X-Api-Key']).toBe('k');
  });

  it('reports a timeout or network failure as an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    expect((await fetchDataAndApis('3017620422003', 'k')).result).toBe('error');
  });

  it('reports an unreadable 200 as an error, not a miss', async () => {
    stubFetch(200, '<html>');
    expect((await fetchDataAndApis('3017620422003', 'k')).result).toBe('error');
  });

  it('sends the User-Agent to OFF and basic auth only to staging', async () => {
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify(offNutella), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await fetchOpenFoodFacts('3017620422003', { baseUrl: 'https://world.openfoodfacts.org', userAgent: 'Chefly/1' });
    expect(f.mock.calls[0][1].headers['User-Agent']).toBe('Chefly/1');
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
    await fetchOpenFoodFacts('3017620422003', { baseUrl: 'https://world.openfoodfacts.net/', userAgent: 'Chefly/1' });
    expect(f.mock.calls[1][0]).toContain('https://world.openfoodfacts.net/api/v2/product/3017620422003.json?fields=');
    expect(f.mock.calls[1][1].headers.Authorization).toBe(`Basic ${btoa('off:off')}`);
  });
});

describe('lookup orchestrator', () => {
  afterEach(() => vi.restoreAllMocks());

  const GTIN = '3017620422003';
  const dnaData = hit(parseDataAndApis(200, dnaNutella));
  const offData = hit(parseOpenFoodFacts(200, offNutella));
  const dnaHit: ProviderResult = { result: 'hit', data: dnaData, raw: { d: 1 }, httpStatus: 200, ms: 5 };
  const offHit: ProviderResult = { result: 'hit', data: offData, raw: { o: 1 }, httpStatus: 200, ms: 5 };
  const miss: ProviderResult = { result: 'miss', httpStatus: 404, ms: 5 };
  const unauthorized: ProviderResult = { result: 'error', httpStatus: 401, ms: 5 };
  const stored = buildProduct(GTIN, 'dataandapis', dnaData, new Date(0));
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  function deps(over: Partial<Record<keyof LookupDeps, ReturnType<typeof vi.fn>>> = {}) {
    return {
      getCached: vi.fn().mockResolvedValue(null),
      missedByBoth: vi.fn().mockResolvedValue(false),
      log: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
      dataandapis: vi.fn().mockResolvedValue(dnaHit),
      openfoodfacts: vi.fn().mockResolvedValue(offHit),
      ...over,
    };
  }

  it('answers from a fresh cache without calling out', async () => {
    const d = deps({ getCached: vi.fn().mockResolvedValue({ product: stored, fresh: true }) });
    const r = await createLookup(d as unknown as LookupDeps)(GTIN, GTIN);
    expect(r).toMatchObject({ status: 'found', cached: true });
    expect(d.dataandapis).not.toHaveBeenCalled();
  });

  it('returns not_found from the negative cache without calling out', async () => {
    const d = deps({ missedByBoth: vi.fn().mockResolvedValue(true) });
    const r = await createLookup(d as unknown as LookupDeps)(GTIN, GTIN);
    expect(r.status).toBe('not_found');
    expect(d.dataandapis).not.toHaveBeenCalled();
    expect(d.log).not.toHaveBeenCalled();
  });

  it('enriches from OFF when dataandapis lacks a serving size, and stores both payloads', async () => {
    const d = deps();
    const r = await createLookup(d as unknown as LookupDeps)(GTIN, GTIN);
    expect(r).toMatchObject({ status: 'found', cached: false, product: { source: 'dataandapis' } });
    expect(d.openfoodfacts).toHaveBeenCalledOnce();
    expect(d.upsert.mock.calls[0][1]).toEqual({ dataandapis: { d: 1 }, openfoodfacts: { o: 1 } });
    expect(d.log.mock.calls[0][0].map((x: { provider: string }) => x.provider)).toEqual(['dataandapis', 'openfoodfacts']);
  });

  it('skips OFF when dataandapis has the serving size and quantity', async () => {
    const complete = { ...dnaHit, data: { ...dnaData, servingSize: { value: 15, unit: 'g' as const, text: null } } };
    const d = deps({ dataandapis: vi.fn().mockResolvedValue(complete) });
    const r = await createLookup(d as unknown as LookupDeps)(GTIN, GTIN);
    expect(d.openfoodfacts).not.toHaveBeenCalled();
    expect(r.attempts.at(-1)).toEqual({ provider: 'openfoodfacts', result: 'skipped', ms: 0 });
  });

  it('falls through to OFF on a bad key and logs the 401 (F2 AC3)', async () => {
    quiet();
    const d = deps({ dataandapis: vi.fn().mockResolvedValue(unauthorized) });
    const r = await createLookup(d as unknown as LookupDeps)(GTIN, GTIN);
    expect(r).toMatchObject({ status: 'found', product: { source: 'openfoodfacts' } });
    expect(d.log.mock.calls[0][0][0]).toEqual({ gtin: GTIN, provider: 'dataandapis', status: 'error', httpStatus: 401, latencyMs: 5 });
  });

  it('returns not_found when both miss', async () => {
    const d = deps({ dataandapis: vi.fn().mockResolvedValue(miss), openfoodfacts: vi.fn().mockResolvedValue(miss) });
    expect((await createLookup(d as unknown as LookupDeps)(GTIN, GTIN)).status).toBe('not_found');
    expect(d.upsert).not.toHaveBeenCalled();
  });

  it('serves a stale product when the refresh fails', async () => {
    quiet();
    const d = deps({
      getCached: vi.fn().mockResolvedValue({ product: stored, fresh: false }),
      dataandapis: vi.fn().mockResolvedValue(unauthorized),
      openfoodfacts: vi.fn().mockResolvedValue(unauthorized),
    });
    expect(await createLookup(d as unknown as LookupDeps)(GTIN, GTIN)).toMatchObject({ status: 'found', cached: true });
  });

  it('still answers when the attempt log fails', async () => {
    quiet();
    const d = deps({ log: vi.fn().mockRejectedValue(new Error('db')) });
    expect((await createLookup(d as unknown as LookupDeps)(GTIN, GTIN)).status).toBe('found');
  });

  it('sends the lookup code to providers and keys the cache by GTIN', async () => {
    const d = deps();
    await createLookup(d as unknown as LookupDeps)('0000012345670', '12345670');
    expect(d.getCached).toHaveBeenCalledWith('0000012345670');
    expect(d.dataandapis).toHaveBeenCalledWith('12345670');
    expect(d.openfoodfacts).toHaveBeenCalledWith('12345670');
  });

  it('shares one flight between concurrent lookups, then allows another', async () => {
    const d = deps();
    const lookup = createLookup(d as unknown as LookupDeps);
    await Promise.all([lookup(GTIN, GTIN), lookup(GTIN, GTIN), lookup(GTIN, GTIN)]);
    expect(d.dataandapis).toHaveBeenCalledOnce();
    await lookup(GTIN, GTIN);
    expect(d.dataandapis).toHaveBeenCalledTimes(2);
  });
});
