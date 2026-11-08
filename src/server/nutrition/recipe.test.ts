import { describe, expect, it } from 'vitest';
import { fixturePantry } from '@/contracts/fixtures/pantry';
import type { PantryItem, PantryMatch, RecipeIngredient } from '@/contracts/domain';
import { estimateRecipeNutrition, suggestLogPerServing } from './recipe';

function ing(partial: Partial<RecipeIngredient> & { raw: string }): RecipeIngredient {
  return {
    qty: null,
    unit: null,
    name: null,
    normalizedName: null,
    dim: null,
    qtyBase: null,
    isStaple: false,
    flags: [],
    ...partial,
  };
}

function have(index: number, item: PantryItem): PantryMatch {
  return { ingredientIndex: index, status: 'have', pantryItemId: item.id, pantryItemName: item.name, daysToExpiry: item.daysToExpiry };
}

function pantryItem(partial: Partial<PantryItem> & { id: string; name: string }): PantryItem {
  return {
    gtin: null,
    normalizedName: partial.name.toLowerCase(),
    brand: null,
    dim: 'mass',
    quantityBase: 1000,
    displayUnit: 'g',
    quantityDisplay: '1 kg',
    gramsPerUnit: null,
    densityGPerMl: null,
    expiryDate: null,
    expirySource: null,
    daysToExpiry: null,
    nutritionBasis: '100g',
    nutrition: { energyKcal: null, proteinG: null, carbohydrateG: null, fatG: null },
    perServing: null,
    servingSizeBase: null,
    allergenTags: [],
    source: 'manual',
    userVerified: true,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('estimateRecipeNutrition', () => {
  it('F10 AC1: chicken + rice at 2 servings', () => {
    const chicken = pantryItem({
      id: 'chicken',
      name: 'Chicken',
      nutrition: { energyKcal: 165, proteinG: 31, carbohydrateG: 0, fatG: 7 },
    });
    const rice = pantryItem({
      id: 'rice',
      name: 'Rice',
      nutrition: { energyKcal: 130, proteinG: 2.7, carbohydrateG: 28, fatG: 0.3 },
    });
    const est = estimateRecipeNutrition({
      ingredients: [
        ing({ raw: '200 g chicken', normalizedName: 'chicken', qty: 200, unit: 'g', dim: 'mass', qtyBase: 200 }),
        ing({ raw: '100 g rice', normalizedName: 'rice', qty: 100, unit: 'g', dim: 'mass', qtyBase: 100 }),
      ],
      matches: [have(0, chicken), have(1, rice)],
      pantryById: new Map([[chicken.id, chicken], [rice.id, rice]]),
      servings: 2,
    });
    expect(est.perServing.energyKcal).toBe(230);
    expect(est.perServing.proteinG).toBe(32.4); // (62 + 2.7) / 2 = 32.35 → 32.4
    expect(est.coveragePct).toBe(100);
    expect(est.basedOn).toBe(2);
  });

  it('F10 AC2: unmatched broth lowers coverage and is noted', () => {
    const chicken = pantryItem({
      id: 'chicken',
      name: 'Chicken',
      nutrition: { energyKcal: 165, proteinG: 31, carbohydrateG: 0, fatG: 7 },
    });
    const est = estimateRecipeNutrition({
      ingredients: [
        ing({ raw: '200 g chicken', normalizedName: 'chicken', qty: 200, unit: 'g', dim: 'mass', qtyBase: 200 }),
        ing({ raw: '2 cups broth', normalizedName: 'broth', qty: 2, unit: 'cup', dim: 'volume', qtyBase: 473 }),
      ],
      matches: [
        have(0, chicken),
        { ingredientIndex: 1, status: 'missing', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
      ],
      pantryById: new Map([[chicken.id, chicken]]),
      servings: 2,
    });
    expect(est.coveragePct).toBe(50);
    expect(est.basedOn).toBe(1);
    expect(est.total).toBe(2);
  });

  it('assumes density 1.0 for volume with a flag', () => {
    const milk = fixturePantry.find((p) => p.normalizedName === 'milk')!;
    const noDensity: PantryItem = { ...milk, densityGPerMl: null };
    const est = estimateRecipeNutrition({
      ingredients: [ing({ raw: '1 cup milk', normalizedName: 'milk', qty: 1, unit: 'cup', dim: 'volume', qtyBase: 236.6 })],
      matches: [have(0, noDensity)],
      pantryById: new Map([[noDensity.id, noDensity]]),
      servings: 1,
    });
    expect(est.basedOn).toBe(1);
    expect(est.estimatedFields.some((f) => f.includes('density assumed 1.0'))).toBe(true);
  });

  it('skips count items without gramsPerUnit and flags them', () => {
    const egg = fixturePantry.find((p) => p.normalizedName === 'egg')!;
    const noBridge: PantryItem = { ...egg, gramsPerUnit: null };
    const est = estimateRecipeNutrition({
      ingredients: [ing({ raw: '100 g egg', normalizedName: 'egg', qty: 100, unit: 'g', dim: 'mass', qtyBase: 100 })],
      matches: [have(0, noBridge)],
      pantryById: new Map([[noBridge.id, noBridge]]),
      servings: 1,
    });
    // Unit-basis nutrition with no gramsPerUnit bridge → skipped + flagged.
    expect(est.basedOn).toBe(0);
    expect(est.coveragePct).toBe(0);
    expect(est.estimatedFields.some((f) => f.includes('cannot convert to units'))).toBe(true);
  });
});

describe('suggestLogPerServing', () => {
  const est = (coveragePct: number, kcal: number, proteinG: number) => ({
    perServing: { energyKcal: kcal, proteinG, carbohydrateG: null, fatG: null },
    coveragePct,
    basedOn: 1,
    total: 2,
    estimatedFields: [] as string[],
  });

  it('uses the estimate at coverage ≥ 60', () => {
    expect(suggestLogPerServing(est(80, 230, 32), { energyKcal: 450, proteinG: 10, carbohydrateG: null, fatG: null })).toEqual({
      kcal: 230,
      proteinG: 32,
      basis: 'estimate',
    });
  });

  it('F10 AC3: coverage 0 with publisher 450 kcal → publisher', () => {
    expect(suggestLogPerServing(est(0, 0, 0), { energyKcal: 450, proteinG: 20, carbohydrateG: null, fatG: null })).toEqual({
      kcal: 450,
      proteinG: 20,
      basis: 'publisher',
    });
  });

  it('falls back to the low-coverage estimate with a warning basis', () => {
    expect(suggestLogPerServing(est(30, 120, 5), null)).toEqual({
      kcal: 120,
      proteinG: 5,
      basis: 'low_coverage_estimate',
    });
  });
});
