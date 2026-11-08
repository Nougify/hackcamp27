import 'server-only';
import type { Sql, TransactionSql } from 'postgres';
import type { Allergen, DisplayUnit, Nutrients, PantryItem, UnitDim } from '@/contracts/domain';
import sql from '@/lib/db';
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/errors';
import { normalizeGtin } from '@/lib/gtin';
import { formatQty, toBase, unitDim } from '@/lib/units';
import { pantryAllergenTags } from './allergens';
import { daysUntil } from './dates';
import { normalizePantryName } from './normalize';
import type { CreatePantryItemInput, UpdatePantryItemInput } from './validation';

// SPEC F5. Pantry rows are per physical batch. Every quantity change writes a pantry_events row
// in the same transaction. All statements are scoped by user_id; another user's id → 404.

/** Transaction handle typed with the pool's custom parsers (src/lib/db.ts). */
type Tx = TransactionSql<typeof sql extends Sql<infer T> ? T : never>;

export interface PantryItemRow {
  id: string;
  gtin: string | null;
  name: string;
  normalized_name: string;
  brand: string | null;
  dim: UnitDim;
  quantity_base: number | string;
  initial_quantity_base: number | string | null;
  display_unit: string;
  grams_per_unit: number | string | null;
  density_g_per_ml: number | string | null;
  expiry_date: string | null;
  expiry_source: 'photo' | 'manual' | null;
  expiry_raw_text: string | null;
  nutrition_basis: '100g' | '100ml' | 'unit';
  kcal_per_basis: number | string | null;
  protein_g_per_basis: number | string | null;
  carbs_g_per_basis: number | string | null;
  fat_g_per_basis: number | string | null;
  serving_size_base: number | string | null;
  allergen_tags: string[];
  source: PantryItem['source'];
  user_verified: boolean;
  updated_at: Date;
}

/** quantity_base is numeric(12,3). */
const MAX_QUANTITY_BASE = 1_000_000_000;

const num = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));
const round2 = (x: number) => Math.round(x * 100) / 100;

function rowNutrition(r: PantryItemRow): Nutrients {
  return {
    energyKcal: num(r.kcal_per_basis),
    proteinG: num(r.protein_g_per_basis),
    carbohydrateG: num(r.carbs_g_per_basis),
    fatG: num(r.fat_g_per_basis),
  };
}

/** Per-serving nutrition from per-100 values when the serving size is known (F10 item part). */
export function perServingFrom(basis: PantryItem['nutritionBasis'], per: Nutrients, servingSizeBase: number | null): Nutrients | null {
  if (basis === 'unit' || servingSizeBase == null || servingSizeBase <= 0) return null;
  const k = servingSizeBase / 100;
  const scale = (v: number | null | undefined) => (v == null ? null : round2(v * k));
  if ([per.energyKcal, per.proteinG, per.carbohydrateG, per.fatG].every((v) => v == null)) return null;
  return { energyKcal: scale(per.energyKcal), proteinG: scale(per.proteinG), carbohydrateG: scale(per.carbohydrateG), fatG: scale(per.fatG) };
}

export function rowToPantryItem(r: PantryItemRow, tz: string, now: Date = new Date()): PantryItem {
  const quantityBase = Number(r.quantity_base);
  const displayUnit = r.display_unit as DisplayUnit;
  const nutrition = rowNutrition(r);
  const servingSizeBase = num(r.serving_size_base);
  return {
    id: r.id,
    gtin: r.gtin,
    name: r.name,
    normalizedName: r.normalized_name,
    brand: r.brand,
    dim: r.dim,
    quantityBase,
    displayUnit,
    quantityDisplay: formatQty(quantityBase, r.dim, displayUnit),
    gramsPerUnit: num(r.grams_per_unit),
    densityGPerMl: num(r.density_g_per_ml),
    expiryDate: r.expiry_date,
    expirySource: r.expiry_source,
    daysToExpiry: r.expiry_date ? daysUntil(r.expiry_date, tz, now) : null,
    nutritionBasis: r.nutrition_basis,
    nutrition,
    perServing: perServingFrom(r.nutrition_basis, nutrition, servingSizeBase),
    servingSizeBase,
    allergenTags: r.allergen_tags as Allergen[],
    source: r.source,
    userVerified: r.user_verified,
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface ListOptions {
  sort: 'expiry' | 'name';
  includeEmpty: boolean;
}

export async function listPantry(userId: string, tz: string, opts: ListOptions): Promise<PantryItem[]> {
  const order =
    opts.sort === 'name'
      ? sql`lower(name), expiry_date ASC NULLS LAST, id`
      : sql`expiry_date ASC NULLS LAST, lower(name), id`;
  const rows = await sql<PantryItemRow[]>`
    SELECT * FROM pantry_items
    WHERE user_id = ${userId} ${opts.includeEmpty ? sql`` : sql`AND quantity_base > 0`}
    ORDER BY ${order}
  `;
  return rows.map((r) => rowToPantryItem(r, tz));
}

export async function getPantryItemForUser(userId: string, id: string, tz: string): Promise<PantryItem> {
  const [row] = await sql<PantryItemRow[]>`SELECT * FROM pantry_items WHERE id = ${id} AND user_id = ${userId}`;
  if (!row) throw new NotFoundError('Pantry item not found');
  return rowToPantryItem(row, tz);
}

function baseQuantity(quantity: number, unit: DisplayUnit): { dim: UnitDim; qtyBase: number } {
  const b = toBase(quantity, unit);
  if (!b) throw new UnprocessableError(`Unknown unit "${unit}"`);
  if (b.qtyBase >= MAX_QUANTITY_BASE) throw new UnprocessableError('That quantity is too large.');
  return b;
}

/** Canonical GTIN that exists in the products cache, else null (FK; team decision 2026-11-08). */
async function resolveGtin(tx: Tx, raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  const n = normalizeGtin(raw);
  if (!n.ok) return null;
  const [hit] = await tx<{ gtin: string }[]>`SELECT gtin FROM products WHERE gtin = ${n.gtin}`;
  return hit ? hit.gtin : null;
}

async function logEvent(
  tx: Tx,
  userId: string,
  pantryItemId: string,
  kind: 'add' | 'manual_adjust' | 'discard',
  deltaBase: number,
): Promise<void> {
  await tx`
    INSERT INTO pantry_events (user_id, pantry_item_id, kind, delta_base)
    VALUES (${userId}, ${pantryItemId}, ${kind}, ${deltaBase})
  `;
}

export async function createPantryItem(userId: string, tz: string, input: CreatePantryItemInput): Promise<PantryItem> {
  const { dim, qtyBase } = baseQuantity(input.quantity, input.displayUnit);
  const n = input.nutrition ?? null;
  const hasExpiry = input.expiryDate != null;

  const row = await sql.begin(async (tx) => {
    const gtin = await resolveGtin(tx, input.gtin);
    const [created] = await tx<PantryItemRow[]>`
      INSERT INTO pantry_items ${tx({
        user_id: userId,
        gtin,
        name: input.name,
        normalized_name: normalizePantryName(input.name, input.brand),
        brand: input.brand ?? null,
        dim,
        quantity_base: qtyBase,
        initial_quantity_base: qtyBase,
        display_unit: input.displayUnit,
        grams_per_unit: input.gramsPerUnit ?? null,
        density_g_per_ml: input.densityGPerMl ?? null,
        expiry_date: hasExpiry ? input.expiryDate! : null,
        expiry_source: hasExpiry ? input.expirySource! : null,
        expiry_raw_text: hasExpiry ? (input.expiryRawText ?? null) : null,
        nutrition_basis: input.nutritionBasis,
        kcal_per_basis: n?.energyKcal ?? null,
        protein_g_per_basis: n?.proteinG ?? null,
        carbs_g_per_basis: n?.carbohydrateG ?? null,
        fat_g_per_basis: n?.fatG ?? null,
        serving_size_base: input.servingSizeBase ?? null,
        allergen_tags: pantryAllergenTags(input.allergenTags, input.name),
        source: input.source,
        user_verified: input.userVerified,
      })}
      RETURNING *
    `;
    await logEvent(tx, userId, created.id, 'add', qtyBase);
    return created;
  });
  return rowToPantryItem(row, tz);
}

export async function updatePantryItem(
  userId: string,
  id: string,
  tz: string,
  input: UpdatePantryItemInput,
): Promise<PantryItem> {
  const row = await sql.begin(async (tx) => {
    const [cur] = await tx<PantryItemRow[]>`
      SELECT * FROM pantry_items WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
    `;
    if (!cur) throw new NotFoundError('Pantry item not found');

    const set: Record<string, unknown> = {};
    const oldBase = Number(cur.quantity_base);
    let newBase = oldBase;

    // Quantity / unit. A unit change must stay in the item's dimension (base units never change).
    const unit = (input.displayUnit ?? cur.display_unit) as DisplayUnit;
    if (input.displayUnit !== undefined) {
      if (unitDim(input.displayUnit) !== cur.dim) {
        throw new UnprocessableError(`Can't switch a ${cur.dim} item to ${input.displayUnit}`);
      }
      set.display_unit = input.displayUnit;
    }
    if (input.adjustReason === 'discard') {
      newBase = 0;
    } else if (input.quantity !== undefined) {
      newBase = baseQuantity(input.quantity, unit).qtyBase;
    }
    // Compared at column scale: converting through a display unit can add floating-point noise.
    const quantityChanged = Math.round(newBase * 1000) !== Math.round(oldBase * 1000);
    if (quantityChanged) set.quantity_base = newBase;

    if (input.name !== undefined || input.brand !== undefined) {
      const name = input.name ?? cur.name;
      const brand = input.brand !== undefined ? input.brand : cur.brand;
      if (input.name !== undefined) set.name = name;
      if (input.brand !== undefined) set.brand = brand;
      set.normalized_name = normalizePantryName(name, brand);
    }
    if (input.gramsPerUnit !== undefined) set.grams_per_unit = input.gramsPerUnit;
    if (input.densityGPerMl !== undefined) set.density_g_per_ml = input.densityGPerMl;
    if (input.expiryDate !== undefined || input.expirySource !== undefined) {
      const date = input.expiryDate ?? null;
      set.expiry_date = date;
      set.expiry_source = date ? (input.expirySource ?? null) : null;
      set.expiry_raw_text = date ? (input.expiryRawText ?? null) : null;
    } else if (input.expiryRawText !== undefined && cur.expiry_date) {
      set.expiry_raw_text = input.expiryRawText;
    }
    if (input.nutritionBasis !== undefined) set.nutrition_basis = input.nutritionBasis;
    if (input.nutrition !== undefined) {
      const n = input.nutrition;
      set.kcal_per_basis = n?.energyKcal ?? null;
      set.protein_g_per_basis = n?.proteinG ?? null;
      set.carbs_g_per_basis = n?.carbohydrateG ?? null;
      set.fat_g_per_basis = n?.fatG ?? null;
    }
    if (input.servingSizeBase !== undefined) set.serving_size_base = input.servingSizeBase;
    if (input.allergenTags !== undefined || set.name !== undefined) {
      const given = input.allergenTags ?? (cur.allergen_tags as Allergen[]);
      set.allergen_tags = pantryAllergenTags(given, (set.name as string | undefined) ?? cur.name);
    }
    if (input.userVerified !== undefined) set.user_verified = input.userVerified;

    const keys = Object.keys(set);
    if (keys.length === 0) return cur;
    const [updated] = await tx<PantryItemRow[]>`
      UPDATE pantry_items SET ${tx(set, keys)}, updated_at = now()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    if (quantityChanged) {
      await logEvent(tx, userId, id, input.adjustReason === 'discard' ? 'discard' : 'manual_adjust', newBase - oldBase);
    }
    return updated;
  });
  return rowToPantryItem(row, tz);
}

/** Restock (team decision): refill an empty row to its initial quantity, clear the expiry, log 'add'. */
export async function restockPantryItem(userId: string, id: string, tz: string): Promise<PantryItem> {
  const row = await sql.begin(async (tx) => {
    const [cur] = await tx<PantryItemRow[]>`
      SELECT * FROM pantry_items WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
    `;
    if (!cur) throw new NotFoundError('Pantry item not found');
    if (Number(cur.quantity_base) > 0) throw new ConflictError('Only empty items can be restocked');
    const initial = num(cur.initial_quantity_base);
    if (initial == null || initial <= 0) throw new UnprocessableError('This item has no original quantity to restock to');

    const [updated] = await tx<PantryItemRow[]>`
      UPDATE pantry_items
      SET quantity_base = ${initial}, expiry_date = NULL, expiry_source = NULL, expiry_raw_text = NULL, updated_at = now()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `;
    await logEvent(tx, userId, id, 'add', initial);
    return updated;
  });
  return rowToPantryItem(row, tz);
}

/** Deletes the row. Meal logs and events keep their history (pantry_item_id → NULL, F5 AC4). */
export async function deletePantryItem(userId: string, id: string): Promise<void> {
  const result = await sql`DELETE FROM pantry_items WHERE id = ${id} AND user_id = ${userId}`;
  if (result.count === 0) throw new NotFoundError('Pantry item not found');
}
