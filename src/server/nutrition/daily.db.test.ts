import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { NotFoundError, UnprocessableError } from '@/lib/errors';
import { gs1CheckDigit } from '@/lib/gtin';
import { addDays, todayInTz } from '@/server/pantry/dates';
import { createPantryItem } from '@/server/pantry/repo';
import { createPantryItemSchema } from '@/server/pantry/validation';
import { buildProduct } from '@/server/products/normalize';
import { emptyNutrients } from '@/server/products/parse';
import { upsertProduct } from '@/server/products/repo';
import { deleteMeal, getHistory, getTodayTotals, listMeals, logMeal } from './daily';

// Runs against DATABASE_URL_TEST (Tiger fork) via `npm run test:db`.
const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL) throw new Error('DATABASE_URL_TEST is required for db tests.');
const tsql = postgres(TEST_URL, { max: 2, ssl: 'require', onnotice: () => {} });

const TZ = 'America/Vancouver';
const users: string[] = [];
const gtins: string[] = [];

async function makeUser(goal: number | null = 2000) {
  const sub = `test|nutrition-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [row] = await tsql<{ id: string }[]>`INSERT INTO users (auth0_sub, tz, daily_kcal_goal) VALUES (${sub}, ${TZ}, ${goal}) RETURNING id`;
  users.push(row.id);
  return { id: row.id, tz: TZ };
}

function yogurt(userId: string, over: object = {}) {
  return createPantryItem(
    userId,
    TZ,
    createPantryItemSchema.parse({
      name: 'Greek Yogurt',
      quantity: 400,
      displayUnit: 'g',
      nutritionBasis: '100g',
      nutrition: { energyKcal: 59, proteinG: 10, carbohydrateG: 3.6, fatG: 0.4 },
      source: 'manual',
      userVerified: true,
      ...over,
    }),
  );
}

const quick = (over: object = {}) => ({ kind: 'quick_add' as const, label: 'Snack', kcal: 200, proteinG: 5, ...over });

afterAll(async () => {
  await tsql`DELETE FROM users WHERE id = ANY(${users})`;
  await tsql`DELETE FROM products WHERE gtin = ANY(${gtins})`;
  await tsql.end();
});

describe('logMeal', () => {
  it('logs 170 g of yogurt, deducts it and writes the event in one go (F15 AC1)', async () => {
    const user = await makeUser();
    const item = await yogurt(user.id);
    const meal = await logMeal(user, { kind: 'pantry_item', pantryItemId: item.id, amount: 170, unit: 'g', deductFromPantry: true });
    expect(meal).toMatchObject({ source: 'pantry_item', kcal: 100.3, proteinG: 17, pantryItemId: item.id, label: 'Greek Yogurt (170 g)', localDate: todayInTz(TZ) });

    const [row] = await tsql`SELECT quantity_base FROM pantry_items WHERE id = ${item.id}`;
    expect(Number(row.quantity_base)).toBe(230);
    const events = await tsql`SELECT kind, delta_base FROM pantry_events WHERE pantry_item_id = ${item.id} AND kind = 'eat_deduct'`;
    expect(events.map((e) => Number(e.delta_base))).toEqual([-170]);

    expect(await getTodayTotals(user)).toMatchObject({ kcal: 100.3, proteinG: 17, entries: 1, kcalGoal: 2000 });
  });

  it('leaves the pantry alone when told to', async () => {
    const user = await makeUser();
    const item = await yogurt(user.id);
    await logMeal(user, { kind: 'pantry_item', pantryItemId: item.id, amount: 100, unit: 'g', deductFromPantry: false });
    const [row] = await tsql`SELECT quantity_base FROM pantry_items WHERE id = ${item.id}`;
    expect(Number(row.quantity_base)).toBe(400);
    expect(await tsql`SELECT 1 FROM pantry_events WHERE pantry_item_id = ${item.id} AND kind = 'eat_deduct'`).toHaveLength(0);
  });

  it('clamps a deduction at the stock but logs what was eaten', async () => {
    const user = await makeUser();
    const item = await yogurt(user.id, { quantity: 50 });
    const meal = await logMeal(user, { kind: 'pantry_item', pantryItemId: item.id, amount: 100, unit: 'g', deductFromPantry: true });
    expect(meal.kcal).toBe(59);
    const [row] = await tsql`SELECT quantity_base FROM pantry_items WHERE id = ${item.id}`;
    expect(Number(row.quantity_base)).toBe(0);
  });

  it('blocks an item with no calories and changes nothing', async () => {
    const user = await makeUser();
    const item = await yogurt(user.id, { nutrition: null });
    await expect(logMeal(user, { kind: 'pantry_item', pantryItemId: item.id, amount: 100, unit: 'g', deductFromPantry: true })).rejects.toThrow(UnprocessableError);
    const [row] = await tsql`SELECT quantity_base FROM pantry_items WHERE id = ${item.id}`;
    expect(Number(row.quantity_base)).toBe(400);
    expect(await listMeals(user.id, todayInTz(TZ))).toHaveLength(0);
  });

  it("can't touch another user's pantry item", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const item = await yogurt(a.id);
    await expect(logMeal(b, { kind: 'pantry_item', pantryItemId: item.id, amount: 100, unit: 'g', deductFromPantry: true })).rejects.toThrow(NotFoundError);
    const [row] = await tsql`SELECT quantity_base FROM pantry_items WHERE id = ${item.id}`;
    expect(Number(row.quantity_base)).toBe(400);
  });

  it('logs a scanned product from the cache', async () => {
    const user = await makeUser();
    const body = `8${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    const gtin = `${body}${gs1CheckDigit(body)}`;
    gtins.push(gtin);
    await upsertProduct(
      buildProduct(gtin, 'openfoodfacts', { name: 'Cereal', brand: null, imageUrl: null, categories: [], allergenTags: [], packageQuantity: null, servingSize: null, per100: { ...emptyNutrients(), energyKcal: 400, proteinG: 10 }, perServing: null }, new Date()),
      {},
    );
    expect(await logMeal(user, { kind: 'barcode', gtin, amount: 50, unit: 'g' })).toMatchObject({ source: 'barcode', kcal: 200, proteinG: 5, label: 'Cereal (50 g)' });
  });

  it('files a meal under the local date of when it was eaten', async () => {
    const user = await makeUser();
    const meal = await logMeal(user, { ...quick(), eatenAt: '2026-01-02T03:00:00Z' });
    expect(meal.localDate).toBe('2026-01-01');
  });

  it('refuses a meal in the future', async () => {
    const user = await makeUser();
    await expect(logMeal(user, { ...quick(), eatenAt: new Date(Date.now() + 3_600_000).toISOString() })).rejects.toThrow(UnprocessableError);
  });
});

describe('deleteMeal', () => {
  it('deletes a row whose eaten_at has microseconds (F15 AC4)', async () => {
    const user = await makeUser();
    const today = todayInTz(TZ);
    // A finish-cooking row: eaten_at from the database's now(), with microseconds.
    await tsql`INSERT INTO meal_logs (user_id, local_date, source, label, kcal) VALUES (${user.id}, ${today}, 'manual', 'Recipe', 500)`;
    const [meal] = await listMeals(user.id, today);
    await deleteMeal(user.id, meal.id, new Date(meal.eatenAt));
    expect(await getTodayTotals(user)).toMatchObject({ kcal: 0, entries: 0 });
  });

  it("is 404 for another user's meal and leaves it", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const meal = await logMeal(a, quick());
    await expect(deleteMeal(b.id, meal.id, new Date(meal.eatenAt))).rejects.toThrow(NotFoundError);
    expect(await listMeals(a.id, meal.localDate)).toHaveLength(1);
  });

  it('leaves the pantry unchanged (team decision)', async () => {
    const user = await makeUser();
    const item = await yogurt(user.id);
    const meal = await logMeal(user, { kind: 'pantry_item', pantryItemId: item.id, amount: 100, unit: 'g', deductFromPantry: true });
    await deleteMeal(user.id, meal.id, new Date(meal.eatenAt));
    const [row] = await tsql`SELECT quantity_base FROM pantry_items WHERE id = ${item.id}`;
    expect(Number(row.quantity_base)).toBe(300);
  });
});

describe('history', () => {
  it('zero-fills, ends today and includes meals not yet materialized', async () => {
    const user = await makeUser();
    const today = todayInTz(TZ);
    await logMeal(user, quick({ kcal: 150 }));

    const days = await getHistory(user, 7);
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)));
    expect(days[6]).toMatchObject({ kcal: 150, entries: 1, kcalGoal: 2000 });
    expect(days[0]).toMatchObject({ kcal: 0, entries: 0, kcalGoal: 2000 });
  });

  it("never includes another user's days", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await logMeal(a, quick());
    expect((await getHistory(b, 7)).every((d) => d.entries === 0)).toBe(true);
  });

  it("serves yesterday's totals from the continuous aggregate (F15 AC3)", async () => {
    const user = await makeUser();
    const yesterday = addDays(todayInTz(TZ), -1);
    await logMeal(user, { ...quick({ kcal: 300 }), eatenAt: `${yesterday}T20:00:00Z` }); // midday in Vancouver
    await tsql.unsafe(`CALL refresh_continuous_aggregate('daily_nutrition', NULL, now())`);

    // With the source row gone, only the materialized aggregate can still answer.
    await tsql`DELETE FROM meal_logs WHERE user_id = ${user.id}`;
    expect((await getHistory(user, 7))[5]).toMatchObject({ date: yesterday, kcal: 300, entries: 1 });

    const plan = await tsql.unsafe(`EXPLAIN SELECT * FROM daily_nutrition WHERE user_id = '${user.id}'`);
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/_materialized_hypertable_/);
  });
});
