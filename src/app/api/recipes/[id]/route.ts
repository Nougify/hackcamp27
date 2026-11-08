import { requireUser } from '@/lib/current-user';
import { handleRouteError, isUuid, jsonError, jsonOk } from '@/lib/http';
import { checkDiet } from '@/server/diet/check';
import { estimateRecipeNutrition } from '@/server/nutrition/recipe';
import { matchIngredients } from '@/server/recipes/match';
import { computeScores } from '@/server/recipes/score';
import { getRecipeDetail } from '@/server/recipes/store';
import { getProfileFilters, listPantryForMatching } from '@/server/recipes/pantry-view';
import type { RecipeDetailResponse } from '@/contracts/api';
import type { Allergen, DietFlag, NutritionEstimate } from '@/contracts/domain';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

    const { original } = detail;
    const matches = matchIngredients(original.ingredients, pantry);
    const dietCheck = checkDiet(
      original.ingredients.map((ing) => ({ raw: ing.raw, normalizedName: ing.normalizedName })),
      { diets, allergens },
    );
    const estimate = estimateRecipeNutrition({
      ingredients: original.ingredients,
      matches,
      pantryById,
      servings: original.servings,
    });
    const [score] = computeScores(
      [{ ingredients: original.ingredients, matches, proteinPerServingG: estimate.perServing.proteinG }],
      { highProtein: diets.includes('high_protein') },
    );

    const adaptationNutrition: Record<string, NutritionEstimate> = {};
    for (const adaptation of detail.adaptations) {
      const parsed = adaptation.ingredients.map((i) => i.parsed);
      const m = matchIngredients(parsed, pantry);
      adaptationNutrition[adaptation.variantId] = estimateRecipeNutrition({
        ingredients: parsed,
        matches: m,
        pantryById,
        servings: original.servings,
      });
    }

    const body: RecipeDetailResponse = {
      original,
      adaptations: detail.adaptations,
      matches,
      score: score!,
      dietCheck,
      nutrition: { estimate, publisher: detail.recipe.publisher_nutrition },
      adaptationNutrition,
    };
    return jsonOk(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
