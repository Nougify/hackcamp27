import { describe, expect, it } from 'vitest';
import { pantryFixture } from '@/contracts/fixtures';
import type { PantryItem, RecipeIngredient } from '@/contracts/domain';
import { matchIngredients } from '@/server/recipes/match';
import { planDeductions } from './plan';

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

const pantryById = new Map(pantryFixture.map((p) => [p.id, p]));

describe('planDeductions', () => {
  it('scales by servingsCooked / variant.servings', () => {
    const ingredients = [
      ing({ raw: '100 g spinach', normalizedName: 'spinach', qty: 100, unit: 'g', dim: 'mass', qtyBase: 100 }),
    ];
    const lines = planDeductions({
      ingredients,
      matches: matchIngredients(ingredients, pantryFixture),
      pantryById,
      servingsCooked: 4,
      variantServings: 2,
    });
    expect(lines[0]).toMatchObject({ proposedQtyBase: 200, availableQtyBase: 200, status: 'ok' });
    expect(lines[0]?.display).toContain('200 g of 200 g');
  });

  it('clamps at the available quantity', () => {
    const ingredients = [
      ing({ raw: '500 g spinach', normalizedName: 'spinach', qty: 500, unit: 'g', dim: 'mass', qtyBase: 500 }),
    ];
    const lines = planDeductions({
      ingredients,
      matches: matchIngredients(ingredients, pantryFixture),
      pantryById,
      servingsCooked: 1,
      variantServings: 1,
    });
    expect(lines[0]).toMatchObject({ proposedQtyBase: 200, status: 'clamped' });
  });

  it('reports unconvertible with no bridge (F14 AC4)', () => {
    const noDensity: PantryItem = { ...pantryFixture[0]!, densityGPerMl: null, dim: 'mass' };
    const byId = new Map([[noDensity.id, noDensity]]);
    const ingredients = [
      ing({ raw: '2 cups spinach', normalizedName: 'spinach', qty: 2, unit: 'cup', dim: 'volume', qtyBase: 473 }),
    ];
    // mass pantry vs volume recipe with no density → unconvertible
    const massOnly: PantryItem = { ...noDensity };
    const lines = planDeductions({
      ingredients,
      matches: matchIngredients(ingredients, [massOnly]),
      pantryById: byId,
      servingsCooked: 1,
      variantServings: 1,
    });
    expect(lines[0]?.status).toBe('unconvertible');
  });

  it('marks staples and missing lines', () => {
    const ingredients = [
      ing({ raw: 'salt', normalizedName: 'salt', isStaple: true }),
      ing({ raw: 'truffle', normalizedName: 'truffle' }),
    ];
    const lines = planDeductions({
      ingredients,
      matches: matchIngredients(ingredients, pantryFixture),
      pantryById,
      servingsCooked: 1,
      variantServings: 1,
    });
    expect(lines[0]?.status).toBe('staple');
    expect(lines[1]?.status).toBe('no_match');
  });

  it('F14 AC1 shape: 150 g needed from 200 g leaves 50 g', () => {
    const ingredients = [
      ing({ raw: '150 g spinach', normalizedName: 'spinach', qty: 150, unit: 'g', dim: 'mass', qtyBase: 150 }),
    ];
    const lines = planDeductions({
      ingredients,
      matches: matchIngredients(ingredients, pantryFixture),
      pantryById,
      servingsCooked: 1,
      variantServings: 1,
    });
    expect(lines[0]?.display).toBe('Baby Spinach: 150 g of 200 g → 50 g left');
  });
});
