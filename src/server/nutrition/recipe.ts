import 'server-only';
import type { Nutrients, NutritionEstimate, PantryItem, PantryMatch, RecipeIngredient } from '@/contracts/domain';

export interface RecipeNutritionInput {
  ingredients: RecipeIngredient[];
  matches: PantryMatch[];
  pantryById: Map<string, PantryItem>;
  servings: number;
}

type Totals = { [K in keyof Required<Nutrients>]: number };

function zero(): Totals {
  return {
    energyKcal: 0,
    proteinG: 0,
    carbohydrateG: 0,
    fatG: 0,
    saturatedFatG: 0,
    sugarsG: 0,
    fibreG: 0,
    sodiumMg: 0,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Grams of the ingredient in the recipe's own servings. Volume bridges via
 * the pantry item's density (assumed 1.0 + flagged when missing); count via
 * gramsPerUnit (skipped + flagged when missing).
 */
function gramsFor(
  ing: RecipeIngredient,
  item: PantryItem,
  estimatedFields: string[],
  label: string,
): number | null {
  if (ing.qtyBase == null || ing.dim == null) return null;
  if (ing.dim === 'mass') return ing.qtyBase;
  if (ing.dim === 'volume') {
    const density = item.densityGPerMl ?? 1.0;
    if (item.densityGPerMl == null) estimatedFields.push(`${label}: density assumed 1.0 g/ml`);
    return ing.qtyBase * density;
  }
  if (item.gramsPerUnit == null) {
    estimatedFields.push(`${label}: no grams-per-unit for ${item.name}, skipped`);
    return null;
  }
  return ing.qtyBase * item.gramsPerUnit;
}

/**
 * Per-serving estimate (F10): Σ (grams_i / 100) × per100_i ÷ servings over
 * matched pantry items with usable data. Unit-basis items contribute per
 * unit × count (mass/volume converted via bridges when available).
 */
export function estimateRecipeNutrition(input: RecipeNutritionInput): NutritionEstimate {
  const { ingredients, matches, pantryById, servings } = input;
  const total = zero();
  const estimatedFields: string[] = [];
  const matchByIndex = new Map(matches.map((m) => [m.ingredientIndex, m]));
  let basedOn = 0;
  let totalCount = 0;

  ingredients.forEach((ing, i) => {
    if (ing.isStaple) return;
    totalCount++;
    const label = `ingredient ${i + 1}`;
    const match = matchByIndex.get(i);
    if (!match || (match.status !== 'have' && match.status !== 'insufficient') || !match.pantryItemId) return;
    const item = pantryById.get(match.pantryItemId);
    if (!item) return;
    const n = item.nutrition;
    if (n.energyKcal == null && n.proteinG == null && n.carbohydrateG == null && n.fatG == null) {
      estimatedFields.push(`${label}: ${item.name} has no nutrition data, skipped`);
      return;
    }

    let factor: number; // multiplies the per-basis values
    if (item.nutritionBasis === 'unit') {
      const count = countFor(ing, item);
      if (count == null) {
        estimatedFields.push(`${label}: cannot convert to units of ${item.name}, skipped`);
        return;
      }
      factor = count;
    } else {
      const grams = gramsFor(ing, item, estimatedFields, label);
      if (grams == null) return;
      factor = item.nutritionBasis === '100ml' ? grams / (item.densityGPerMl ?? 1.0) / 100 : grams / 100;
    }

    total.energyKcal += (n.energyKcal ?? 0) * factor;
    total.proteinG += (n.proteinG ?? 0) * factor;
    total.carbohydrateG += (n.carbohydrateG ?? 0) * factor;
    total.fatG += (n.fatG ?? 0) * factor;
    total.saturatedFatG += (n.saturatedFatG ?? 0) * factor;
    total.sugarsG += (n.sugarsG ?? 0) * factor;
    total.fibreG += (n.fibreG ?? 0) * factor;
    total.sodiumMg += (n.sodiumMg ?? 0) * factor;
    basedOn++;
  });

  const perServing: Nutrients = {
    energyKcal: round1(total.energyKcal / servings),
    proteinG: round1(total.proteinG / servings),
    carbohydrateG: round1(total.carbohydrateG / servings),
    fatG: round1(total.fatG / servings),
    saturatedFatG: round1(total.saturatedFatG / servings),
    sugarsG: round1(total.sugarsG / servings),
    fibreG: round1(total.fibreG / servings),
    sodiumMg: round1(total.sodiumMg / servings),
  };
  return {
    perServing,
    coveragePct: totalCount === 0 ? 100 : Math.round((basedOn / totalCount) * 100),
    basedOn,
    total: totalCount,
    estimatedFields,
  };
}

function countFor(ing: RecipeIngredient, item: PantryItem): number | null {
  if (ing.qtyBase == null || ing.dim == null) return null;
  if (ing.dim === 'count') return ing.qtyBase;
  if (item.gramsPerUnit == null) return null;
  const grams = ing.dim === 'mass' ? ing.qtyBase : ing.qtyBase * (item.densityGPerMl ?? 1.0);
  return grams / item.gramsPerUnit;
}

export type LogBasis = 'estimate' | 'publisher' | 'low_coverage_estimate';

/**
 * Suggested meal-log value (F10): our estimate if coverage ≥ 60%, else
 * publisher nutrition if present, else the low-coverage estimate with a
 * warning basis. Falls back to zeros when nothing exists.
 */
export function suggestLogPerServing(
  estimate: NutritionEstimate,
  publisher: Nutrients | null,
): { kcal: number; proteinG: number; basis: LogBasis } {
  if (estimate.coveragePct >= 60) {
    return { kcal: estimate.perServing.energyKcal ?? 0, proteinG: estimate.perServing.proteinG ?? 0, basis: 'estimate' };
  }
  if (publisher && (publisher.energyKcal != null || publisher.proteinG != null)) {
    return { kcal: publisher.energyKcal ?? 0, proteinG: publisher.proteinG ?? 0, basis: 'publisher' };
  }
  return {
    kcal: estimate.perServing.energyKcal ?? 0,
    proteinG: estimate.perServing.proteinG ?? 0,
    basis: 'low_coverage_estimate',
  };
}
