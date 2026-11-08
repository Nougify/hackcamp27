import 'server-only';
import sql from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { estimateRecipeNutrition, suggestLogPerServing } from '@/server/nutrition/recipe';
import { matchIngredients } from '@/server/recipes/match';
import type { FinishRequest, FinishResult } from '@/contracts/api';
import type { CookingSession, MealLog, Nutrients, RecipeIngredient, RecipeStep, Substitution } from '@/contracts/domain';

interface SessionRow {
  id: string;
  recipe_variant_id: string;
  status: CookingSession['status'];
  current_step: number;
  servings_planned: string | number;
  servings_cooked: string | number | null;
  servings_eaten: string | number | null;
  started_at: Date;
  finished_at: Date | null;
}

function localDateInTz(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Finish-cooking transaction (F14): one DB transaction that (1) marks the
 * session finished with an idempotency guard, (2) deducts confirmed pantry
 * lines with clamping, and (3) inserts a meal-log snapshot.
 */
export async function finishSession(userId: string, sessionId: string, input: FinishRequest): Promise<FinishResult> {
  for (const d of input.deductions) {
    if (!Number.isFinite(d.qtyBase) || d.qtyBase < 0) {
      throw new ConflictError('Deduction quantities must be non-negative numbers');
    }
  }

  return sql.begin(async (tx) => {
    // Ownership pre-check: another user's session (or a missing one) is a 404,
    // so only genuine replays of our own session reach the 409 guard below.
    const owned = await tx<Array<{ id: string }>>`
      SELECT id FROM cooking_sessions WHERE id = ${sessionId} AND user_id = ${userId} LIMIT 1
    `;
    if (!owned[0]) throw new NotFoundError('Cooking session not found');

    const updated = await tx<SessionRow[]>`
      UPDATE cooking_sessions
      SET status = 'finished', finished_at = now(),
          servings_cooked = ${input.servingsCooked}, servings_eaten = ${input.servingsEaten}
      WHERE id = ${sessionId} AND user_id = ${userId} AND status = 'in_progress'
      RETURNING id, recipe_variant_id, status, current_step, servings_planned, servings_cooked, servings_eaten, started_at, finished_at
    `;
    const session = updated[0];
    if (!session) throw new ConflictError('Session is not in progress (already finished or abandoned)');

    const variants = await tx<
      Array<{ id: string; recipe_id: string; kind: 'original' | 'ai_adapted'; servings: string | number; ingredients: unknown; steps: unknown; substitutions: unknown }>
    >`SELECT id, recipe_id, kind, servings, ingredients, steps, substitutions FROM recipe_variants WHERE id = ${session.recipe_variant_id} LIMIT 1`;
    const variant = variants[0];
    if (!variant) throw new NotFoundError('Recipe variant not found');
    const recipes = await tx<
      Array<{ id: string; title: string; publisher_nutrition: Nutrients | null }>
    >`SELECT id, title, publisher_nutrition FROM recipes WHERE id = ${variant.recipe_id} AND user_id = ${userId} LIMIT 1`;
    const recipe = recipes[0];
    if (!recipe) throw new NotFoundError('Recipe not found');

    const parsed: RecipeIngredient[] =
      variant.kind === 'original'
        ? ((variant.ingredients as RecipeIngredient[]) ?? [])
        : (((variant.ingredients as Array<{ parsed: RecipeIngredient }>) ?? []).map((i) => i.parsed));

    const pantryRows = await tx<
      Array<{
        id: string;
        name: string;
        normalized_name: string;
        dim: 'mass' | 'volume' | 'count';
        quantity_base: string | number;
        display_unit: string;
        grams_per_unit: string | number | null;
        density_g_per_ml: string | number | null;
        expiry_date: string | Date | null;
        nutrition_basis: '100g' | '100ml' | 'unit';
        kcal_per_basis: string | number | null;
        protein_g_per_basis: string | number | null;
        carbs_g_per_basis: string | number | null;
        fat_g_per_basis: string | number | null;
      }>
    >`SELECT id, name, normalized_name, dim, quantity_base, display_unit, grams_per_unit, density_g_per_ml,
       expiry_date, nutrition_basis, kcal_per_basis, protein_g_per_basis, carbs_g_per_basis, fat_g_per_basis
       FROM pantry_items WHERE user_id = ${userId}`;

    const pantry = pantryRows.map((r) => ({
      id: r.id,
      gtin: null,
      name: r.name,
      normalizedName: r.normalized_name,
      brand: null,
      dim: r.dim,
      quantityBase: Number(r.quantity_base),
      displayUnit: r.display_unit as 'g',
      quantityDisplay: '',
      gramsPerUnit: r.grams_per_unit == null ? null : Number(r.grams_per_unit),
      densityGPerMl: r.density_g_per_ml == null ? null : Number(r.density_g_per_ml),
      expiryDate: null,
      expirySource: null,
      daysToExpiry: null,
      nutritionBasis: r.nutrition_basis,
      nutrition: {
        energyKcal: r.kcal_per_basis == null ? null : Number(r.kcal_per_basis),
        proteinG: r.protein_g_per_basis == null ? null : Number(r.protein_g_per_basis),
        carbohydrateG: r.carbs_g_per_basis == null ? null : Number(r.carbs_g_per_basis),
        fatG: r.fat_g_per_basis == null ? null : Number(r.fat_g_per_basis),
      },
      perServing: null,
      servingSizeBase: null,
      allergenTags: [],
      source: 'manual' as const,
      userVerified: true,
      updatedAt: new Date().toISOString(),
    }));
    const pantryById = new Map(pantry.map((p) => [p.id, p]));

    const matches = matchIngredients(parsed, pantry);
    const estimate = estimateRecipeNutrition({
      ingredients: parsed,
      matches,
      pantryById,
      servings: Number(variants[0]!.servings),
    });
    const suggested = suggestLogPerServing(estimate, recipe.publisher_nutrition);
    const perServing = input.perServingOverride ?? { kcal: suggested.kcal, proteinG: suggested.proteinG };

    const pantryUpdates: FinishResult['pantryUpdates'] = [];
    for (const d of input.deductions) {
      const locked = await tx<Array<{ id: string; name: string; quantity_base: string | number }>>`
        SELECT id, name, quantity_base FROM pantry_items
        WHERE id = ${d.pantryItemId} AND user_id = ${userId} LIMIT 1 FOR UPDATE
      `;
      const row = locked[0];
      if (!row) throw new NotFoundError('Pantry item not found');
      const before = Number(row.quantity_base);
      const take = Math.min(before, d.qtyBase);
      const after = before - take;
      await tx`UPDATE pantry_items SET quantity_base = ${after}, updated_at = now() WHERE id = ${row.id}`;
      await tx`
        INSERT INTO pantry_events (user_id, pantry_item_id, kind, delta_base, cooking_session_id)
        VALUES (${userId}, ${row.id}, 'cook_deduct', ${-take}, ${sessionId})
      `;
      pantryUpdates.push({ pantryItemId: row.id, name: row.name, beforeBase: before, afterBase: after });
    }

    let mealLog: MealLog | null = null;
    if (input.servingsEaten > 0) {
      const users = await tx<Array<{ tz: string }>>`SELECT tz FROM users WHERE id = ${userId} LIMIT 1`;
      const eatenAt = new Date();
      const inserted = await tx<Array<{ id: string; eaten_at: Date }>>`
        INSERT INTO meal_logs (user_id, local_date, source, cooking_session_id, recipe_variant_id, label, servings, kcal, protein_g, carbs_g, fat_g)
        VALUES (
          ${userId}, ${localDateInTz(users[0]?.tz ?? 'America/Vancouver', eatenAt)}, 'cooking_session',
          ${sessionId}, ${session.recipe_variant_id}, ${recipe.title}, ${input.servingsEaten},
          ${perServing.kcal * input.servingsEaten}, ${perServing.proteinG * input.servingsEaten}, NULL, NULL
        )
        RETURNING id, eaten_at
      `;
      const logRow = inserted[0]!;
      mealLog = {
        id: logRow.id,
        eatenAt: logRow.eaten_at.toISOString(),
        localDate: localDateInTz(users[0]?.tz ?? 'America/Vancouver', eatenAt),
        source: 'cooking_session',
        label: recipe.title,
        servings: input.servingsEaten,
        kcal: perServing.kcal * input.servingsEaten,
        proteinG: perServing.proteinG * input.servingsEaten,
        carbsG: null,
        fatG: null,
        cookingSessionId: sessionId,
        pantryItemId: null,
      };
    }

    return {
      session: {
        id: session.id,
        recipeId: recipe.id,
        variantId: session.recipe_variant_id,
        variantKind: variants[0]!.kind,
        status: session.status,
        currentStep: session.current_step,
        servingsPlanned: Number(session.servings_planned),
        startedAt: session.started_at.toISOString(),
        finishedAt: session.finished_at ? session.finished_at.toISOString() : null,
      },
      pantryUpdates,
      mealLog,
    };
  });
}

export type { RecipeStep, Substitution };
