import 'server-only';
import sql from '@/lib/db';
import type { Allergen, Nutrients, Product, UnitDim } from '@/contracts/domain';
import { parseServingText } from './parse';

// products is a shared catalogue with no user data, so these queries have no user scope.

export interface LookupLogRow {
  gtin: string;
  provider: 'dataandapis' | 'openfoodfacts';
  status: 'hit' | 'miss' | 'error';
  httpStatus: number | null;
  latencyMs: number;
}

interface ProductRow {
  gtin: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  categories: string[];
  allergen_tags: Allergen[];
  package_qty_text: string | null;
  package_dim: UnitDim | null;
  package_qty_base: number | null;
  serving_size_text: string | null;
  serving_size_base: number | null;
  nutrition_basis: '100g' | '100ml';
  per100: Nutrients;
  per_serving: Nutrients | null;
  source: Product['source'];
  attribution: string | null;
  fetched_at: Date;
  fresh: boolean;
}

const PACKAGE_UNIT = { mass: 'g', volume: 'ml', count: 'count' } as const;
const PACKAGE_DIM = { g: 'mass', ml: 'volume', count: 'count' } as const;

export function rowToProduct(r: Omit<ProductRow, 'fresh'>): Product {
  const basisUnit = r.nutrition_basis === '100ml' ? 'ml' : 'g';
  return {
    gtin: r.gtin,
    name: r.name,
    brand: r.brand,
    imageUrl: r.image_url,
    categories: r.categories,
    allergenTags: r.allergen_tags,
    packageQuantity:
      r.package_qty_base != null && r.package_dim
        ? { value: r.package_qty_base, unit: PACKAGE_UNIT[r.package_dim], text: r.package_qty_text }
        : null,
    servingSize:
      r.serving_size_base != null
        ? { value: r.serving_size_base, unit: parseServingText(r.serving_size_text)?.unit ?? basisUnit, text: r.serving_size_text }
        : null,
    basis: r.nutrition_basis,
    per100: r.per100,
    perServing: r.per_serving,
    source: r.source,
    attribution: r.attribution,
    fetchedAt: r.fetched_at.toISOString(),
  };
}

export async function getCachedProduct(gtin: string): Promise<{ product: Product; fresh: boolean } | null> {
  const [row] = await sql<ProductRow[]>`SELECT *, refresh_after > now() AS fresh FROM products WHERE gtin = ${gtin}`;
  return row ? { product: rowToProduct(row), fresh: row.fresh } : null;
}

/** SPEC F2 step 2: only `miss` rows count. `error` rows mean we never got an answer. */
export async function missedByBothProviders(gtin: string): Promise<boolean> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT provider)::int AS n
    FROM barcode_lookups
    WHERE gtin = ${gtin} AND status = 'miss' AND created_at > now() - interval '14 days'`;
  return row.n >= 2;
}

export async function logLookups(rows: LookupLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r) => ({ gtin: r.gtin, provider: r.provider, status: r.status, http_status: r.httpStatus, latency_ms: r.latencyMs }));
  await sql`INSERT INTO barcode_lookups ${sql(values, 'gtin', 'provider', 'status', 'http_status', 'latency_ms')}`;
}

export async function upsertProduct(p: Product, raw: unknown): Promise<void> {
  const dim = p.packageQuantity ? PACKAGE_DIM[p.packageQuantity.unit] : null;
  await sql`
    INSERT INTO products (
      gtin, name, brand, image_url, categories, allergen_tags, package_qty_text, package_dim, package_qty_base,
      serving_size_text, serving_size_base, nutrition_basis, per100, per_serving, source, attribution, raw, fetched_at, refresh_after
    ) VALUES (
      ${p.gtin}, ${p.name}, ${p.brand}, ${p.imageUrl}, ${p.categories}, ${p.allergenTags},
      ${p.packageQuantity?.text ?? null}, ${dim}, ${p.packageQuantity?.value ?? null},
      ${p.servingSize?.text ?? null}, ${p.servingSize?.value ?? null}, ${p.basis},
      ${sql.json(p.per100 as never) as never}, ${p.perServing ? (sql.json(p.perServing as never) as never) : null},
      ${p.source}, ${p.attribution}, ${sql.json(raw as never) as never}, now(), now() + interval '120 days'
    )
    ON CONFLICT (gtin) DO UPDATE SET
      name = EXCLUDED.name, brand = EXCLUDED.brand, image_url = EXCLUDED.image_url, categories = EXCLUDED.categories,
      allergen_tags = EXCLUDED.allergen_tags, package_qty_text = EXCLUDED.package_qty_text, package_dim = EXCLUDED.package_dim,
      package_qty_base = EXCLUDED.package_qty_base, serving_size_text = EXCLUDED.serving_size_text,
      serving_size_base = EXCLUDED.serving_size_base, nutrition_basis = EXCLUDED.nutrition_basis, per100 = EXCLUDED.per100,
      per_serving = EXCLUDED.per_serving, source = EXCLUDED.source, attribution = EXCLUDED.attribution, raw = EXCLUDED.raw,
      fetched_at = EXCLUDED.fetched_at, refresh_after = EXCLUDED.refresh_after`;
}
