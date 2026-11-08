import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { gs1CheckDigit } from '@/lib/gtin';
import { buildProduct } from './normalize';
import { emptyNutrients } from './parse';
import { getCachedProduct, logLookups, missedByBothProviders, upsertProduct } from './repo';

// Runs against DATABASE_URL_TEST (Tiger fork) via `npm run test:db`.
const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL) throw new Error('DATABASE_URL_TEST is required for db tests.');
const tsql = postgres(TEST_URL, { max: 2, ssl: 'require', onnotice: () => {} });

const made: string[] = [];
function gtin(): string {
  const body = `9${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  const code = `${body}${gs1CheckDigit(body)}`;
  made.push(code);
  return code;
}

function product(code: string) {
  return buildProduct(
    code,
    'openfoodfacts',
    {
      name: 'Test oat drink',
      brand: 'Brand',
      imageUrl: null,
      categories: ['Drinks'],
      allergenTags: ['wheat_gluten'],
      packageQuantity: { value: 1000, unit: 'ml', text: '1 L' },
      servingSize: { value: 250, unit: 'ml', text: '1 cup (250 ml)' },
      per100: { ...emptyNutrients(), energyKcal: 45.5, sodiumMg: 42.8 },
      perServing: null,
    },
    new Date(),
  );
}

afterAll(async () => {
  await tsql`DELETE FROM barcode_lookups WHERE gtin = ANY(${made})`;
  await tsql`DELETE FROM products WHERE gtin = ANY(${made})`;
  await tsql.end();
});

describe('products repo', () => {
  it('round-trips a product and refreshes it on conflict', async () => {
    const code = gtin();
    const p = product(code);
    await upsertProduct(p, { openfoodfacts: { a: 1 } });
    const got = await getCachedProduct(code);
    expect(got?.fresh).toBe(true);
    expect(got?.product).toMatchObject({
      gtin: code,
      basis: '100ml',
      categories: ['Drinks'],
      allergenTags: ['wheat_gluten'],
      packageQuantity: { value: 1000, unit: 'ml', text: '1 L' },
      servingSize: { value: 250, unit: 'ml', text: '1 cup (250 ml)' },
      per100: { energyKcal: 45.5, sodiumMg: 42.8 },
    });
    expect(got?.product.perServing?.energyKcal).toBe(113.75);

    await upsertProduct({ ...p, name: 'Renamed', perServing: null }, { dataandapis: {} });
    const again = await getCachedProduct(code);
    expect(again?.product.name).toBe('Renamed');
    expect(again?.product.perServing).toBeNull();
    const [row] = await tsql`SELECT raw FROM products WHERE gtin = ${code}`;
    expect(row.raw).toEqual({ dataandapis: {} });
  });

  it('reports a product past refresh_after as stale', async () => {
    const code = gtin();
    await upsertProduct(product(code), {});
    await tsql`UPDATE products SET refresh_after = now() - interval '1 day' WHERE gtin = ${code}`;
    expect((await getCachedProduct(code))?.fresh).toBe(false);
  });

  it('returns null for an unknown product', async () => {
    expect(await getCachedProduct(gtin())).toBeNull();
  });

  const row = (code: string, provider: 'dataandapis' | 'openfoodfacts', status: 'hit' | 'miss' | 'error') => ({
    gtin: code,
    provider,
    status,
    httpStatus: status === 'error' ? 401 : 404,
    latencyMs: 12,
  });

  it('negative-caches only when both providers missed', async () => {
    const code = gtin();
    await logLookups([row(code, 'dataandapis', 'miss')]);
    expect(await missedByBothProviders(code)).toBe(false);
    await logLookups([row(code, 'dataandapis', 'miss')]);
    expect(await missedByBothProviders(code)).toBe(false);
    await logLookups([row(code, 'openfoodfacts', 'miss')]);
    expect(await missedByBothProviders(code)).toBe(true);
  });

  it('never treats errors as misses', async () => {
    const code = gtin();
    await logLookups([row(code, 'dataandapis', 'error'), row(code, 'openfoodfacts', 'miss')]);
    expect(await missedByBothProviders(code)).toBe(false);
  });

  it('forgets misses older than 14 days', async () => {
    const code = gtin();
    await logLookups([row(code, 'dataandapis', 'miss'), row(code, 'openfoodfacts', 'miss')]);
    await tsql`UPDATE barcode_lookups SET created_at = now() - interval '15 days' WHERE gtin = ${code}`;
    expect(await missedByBothProviders(code)).toBe(false);
  });
});
