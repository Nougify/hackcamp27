import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/errors';
import { gs1CheckDigit } from '@/lib/gtin';
import { addDays, todayInTz } from './dates';
import { deleteUserData, getProfile, updateProfile } from './profile';
import {
  createPantryItem,
  deletePantryItem,
  getPantryItemForUser,
  listPantry,
  restockPantryItem,
  updatePantryItem,
} from './repo';
import { createPantryItemSchema, type CreatePantryItemInput } from './validation';

// Runs against DATABASE_URL_TEST (Tiger fork) via `npm run test:db`. Fails fast when unconfigured.
const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL) throw new Error('DATABASE_URL_TEST is required for db tests (npm run test:db against a Tiger fork).');
const tsql = postgres(TEST_URL, { max: 2, ssl: 'require', onnotice: () => {} });

const TZ = 'America/Vancouver';
const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const createdUsers: string[] = [];
const createdGtins: string[] = [];

async function makeUser(): Promise<string> {
  const [row] = await tsql<{ id: string }[]>`
    INSERT INTO users (auth0_sub, tz) VALUES (${`test|pantry-${uid()}`}, ${TZ}) RETURNING id`;
  createdUsers.push(row.id);
  return row.id;
}

function item(over: Partial<CreatePantryItemInput> = {}): CreatePantryItemInput {
  return createPantryItemSchema.parse({
    name: 'Greek Yogurt 750 g',
    brand: 'Oikos',
    quantity: 400,
    displayUnit: 'g',
    nutritionBasis: '100g',
    nutrition: { energyKcal: 59, proteinG: 10, carbohydrateG: 3.6, fatG: 0.4 },
    servingSizeBase: 175,
    source: 'manual',
    userVerified: true,
    ...over,
  });
}

async function events(itemId: string) {
  return tsql<{ kind: string; delta_base: number }[]>`
    SELECT kind, delta_base::float AS delta_base FROM pantry_events WHERE pantry_item_id = ${itemId} ORDER BY occurred_at`;
}

afterAll(async () => {
  if (createdUsers.length) await tsql`DELETE FROM users WHERE id = ANY(${createdUsers}::uuid[])`;
  if (createdGtins.length) await tsql`DELETE FROM products WHERE gtin = ANY(${createdGtins}::text[])`;
  await tsql.end();
});

describe('createPantryItem', () => {
  it('stores base units, normalized name, detected allergens, initial quantity and an add event', async () => {
    const u = await makeUser();
    const it1 = await createPantryItem(u, TZ, item({ quantity: 0.75, displayUnit: 'kg' }));
    expect(it1).toMatchObject({
      name: 'Greek Yogurt 750 g',
      normalizedName: 'greek yogurt',
      dim: 'mass',
      quantityBase: 750,
      displayUnit: 'kg',
      quantityDisplay: expect.stringContaining('0.75'),
      allergenTags: ['milk'],
      source: 'manual',
      userVerified: true,
      expiryDate: null,
      daysToExpiry: null,
    });
    expect(it1.perServing).toEqual({ energyKcal: 103.25, proteinG: 17.5, carbohydrateG: 6.3, fatG: 0.7 });
    const [raw] = await tsql<{ initial_quantity_base: number }[]>`
      SELECT initial_quantity_base::float FROM pantry_items WHERE id = ${it1.id}`;
    expect(raw.initial_quantity_base).toBe(750);
    expect(await events(it1.id)).toEqual([{ kind: 'add', delta_base: 750 }]);
  });

  it('keeps a GTIN only when it exists in the products cache (FK)', async () => {
    const u = await makeUser();
    const prefix = `2${String(Date.now()).slice(-11)}`; // GS1 prefix 2: in-store codes, never real products
    const body = prefix + gs1CheckDigit(prefix);
    createdGtins.push(body);
    await tsql`INSERT INTO products (gtin, name, source) VALUES (${body}, 'Test product', 'openfoodfacts')`;
    const known = await createPantryItem(u, TZ, item({ gtin: body, source: 'openfoodfacts' }));
    expect(known.gtin).toBe(body);
    const unknown = await createPantryItem(u, TZ, item({ gtin: '4006381333931', source: 'gemini_photo' }));
    expect(unknown.gtin).toBeNull();
  });

  it('records photo expiry with raw text (F4 AC5)', async () => {
    const u = await makeUser();
    const date = addDays(todayInTz(TZ), 5);
    const x = await createPantryItem(u, TZ, item({ expiryDate: date, expirySource: 'photo', expiryRawText: 'BB/MA 2026 NO 15' }));
    expect(x).toMatchObject({ expiryDate: date, expirySource: 'photo', daysToExpiry: 5 });
    const [raw] = await tsql<{ expiry_raw_text: string }[]>`SELECT expiry_raw_text FROM pantry_items WHERE id = ${x.id}`;
    expect(raw.expiry_raw_text).toBe('BB/MA 2026 NO 15');
  });
});

describe('listPantry', () => {
  it('orders by expiry ASC NULLS LAST and hides empty items unless asked (F5 AC1)', async () => {
    const u = await makeUser();
    const today = todayInTz(TZ);
    const none = await createPantryItem(u, TZ, item({ name: 'Rice' }));
    const ten = await createPantryItem(u, TZ, item({ name: 'Carrots', expiryDate: addDays(today, 10), expirySource: 'manual' }));
    const two = await createPantryItem(u, TZ, item({ name: 'Spinach', expiryDate: addDays(today, 2), expirySource: 'manual' }));
    const todayItem = await createPantryItem(u, TZ, item({ name: 'Milk', expiryDate: today, expirySource: 'manual' }));
    await updatePantryItem(u, none.id, TZ, { adjustReason: 'discard' });

    const listed = await listPantry(u, TZ, { sort: 'expiry', includeEmpty: false });
    expect(listed.map((i) => i.name)).toEqual(['Milk', 'Spinach', 'Carrots']);
    expect(listed.map((i) => i.daysToExpiry)).toEqual([0, 2, 10]); // F5 AC3: today = 0
    expect(listed.find((i) => i.id === todayItem.id)?.daysToExpiry).toBe(0);

    const all = await listPantry(u, TZ, { sort: 'expiry', includeEmpty: true });
    expect(all.map((i) => i.id)).toEqual([todayItem.id, two.id, ten.id, none.id]);

    const byName = await listPantry(u, TZ, { sort: 'name', includeEmpty: true });
    expect(byName.map((i) => i.name)).toEqual(['Carrots', 'Milk', 'Rice', 'Spinach']);
  });
});

describe('updatePantryItem', () => {
  it('adjusting 400 g → 250 g writes manual_adjust delta -150 (F5 AC2)', async () => {
    const u = await makeUser();
    const x = await createPantryItem(u, TZ, item({ quantity: 400 }));
    const y = await updatePantryItem(u, x.id, TZ, { quantity: 250 });
    expect(y.quantityBase).toBe(250);
    expect(await events(x.id)).toEqual([
      { kind: 'add', delta_base: 400 },
      { kind: 'manual_adjust', delta_base: -150 },
    ]);
  });

  it('discard sets quantity 0 and logs discard; editing other fields logs nothing', async () => {
    const u = await makeUser();
    const x = await createPantryItem(u, TZ, item({ quantity: 250 }));
    await updatePantryItem(u, x.id, TZ, { name: 'Plain Greek Yogurt', brand: null });
    const d = await updatePantryItem(u, x.id, TZ, { adjustReason: 'discard' });
    expect(d.quantityBase).toBe(0);
    expect(d.normalizedName).toBe('plain greek yogurt');
    expect(await events(x.id)).toEqual([
      { kind: 'add', delta_base: 250 },
      { kind: 'discard', delta_base: -250 },
    ]);
  });

  it('changes the display unit within a dimension and rejects another dimension', async () => {
    const u = await makeUser();
    const x = await createPantryItem(u, TZ, item({ quantity: 1, displayUnit: 'kg' }));
    const y = await updatePantryItem(u, x.id, TZ, { displayUnit: 'g' });
    expect(y).toMatchObject({ quantityBase: 1000, displayUnit: 'g' });
    await expect(updatePantryItem(u, x.id, TZ, { displayUnit: 'ml' })).rejects.toBeInstanceOf(UnprocessableError);
  });

  it('clearing the expiry clears source and raw text together', async () => {
    const u = await makeUser();
    const x = await createPantryItem(u, TZ, item({ expiryDate: addDays(todayInTz(TZ), 3), expirySource: 'photo', expiryRawText: 'NO 11' }));
    const y = await updatePantryItem(u, x.id, TZ, { expiryDate: null, expirySource: null });
    expect(y).toMatchObject({ expiryDate: null, expirySource: null, daysToExpiry: null });
  });
});

describe('quantity limits and precision', () => {
  it('rejects a quantity that overflows the column as a validation error', async () => {
    const u = await makeUser();
    await expect(createPantryItem(u, TZ, item({ quantity: 2_000_000, displayUnit: 'kg' }))).rejects.toBeInstanceOf(UnprocessableError);
  });

  it('logs nothing when a unit round trip only adds floating-point noise', async () => {
    const u = await makeUser();
    const x = await createPantryItem(u, TZ, item({ quantity: 100, displayUnit: 'g' }));
    await updatePantryItem(u, x.id, TZ, { quantity: 100.0000001, displayUnit: 'g' });
    expect(await events(x.id)).toEqual([{ kind: 'add', delta_base: 100 }]);
  });
});

describe('restockPantryItem', () => {
  it('refills an empty row to its initial quantity, clears expiry, logs add', async () => {
    const u = await makeUser();
    const x = await createPantryItem(u, TZ, item({ quantity: 500, expiryDate: addDays(todayInTz(TZ), 1), expirySource: 'manual' }));
    await expect(restockPantryItem(u, x.id, TZ)).rejects.toBeInstanceOf(ConflictError);
    await updatePantryItem(u, x.id, TZ, { quantity: 120 });
    await updatePantryItem(u, x.id, TZ, { adjustReason: 'discard' });
    const r = await restockPantryItem(u, x.id, TZ);
    expect(r).toMatchObject({ quantityBase: 500, expiryDate: null, expirySource: null });
    expect((await events(x.id)).map((e) => [e.kind, e.delta_base])).toEqual([
      ['add', 500],
      ['manual_adjust', -380],
      ['discard', -120],
      ['add', 500],
    ]);
  });
});

describe('isolation (F1 AC3)', () => {
  it("user A never sees or changes user B's items (404)", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const bItem = await createPantryItem(b, TZ, item({ name: 'B only' }));
    expect((await listPantry(a, TZ, { sort: 'expiry', includeEmpty: true })).some((i) => i.id === bItem.id)).toBe(false);
    await expect(getPantryItemForUser(a, bItem.id, TZ)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updatePantryItem(a, bItem.id, TZ, { quantity: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(restockPantryItem(a, bItem.id, TZ)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deletePantryItem(a, bItem.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getPantryItemForUser(b, bItem.id, TZ)).quantityBase).toBe(400);
  });
});

describe('deletePantryItem (F5 AC4)', () => {
  it('keeps meal logs and events, nulling their pantry_item_id', async () => {
    const u = await makeUser();
    const x = await createPantryItem(u, TZ, item());
    const [meal] = await tsql<{ id: string }[]>`
      INSERT INTO meal_logs (user_id, local_date, source, pantry_item_id, label, kcal, protein_g)
      VALUES (${u}, ${todayInTz(TZ)}, 'pantry_item', ${x.id}, 'Yogurt', 100, 17) RETURNING id`;
    await deletePantryItem(u, x.id);
    const [m] = await tsql<{ pantry_item_id: string | null }[]>`SELECT pantry_item_id FROM meal_logs WHERE id = ${meal.id}`;
    expect(m.pantry_item_id).toBeNull();
    const [{ n }] = await tsql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pantry_events WHERE user_id = ${u} AND pantry_item_id IS NULL`;
    expect(n).toBe(1);
  });
});

describe('profile', () => {
  it('defaults, onboarding, settings and grace bounds', async () => {
    const u = await makeUser();
    expect(await getProfile(u)).toMatchObject({
      tz: TZ, diets: [], allergens: [], onboarded: false, dailyKcalGoal: null, dailyProteinGoalG: null, pastBestBeforeGraceDays: 0,
    });
    const p = await updateProfile(u, {
      diets: ['vegetarian', 'gluten_free'], allergens: ['peanut'], dailyKcalGoal: 2100, dailyProteinGoalG: 120.5,
      tz: 'America/Toronto', completeOnboarding: true,
    });
    expect(p).toMatchObject({ diets: ['vegetarian', 'gluten_free'], allergens: ['peanut'], dailyKcalGoal: 2100, dailyProteinGoalG: 120.5, tz: 'America/Toronto', onboarded: true });
    const [{ at }] = await tsql<{ at: Date }[]>`SELECT onboarded_at AS at FROM users WHERE id = ${u}`;
    const again = await updateProfile(u, { completeOnboarding: true, pastBestBeforeGraceDays: 3, dailyKcalGoal: null });
    expect(again).toMatchObject({ pastBestBeforeGraceDays: 3, dailyKcalGoal: null, onboarded: true });
    const [{ at: at2 }] = await tsql<{ at: Date }[]>`SELECT onboarded_at AS at FROM users WHERE id = ${u}`;
    expect(at2.getTime()).toBe(at.getTime()); // first onboarding time is kept
    await expect(tsql`UPDATE users SET past_best_before_grace_days = 15 WHERE id = ${u}`).rejects.toThrow();
  });

  it('delete my data cascades to pantry, events and meals', async () => {
    const u = await makeUser();
    await createPantryItem(u, TZ, item());
    await tsql`INSERT INTO meal_logs (user_id, local_date, source, label, kcal) VALUES (${u}, ${todayInTz(TZ)}, 'manual', 'Snack', 120)`;
    await deleteUserData(u);
    const [c] = await tsql<{ users: number; pantry: number; events: number; meals: number }[]>`
      SELECT (SELECT count(*) FROM users WHERE id = ${u})::int AS users,
             (SELECT count(*) FROM pantry_items WHERE user_id = ${u})::int AS pantry,
             (SELECT count(*) FROM pantry_events WHERE user_id = ${u})::int AS events,
             (SELECT count(*) FROM meal_logs WHERE user_id = ${u})::int AS meals`;
    expect(c).toEqual({ users: 0, pantry: 0, events: 0, meals: 0 });
    await expect(deleteUserData(u)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProfile(u)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete my data removes materialized daily_nutrition older than the refresh window', async () => {
    const u = await makeUser();
    const old = new Date(Date.now() - 60 * 86_400_000);
    await tsql`INSERT INTO meal_logs (eaten_at, user_id, local_date, source, label, kcal) VALUES (${old.toISOString()}, ${u}, ${old.toISOString().slice(0, 10)}, 'manual', 'Old snack', 120)`;
    const from = new Date(old.getTime() - 2 * 86_400_000).toISOString();
    const to = new Date(old.getTime() + 2 * 86_400_000).toISOString();
    await tsql`CALL refresh_continuous_aggregate('daily_nutrition', ${from}::timestamptz, ${to}::timestamptz)`;
    const count = async () => (await tsql<{ n: number }[]>`SELECT count(*)::int AS n FROM daily_nutrition WHERE user_id = ${u}`)[0].n;
    expect(await count()).toBe(1);
    await deleteUserData(u);
    expect(await count()).toBe(0);
  });

  it('delete my data works for a user who has cooked (session-linked meals and events)', async () => {
    const u = await makeUser();
    const pantryItem = await createPantryItem(u, TZ, item());
    const [recipe] = await tsql<{ id: string }[]>`
      INSERT INTO recipes (user_id, url_hash, source_url, site_name, title, extraction_method)
      VALUES (${u}, ${`test-${uid()}`}, ${`https://example.test/${uid()}`}, 'example', 'Soup', 'jsonld') RETURNING id`;
    const [original] = await tsql<{ id: string }[]>`
      INSERT INTO recipe_variants (recipe_id, kind, servings, ingredients, steps)
      VALUES (${recipe.id}, 'original', 1, ${tsql.json([])}, ${tsql.json([])}) RETURNING id`;
    const [adapted] = await tsql<{ id: string }[]>`
      INSERT INTO recipe_variants (recipe_id, parent_variant_id, kind, servings, ingredients, steps)
      VALUES (${recipe.id}, ${original.id}, 'ai_adapted', 1, ${tsql.json([])}, ${tsql.json([])}) RETURNING id`;
    const [session] = await tsql<{ id: string }[]>`
      INSERT INTO cooking_sessions (user_id, recipe_variant_id, status, servings_planned, finished_at)
      VALUES (${u}, ${adapted.id}, 'finished', 1, now()) RETURNING id`;
    await tsql`
      INSERT INTO meal_logs (user_id, local_date, source, cooking_session_id, recipe_variant_id, label, kcal)
      VALUES (${u}, ${todayInTz(TZ)}, 'cooking_session', ${session.id}, ${adapted.id}, 'Soup', 300)`;
    await tsql`
      INSERT INTO pantry_events (user_id, pantry_item_id, kind, delta_base, cooking_session_id)
      VALUES (${u}, ${pantryItem.id}, 'cook_deduct', -100, ${session.id})`;

    await deleteUserData(u);

    const [c] = await tsql<{ users: number; recipes: number; variants: number; sessions: number; meals: number; events: number }[]>`
      SELECT (SELECT count(*) FROM users WHERE id = ${u})::int AS users,
             (SELECT count(*) FROM recipes WHERE user_id = ${u})::int AS recipes,
             (SELECT count(*) FROM recipe_variants WHERE recipe_id = ${recipe.id})::int AS variants,
             (SELECT count(*) FROM cooking_sessions WHERE user_id = ${u})::int AS sessions,
             (SELECT count(*) FROM meal_logs WHERE user_id = ${u})::int AS meals,
             (SELECT count(*) FROM pantry_events WHERE user_id = ${u})::int AS events`;
    expect(c).toEqual({ users: 0, recipes: 0, variants: 0, sessions: 0, meals: 0, events: 0 });
  });
});
