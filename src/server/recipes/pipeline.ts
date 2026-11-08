import 'server-only';
import { checkDiet } from '@/server/diet/check';
import { estimateRecipeNutrition } from '@/server/nutrition/recipe';
import type {
  Allergen,
  DietCheck,
  DietFlag,
  NutritionEstimate,
  PantryItem,
  PantryMatch,
  RecipeIngredient,
  RecipeStep,
} from '@/contracts/domain';
import type { ExtractedRecipe } from './extract';
import { parseTimerSeconds } from './extract';
import { applyNormalizedLines, normalizeWithGemini, parseRecipeIngredients, type NormalizedLine } from './parse';
import { matchIngredientsSmart } from './base-names';

export interface PipelineContext {
  pantry: PantryItem[];
  diets: DietFlag[];
  allergens: Allergen[];
}

export type PipelineOutcome =
  | {
      kind: 'candidate';
      ingredients: RecipeIngredient[];
      steps: RecipeStep[];
      matches: PantryMatch[];
      dietCheck: DietCheck;
      nutrition: NutritionEstimate;
      usesExpiring: Array<{ pantryItemId: string; name: string; daysToExpiry: number }>;
    }
  | { kind: 'excluded'; reason: 'diet_violation' | 'allergen'; detail: string };

export interface PipelineDeps {
  normalize?: (raws: string[]) => Promise<Map<string, NormalizedLine>>;
}

/**
 * Parse → normalize (Gemini fallback) → diet check → match → nutrition
 * (F6 steps 6–8, minus scoring, which needs protein first).
 */
export async function processExtracted(
  extracted: ExtractedRecipe,
  ctx: PipelineContext,
  deps: PipelineDeps = {},
): Promise<PipelineOutcome> {
  let ingredients = parseRecipeIngredients(extracted.ingredients);

  const failed = ingredients.filter((ing) => ing.flags.includes('parse_failed')).map((ing) => ing.raw);
  if (failed.length > 0) {
    try {
      const normalize = deps.normalize ?? normalizeWithGemini;
      ingredients = applyNormalizedLines(ingredients, await normalize(failed));
    } catch {
      // Normalization is best-effort; unparsed lines stay matchable by raw text.
    }
  }

  const dietCheck = checkDiet(
    ingredients.map((ing) => ({ raw: ing.raw, normalizedName: ing.normalizedName })),
    { diets: ctx.diets, allergens: ctx.allergens },
  );
  if (!dietCheck.ok) {
    const allergenHit = dietCheck.violations.some((v) => (ctx.allergens as string[]).includes(v.rule));
    const first = dietCheck.violations[0]!;
    return {
      kind: 'excluded',
      reason: allergenHit ? 'allergen' : 'diet_violation',
      detail: `"${first.matchedKeyword}" in "${first.ingredientRaw.slice(0, 80)}" violates ${first.rule}`,
    };
  }

  const matches = await matchIngredientsSmart(ingredients, ctx.pantry);
  const nutrition = estimateRecipeNutrition({
    ingredients,
    matches,
    pantryById: new Map(ctx.pantry.map((p) => [p.id, p])),
    servings: extracted.servings,
  });

  const seen = new Set<string>();
  const usesExpiring: Array<{ pantryItemId: string; name: string; daysToExpiry: number }> = [];
  for (const m of matches) {
    if (
      (m.status === 'have' || m.status === 'insufficient') &&
      m.pantryItemId &&
      m.pantryItemName &&
      m.daysToExpiry != null &&
      m.daysToExpiry <= 3 &&
      !seen.has(m.pantryItemId)
    ) {
      seen.add(m.pantryItemId);
      usesExpiring.push({ pantryItemId: m.pantryItemId, name: m.pantryItemName, daysToExpiry: m.daysToExpiry });
    }
  }
  usesExpiring.sort((a, b) => a.daysToExpiry - b.daysToExpiry);

  return {
    kind: 'candidate',
    ingredients,
    steps: extracted.steps.map((text, index) => ({ index, text, timerSeconds: parseTimerSeconds(text) })),
    matches,
    dietCheck,
    nutrition,
    usesExpiring,
  };
}

export type { Allergen };
