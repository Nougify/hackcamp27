import 'server-only';
import sql from '@/lib/db';
import { formatQty } from '@/lib/units';
import type { DisplayUnit, Nutrients, PantryItem, UnitDim } from '@/contracts/domain';

export interface PantryRow {
  id: string;
  gtin: string | null;
  name: string;
  normalized_name: string;
  brand: string | null;
  dim: UnitDim;
  quantity_base: string | number;
  display_unit: string;
  grams_per_unit: string | number | null;
  density_g_per_ml: string | number | null;
  expiry_date: string | Date | null;
  expiry_source: 'photo' | 'manual' | null;
  expiry_raw_text: string | null;
  nutrition_basis: '100g' | '100ml' | 'unit';
  kcal_per_basis: string | number | null;
  protein_g_per_basis: string | number | null;
  carbs_g_per_basis: string | number | null;
  fat_g_per_basis: string | number | null;
  serving_size_base: string | number | null;
  allergen_tags: string[];
  source: PantryItem['source'];
  user_verified: boolean;
  updated_at: Date;
}

const num = (v: string | number | null): number | null => (v == null ? null : Number(v));

function isoDateInTz(now: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days from today (in `tz`) to the expiry date. Negative = past date. */
export function daysToExpiryInTz(expiryDate: string, tz: string, now = new Date()): number {
  const today = isoDateInTz(now, tz);
  const msPerDay = 86_400_000;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${expiryDate}T00:00:00Z`);
  return Math.round((b - a) / msPerDay);
}

function rowToNutrition(row: PantryRow): Nutrients {
  return {
    energyKcal: num(row.kcal_per_basis),
    proteinG: num(row.protein_g_per_basis),
    carbohydrateG: num(row.carbs_g_per_basis),
    fatG: num(row.fat_g_per_basis),
    saturatedFatG: null,
    sugarsG: null,
    fibreG: null,
    sodiumMg: null,
  };
}

export function rowToPantryItem(row: PantryRow, tz: string, now = new Date()): PantryItem {
  const quantityBase = Number(row.quantity_base);
  const displayUnit = row.display_unit as DisplayUnit;
  const expiryDate =
    row.expiry_date == null
      ? null
      : typeof row.expiry_date === 'string'
        ? row.expiry_date.slice(0, 10)
        : row.expiry_date.toISOString().slice(0, 10);
  return {
    id: row.id,
    gtin: row.gtin,
    name: row.name,
    normalizedName: row.normalized_name,
    brand: row.brand,
    dim: row.dim,
    quantityBase,
    displayUnit,
    quantityDisplay: formatQty(quantityBase, row.dim, displayUnit),
    gramsPerUnit: num(row.grams_per_unit),
    densityGPerMl: num(row.density_g_per_ml),
    expiryDate,
    expirySource: row.expiry_source,
    daysToExpiry: expiryDate ? daysToExpiryInTz(expiryDate, tz, now) : null,
    nutritionBasis: row.nutrition_basis,
    nutrition: rowToNutrition(row),
    perServing: null,
    servingSizeBase: num(row.serving_size_base),
    allergenTags: (row.allergen_tags ?? []) as PantryItem['allergenTags'],
    source: row.source,
    userVerified: row.user_verified,
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Read-only pantry view for recipe matching (F6 step 1): quantity > 0,
 * expired excluded, sorted by daysToExpiry, capped at 25.
 */
export async function listPantryForMatching(
  userId: string,
  tz: string,
  now = new Date(),
  limit = 25,
  graceDays = 0,
): Promise<PantryItem[]> {
  const rows = await sql<PantryRow[]>`
    SELECT * FROM pantry_items
    WHERE user_id = ${userId} AND quantity_base > 0
    ORDER BY expiry_date NULLS LAST, normalized_name
  `;
  return pantryForMatching(rows, tz, now, limit, graceDays);
}

/**
 * Matching view of pantry rows: in stock, not expired beyond the user's
 * pastBestBeforeGraceDays (contracts/domain.ts; also drives "expiring soon"
 * and pantry colouring in src/features/pantry/expiry.ts), soonest expiry
 * first (FEFO). Shared with finish.
 */
export function pantryForMatching(rows: PantryRow[], tz: string, now = new Date(), limit = 25, graceDays = 0): PantryItem[] {
  return rows
    .filter((row) => Number(row.quantity_base) > 0)
    .map((row) => rowToPantryItem(row, tz, now))
    .filter((item) => item.daysToExpiry == null || item.daysToExpiry >= -graceDays)
    .sort((a, b) => (a.daysToExpiry ?? 9999) - (b.daysToExpiry ?? 9999))
    .slice(0, limit);
}

export async function getPantryItem(userId: string, id: string, tz: string): Promise<PantryItem | null> {
  const rows = await sql<PantryRow[]>`
    SELECT * FROM pantry_items WHERE user_id = ${userId} AND id = ${id} LIMIT 1
  `;
  const row = rows[0];
  return row ? rowToPantryItem(row, tz) : null;
}

export async function listPantryByIds(userId: string, ids: string[], tz: string): Promise<PantryItem[]> {
  if (ids.length === 0) return [];
  const rows = await sql<PantryRow[]>`SELECT * FROM pantry_items WHERE user_id = ${userId} AND id = ANY(${ids})`;
  return rows.map((row) => rowToPantryItem(row, tz));
}

export async function getProfileFilters(
  userId: string,
): Promise<{ diets: string[]; allergens: string[]; tz: string; pastBestBeforeGraceDays: number }> {
  const rows = await sql<{ diets: string[]; allergens: string[]; tz: string; past_best_before_grace_days: number }[]>`
    SELECT diets, allergens, tz, past_best_before_grace_days FROM users WHERE id = ${userId} LIMIT 1
  `;
  const row = rows[0];
  return {
    diets: row?.diets ?? [],
    allergens: row?.allergens ?? [],
    tz: row?.tz ?? 'America/Vancouver',
    pastBestBeforeGraceDays: row?.past_best_before_grace_days ?? 0,
  };
}
