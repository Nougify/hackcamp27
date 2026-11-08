import { requireUser } from '@/lib/current-user';
import { checkRateLimit } from '@/lib/rate-limit';
import { ConflictError, RateLimitedError } from '@/lib/errors';
import { handleRouteError, isUuid, jsonError, jsonOk } from '@/lib/http';
import { estimateRecipeNutrition } from '@/server/nutrition/recipe';
import { matchIngredients } from '@/server/recipes/match';
import { findMatchingAdaptation, getRecipeDetail, insertAdaptation } from '@/server/recipes/store';
import { adaptationStillAllowed, requestAdaptation } from '@/server/recipes/adapt';
import { getProfileFilters, listPantryForMatching } from '@/server/recipes/pantry-view';
import type { AdaptResponse } from '@/contracts/api';
import type { Allergen, DietFlag } from '@/contracts/domain';

export const runtime = 'nodejs';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();

    const { id } = await ctx.params;
    if (!isUuid(id)) return jsonError('NOT_FOUND', 'Recipe not found');
    const detail = await getRecipeDetail(user.id, id);
    if (!detail) return jsonError('NOT_FOUND', 'Recipe not found');

    const profile = await getProfileFilters(user.id);
    const diets = profile.diets as DietFlag[];
    const allergens = profile.allergens as Allergen[];
    const pantry = await listPantryForMatching(user.id, profile.tz, new Date(), 200, profile.pastBestBeforeGraceDays);
    const pantryById = new Map(pantry.map((p) => [p.id, p]));

    const matches = matchIngredients(detail.original.ingredients, pantry);
    const missing = matches.filter((m) => m.status === 'missing' || m.status === 'insufficient');
    if (missing.length === 0) throw new ConflictError('Nothing to adapt — you have every ingredient.');

    const missingRaws = missing.map((m) => detail.original.ingredients[m.ingredientIndex]!.raw);

    // Cached variant covering the same missing set (F9 step 5).
    const cached = findMatchingAdaptation(detail.adaptations, missingRaws);
    if (cached && adaptationStillAllowed(cached, { diets, allergens })) {
      const parsed = cached.ingredients.map((i) => i.parsed);
      const nutrition = estimateRecipeNutrition({
        ingredients: parsed,
        matches: matchIngredients(parsed, pantry),
        pantryById,
        servings: detail.original.servings,
      });
      const body: AdaptResponse = { adaptation: cached, nutrition };
      return jsonOk(body);
    }

    // Only a real Gemini call spends a token (not 404s, 409s or cached adaptations).
    const limit = checkRateLimit(user.id, 'recipes/adapt');
    if (!limit.ok) throw new RateLimitedError('Too many adaptations', limit.retryAfterMs);
    const built = await requestAdaptation(detail.original, missingRaws, pantry, { diets, allergens });
    const parsed = built.ingredients.map((i) => i.parsed);
    const nutrition = estimateRecipeNutrition({
      ingredients: parsed,
      matches: matchIngredients(parsed, pantry),
      pantryById,
      servings: detail.original.servings,
    });
    const adaptation = await insertAdaptation(user.id, id, detail.original.variantId, { ...built, nutrition });

    const body: AdaptResponse = { adaptation, nutrition };
    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
