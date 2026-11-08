import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { ConflictError } from '@/lib/errors';
import { finishSession } from './finish';
import { getRecipeDetail } from '@/server/recipes/store';

// These tests run against DATABASE_URL_TEST (a Tiger fork) via `npm run test:db`.
// They fail fast — not silently skip — when the test database is not configured.
const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL) {
  throw new Error('DATABASE_URL_TEST is required for db tests (npm run test:db against a Tiger fork).');
}
const tsql = postgres(TEST_URL, { max: 2, ssl: 'require' });

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

async function makeUser() {
  const rows = await tsql<Array<{ id: string }>>`
    INSERT INTO users (auth0_sub, tz) VALUES (${`test|${uid()}`}, 'America/Vancouver') RETURNING id
  `;
  return rows[0]!.id;
}

async function makePantry(userId: string, qtyBase: number) {
  const rows = await tsql<Array<{ id: string }>>`
    INSERT INTO pantry_items (user_id, name, normalized_name, dim, quantity_base, display_unit, expiry_date, expiry_source, nutrition_basis, kcal_per_basis, protein_g_per_basis)
    VALUES (${userId}, 'Spinach, baby', 'spinach', 'mass', ${qtyBase}, 'g', CURRENT_DATE + 1, 'manual', '100g', 23, 2.9)
    RETURNING id
  `;
  return rows[0]!.id;
}

async function makeRecipeWithSpinach(userId: string, needBase: number) {
  const ingredients = JSON.stringify([
    { raw: `${needBase} g spinach`, qty: needBase, unit: 'g', name: 'spinach', normalizedName: 'spinach', dim: 'mass', qtyBase: needBase, isStaple: false, flags: [] },
  ]);
  const steps = JSON.stringify([{ index: 0, text: 'Wilt the spinach.', timerSeconds: null }]);
  const recipes = await tsql<Array<{ id: string }>>`
    INSERT INTO recipes (user_id, url_hash, source_url, site_name, title, extraction_method)
    VALUES (${userId}, ${`test-${uid()}`}, ${`https://example.test/${uid()}`}, 'example', 'Spinach', 'jsonld')
    RETURNING id
  `;
  const recipeId = recipes[0]!.id;
  const variants = await tsql<Array<{ id: string }>>`
    INSERT INTO recipe_variants (recipe_id, kind, servings, ingredients, steps)
    VALUES (${recipeId}, 'original', 1, ${ingredients}, ${steps})
    RETURNING id
  `;
  return { recipeId, variantId: variants[0]!.id };
}

async function makeSession(userId: string, variantId: string) {
  const rows = await tsql<Array<{ id: string }>>`
    INSERT INTO cooking_sessions (user_id, recipe_variant_id, servings_planned)
    VALUES (${userId}, ${variantId}, 1) RETURNING id
  `;
  return rows[0]!.id;
}

const usersToClean: string[] = [];
async function fixture(pantryQty = 200, needBase = 150) {
  const userId = await makeUser();
  usersToClean.push(userId);
  const pantryItemId = await makePantry(userId, pantryQty);
  const { recipeId, variantId } = await makeRecipeWithSpinach(userId, needBase);
  const sessionId = await makeSession(userId, variantId);
  return { userId, pantryItemId, recipeId, variantId, sessionId };
}

beforeAll(async () => {
  // §14.3 test 1: migrations applied — hypertables and the cagg exist.
  const hypertables = await tsql<Array<{ hypertable_name: string }>>`
    SELECT hypertable_name FROM timescaledb_information.hypertables
  `;
  const names = hypertables.map((h) => h.hypertable_name);
  expect(names).toContain('meal_logs');
  expect(names).toContain('pantry_events');
  const caggs = await tsql<Array<{ view_name: string }>>`
    SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name = 'daily_nutrition'
  `;
  expect(caggs).toHaveLength(1);
});

afterAll(async () => {
  if (usersToClean.length > 0) {
    await tsql`DELETE FROM users WHERE id = ANY(${usersToClean})`;
  }
  await tsql.end();
});

describe('finishSession transaction (F14)', () => {
  it('AC1: deducts, logs pantry event and meal log', async () => {
    const f = await fixture(200, 150);
    const out = await finishSession(f.userId, f.sessionId, {
      servingsCooked: 1,
      servingsEaten: 1,
      deductions: [{ pantryItemId: f.pantryItemId, qtyBase: 150 }],
    });

    expect(out.session.status).toBe('finished');
    expect(out.pantryUpdates).toEqual([{ pantryItemId: f.pantryItemId, name: 'Spinach, baby', beforeBase: 200, afterBase: 50 }]);
    expect(out.mealLog).toMatchObject({ source: 'cooking_session', cookingSessionId: f.sessionId });

    const events = await tsql<Array<{ delta_base: string }>>`
      SELECT delta_base FROM pantry_events WHERE cooking_session_id = ${f.sessionId}
    `;
    expect(events).toHaveLength(1);
    expect(Number(events[0]!.delta_base)).toBe(-150);
  });

  it('AC2: replaying finish returns 409 and deducts once', async () => {
    const f = await fixture(200, 150);
    const first = { servingsCooked: 1, servingsEaten: 1, deductions: [{ pantryItemId: f.pantryItemId, qtyBase: 150 }] };
    await finishSession(f.userId, f.sessionId, first);
    await expect(finishSession(f.userId, f.sessionId, first)).rejects.toBeInstanceOf(ConflictError);

    const rows = await tsql<Array<{ quantity_base: string }>>`
      SELECT quantity_base FROM pantry_items WHERE id = ${f.pantryItemId}
    `;
    expect(Number(rows[0]!.quantity_base)).toBe(50); // deducted exactly once
  });

  it('AC3: servingsEaten=0 deducts the pantry and creates no meal log', async () => {
    const f = await fixture(200, 150);
    const out = await finishSession(f.userId, f.sessionId, {
      servingsCooked: 1,
      servingsEaten: 0,
      deductions: [{ pantryItemId: f.pantryItemId, qtyBase: 150 }],
    });
    expect(out.mealLog).toBeNull();
    expect(out.pantryUpdates[0]?.afterBase).toBe(50);
  });

  it('AC5: a mid-request failure writes nothing (rollback)', async () => {
    const f = await fixture(200, 150);
    // Simulate the pantry row disappearing mid-request.
    await tsql`DELETE FROM pantry_items WHERE id = ${f.pantryItemId}`;
    await expect(
      finishSession(f.userId, f.sessionId, {
        servingsCooked: 1,
        servingsEaten: 1,
        deductions: [{ pantryItemId: f.pantryItemId, qtyBase: 150 }],
      }),
    ).rejects.toThrow();

    const sessions = await tsql<Array<{ status: string }>>`
      SELECT status FROM cooking_sessions WHERE id = ${f.sessionId}
    `;
    expect(sessions[0]?.status).toBe('in_progress'); // guard update rolled back
    const logs = await tsql<Array<{ id: string }>>`
      SELECT id FROM meal_logs WHERE cooking_session_id = ${f.sessionId}
    `;
    expect(logs).toHaveLength(0);
  });

  it('clamps deductions at zero instead of failing', async () => {
    const f = await fixture(100, 150);
    const out = await finishSession(f.userId, f.sessionId, {
      servingsCooked: 1,
      servingsEaten: 0,
      deductions: [{ pantryItemId: f.pantryItemId, qtyBase: 150 }],
    });
    expect(out.pantryUpdates[0]).toMatchObject({ beforeBase: 100, afterBase: 0 });
  });
});

describe('isolation (§14.3 test 3, C endpoints)', () => {
  it("user B cannot read or finish user A's recipe/session", async () => {
    const a = await fixture();
    const bId = await makeUser();
    usersToClean.push(bId);

    await expect(getRecipeDetail(bId, a.recipeId)).resolves.toBeNull();
    await expect(
      finishSession(bId, a.sessionId, { servingsCooked: 1, servingsEaten: 0, deductions: [] }),
    ).rejects.toThrow('not found');
  });
});
