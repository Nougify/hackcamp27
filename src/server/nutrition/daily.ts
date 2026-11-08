import 'server-only';
import { z } from 'zod';
import sql from '@/lib/db';
import type { ManualMealRequest } from '@/contracts/api';
import type { DailyTotals, MealLog, UserProfile } from '@/contracts/domain';
import { NotFoundError, UnprocessableError } from '@/lib/errors';
import { normalizeGtin } from '@/lib/gtin';
import { isDisplayUnit } from '@/lib/units';
import { amountError, amountInStock, itemSource, nutritionForAmount, productSource, type MealNutrition } from '@/features/nutrition/amounts';
import { addDays, todayInTz } from '@/server/pantry/dates';
import { getProfile } from '@/server/pantry/profile';
import { rowToPantryItem, type PantryItemRow } from '@/server/pantry/repo';
import { getCachedProduct } from '@/server/products/repo';

// SPEC F15. Every query is scoped to the signed-in user. Today reads meal_logs by local_date, which
// is exact; history reads the daily_nutrition continuous aggregate.

/** daily_nutrition buckets days in this zone (migration 0002; SPEC accepts the mismatch elsewhere). */
const AGGREGATE_TZ = 'America/Vancouver';
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_KCAL = 50_000;

const eatenAt = z.iso.datetime({ offset: true }).optional();
const amount = z.number().positive().max(100_000);
const unit = z.string().refine(isDisplayUnit, 'unknown unit');

export const manualMealSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quick_add'),
    label: z.string().trim().min(1).max(120),
    kcal: z.number().min(0).max(MAX_KCAL),
    proteinG: z.number().min(0).max(5000),
    carbsG: z.number().min(0).max(5000).optional(),
    fatG: z.number().min(0).max(5000).optional(),
    eatenAt,
  }),
  z.object({ kind: z.literal('pantry_item'), pantryItemId: z.uuid(), amount, unit, deductFromPantry: z.boolean(), eatenAt }),
  z.object({ kind: z.literal('barcode'), gtin: z.string().max(40), amount, unit, eatenAt }),
]);

interface MealRow {
  id: string;
  eaten_at: Date;
  local_date: string;
  source: MealLog['source'];
  label: string;
  servings: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number | null;
  fat_g: number | null;
  cooking_session_id: string | null;
  pantry_item_id: string | null;
}

function rowToMeal(r: MealRow): MealLog {
  return {
    id: r.id,
    eatenAt: r.eaten_at.toISOString(),
    localDate: r.local_date,
    source: r.source,
    label: r.label,
    servings: r.servings,
    kcal: r.kcal,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    cookingSessionId: r.cooking_session_id,
    pantryItemId: r.pantry_item_id,
  };
}

function checkedNutrition(result: ReturnType<typeof nutritionForAmount>): MealNutrition {
  if (!result.ok) throw new UnprocessableError(amountError(result.reason));
  if (result.meal.kcal > MAX_KCAL) throw new UnprocessableError('That amount is too large to log.');
  return result.meal;
}

function resolveEatenAt(raw: string | undefined): Date {
  const at = raw ? new Date(raw) : new Date();
  if (at.getTime() > Date.now() + FUTURE_TOLERANCE_MS) throw new UnprocessableError("A meal can't be logged in the future.");
  return at;
}

interface NewMeal extends MealNutrition {
  source: MealLog['source'];
  label: string;
  pantryItemId: string | null;
}

const trimNumber = (n: number) => String(Math.round(n * 100) / 100);

export async function logMeal(user: { id: string; tz: string }, input: ManualMealRequest): Promise<MealLog> {
  const at = resolveEatenAt(input.eatenAt);
  const localDate = todayInTz(user.tz, at);
  // Before the transaction: this uses its own pooled connection, which could deadlock inside one.
  const code = input.kind === 'barcode' ? normalizeGtin(input.gtin) : null;
  const cached = code?.ok ? await getCachedProduct(code.gtin) : null;

  return sql.begin(async (tx) => {
    let meal: NewMeal;
    if (input.kind === 'quick_add') {
      meal = {
        source: 'manual',
        label: input.label,
        pantryItemId: null,
        kcal: input.kcal,
        proteinG: input.proteinG,
        carbsG: input.carbsG ?? null,
        fatG: input.fatG ?? null,
      };
    } else if (input.kind === 'pantry_item') {
      const [row] = await tx<PantryItemRow[]>`SELECT * FROM pantry_items WHERE id = ${input.pantryItemId} AND user_id = ${user.id} FOR UPDATE`;
      if (!row) throw new NotFoundError('Pantry item not found');
      const item = rowToPantryItem(row, user.tz);
      const source = itemSource(item);
      meal = {
        ...checkedNutrition(nutritionForAmount(source, input.amount, input.unit)),
        source: 'pantry_item',
        label: `${item.name} (${trimNumber(input.amount)} ${input.unit})`,
        pantryItemId: item.id,
      };

      if (input.deductFromPantry) {
        const wanted = amountInStock(source, input.amount, input.unit);
        if (wanted === null) throw new UnprocessableError(amountError('no_conversion'));
        // Clamped like finish-cooking: eating more than the recorded stock empties it.
        const take = Math.round(Math.min(item.quantityBase, wanted) * 1000) / 1000;
        if (take > 0) {
          await tx`UPDATE pantry_items SET quantity_base = quantity_base - ${take}, updated_at = now() WHERE id = ${item.id}`;
          await tx`INSERT INTO pantry_events (user_id, pantry_item_id, kind, delta_base) VALUES (${user.id}, ${item.id}, 'eat_deduct', ${-take})`;
        }
      }
    } else {
      if (!cached) throw new NotFoundError('Product not found. Scan it again.');
      const { product } = cached;
      const source = productSource(product);
      meal = {
        ...checkedNutrition(nutritionForAmount(source, input.amount, input.unit)),
        source: 'barcode',
        label: `${product.name} (${trimNumber(input.amount)} ${input.unit})`,
        pantryItemId: null,
      };
    }

    const [row] = await tx<MealRow[]>`
      INSERT INTO meal_logs (eaten_at, user_id, local_date, source, pantry_item_id, label, kcal, protein_g, carbs_g, fat_g)
      VALUES (${at.toISOString()}, ${user.id}, ${localDate}, ${meal.source}, ${meal.pantryItemId}, ${meal.label},
              ${meal.kcal}, ${meal.proteinG}, ${meal.carbsG}, ${meal.fatG})
      RETURNING *`;
    return rowToMeal(row);
  });
}

export async function listMeals(userId: string, date: string): Promise<MealLog[]> {
  const rows = await sql<MealRow[]>`
    SELECT * FROM meal_logs WHERE user_id = ${userId} AND local_date = ${date} ORDER BY eaten_at DESC, id`;
  return rows.map(rowToMeal);
}

/**
 * eaten_at has microseconds but a JS date only milliseconds, so the key the client holds is
 * truncated; match the millisecond it falls in. The pantry is deliberately left alone.
 */
export async function deleteMeal(userId: string, id: string, eatenAt: Date): Promise<void> {
  const from = eatenAt.toISOString();
  const to = new Date(eatenAt.getTime() + 1).toISOString();
  const result = await sql`
    DELETE FROM meal_logs
    WHERE id = ${id} AND user_id = ${userId} AND eaten_at >= ${from}::timestamptz AND eaten_at < ${to}::timestamptz`;
  if (result.count === 0) throw new NotFoundError('Meal not found');
}

type Goals = Pick<UserProfile, 'dailyKcalGoal' | 'dailyProteinGoalG'>;

export async function getTodayTotals(user: { id: string; tz: string }, knownGoals?: Goals): Promise<DailyTotals> {
  const date = todayInTz(user.tz);
  const [[row], goals] = await Promise.all([
    sql<{ kcal: number; protein_g: number; carbs_g: number; fat_g: number; entries: number }[]>`
      SELECT coalesce(sum(kcal), 0) AS kcal, coalesce(sum(protein_g), 0) AS protein_g,
             coalesce(sum(carbs_g), 0) AS carbs_g, coalesce(sum(fat_g), 0) AS fat_g, count(*)::int AS entries
      FROM meal_logs WHERE user_id = ${user.id} AND local_date = ${date}`,
    knownGoals ?? getProfile(user.id),
  ]);
  return {
    date,
    kcal: row.kcal,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    entries: row.entries,
    kcalGoal: goals.dailyKcalGoal,
    proteinGoalG: goals.dailyProteinGoalG,
  };
}

export const MAX_HISTORY_DAYS = 30;

/** The last `days` days ending today, oldest first, with empty days filled in as zeros. */
export async function getHistory(user: { id: string; tz: string }, days: number, knownGoals?: Goals): Promise<DailyTotals[]> {
  const today = todayInTz(user.tz);
  const first = addDays(today, -(days - 1));
  const afterLast = addDays(today, 1);
  const [rows, goals] = await Promise.all([
    sql<{ date: string; kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; entries: number }[]>`
      SELECT (day AT TIME ZONE ${AGGREGATE_TZ})::date AS date, kcal, protein_g, carbs_g, fat_g, entries
      FROM daily_nutrition
      WHERE user_id = ${user.id}
        AND day >= (${first}::date)::timestamp AT TIME ZONE ${AGGREGATE_TZ}
        AND day < (${afterLast}::date)::timestamp AT TIME ZONE ${AGGREGATE_TZ}`,
    knownGoals ?? getProfile(user.id),
  ]);
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(first, i);
    const r = byDate.get(date);
    return {
      date,
      kcal: r?.kcal ?? 0,
      proteinG: r?.protein_g ?? 0,
      carbsG: r?.carbs_g ?? 0,
      fatG: r?.fat_g ?? 0,
      entries: r?.entries ?? 0,
      kcalGoal: goals.dailyKcalGoal,
      proteinGoalG: goals.dailyProteinGoalG,
    };
  });
}
