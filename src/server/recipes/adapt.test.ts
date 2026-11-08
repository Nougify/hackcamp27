import { describe, expect, it } from 'vitest';
import { pantryFixture } from '@/contracts/fixtures';
import { originalRecipesFixture } from '@/contracts/fixtures';
import type { AdaptationOutput } from '@/lib/gemini/schemas';
import { UnprocessableError } from '@/lib/errors';
import { buildAdaptedRecipe, requestAdaptation, validateAdaptation, type AdaptValidationContext } from './adapt';

const yogurt = pantryFixture.find((p) => p.normalizedName === 'greek yogurt')!;

function ctx(over: Partial<AdaptValidationContext> = {}): AdaptValidationContext {
  return {
    missingRaws: ['2 cups buttermilk'],
    pantryById: new Map(pantryFixture.map((p) => [p.id, p])),
    stepCount: 3,
    diets: [],
    allergens: [],
    ...over,
  };
}

function output(over: Partial<AdaptationOutput> = {}): AdaptationOutput {
  return {
    substitutions: [
      {
        missingIngredient: '2 cups buttermilk',
        substitute: 'Greek yogurt, thinned',
        pantryItemId: yogurt.id,
        quantity: '2 cups',
        reason: 'Similar acidity',
        impact: 'minimal',
      },
    ],
    ingredients: [{ text: '2 cups Greek yogurt, thinned', changed: true }],
    stepChanges: [{ stepIndex: 0, newText: 'Whisk the eggs and thinned yogurt.' }],
    warnings: [],
    ...over,
  };
}

describe('validateAdaptation', () => {
  it('accepts a valid adaptation', () => {
    expect(validateAdaptation(output(), ctx())).toEqual({ ok: true, errors: [] });
  });

  it('rejects unknown pantryItemId (F9 AC4 shape)', () => {
    const out = output({
      substitutions: [{ ...output().substitutions[0]!, pantryItemId: '00000000-0000-0000-0000-000000000000' }],
    });
    const v = validateAdaptation(out, ctx());
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('unknown pantryItemId'))).toBe(true);
  });

  it('rejects missingIngredient lines that are not actually missing', () => {
    const out = output({
      substitutions: [{ ...output().substitutions[0]!, missingIngredient: '2 eggs' }],
    });
    expect(validateAdaptation(out, ctx()).ok).toBe(false);
  });

  it('rejects substitutes that violate the diet (F7 AC3 shape)', () => {
    const out = output({
      substitutions: [{ ...output().substitutions[0]!, substitute: 'melted butter', pantryItemId: null }],
    });
    const v = validateAdaptation(out, ctx({ diets: ['dairy_free'] }));
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('dairy_free'))).toBe(true);
  });

  it('rejects substitute pantry items carrying an excluded allergen', () => {
    const v = validateAdaptation(output(), ctx({ allergens: ['milk'] }));
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.includes('allergen'))).toBe(true);
  });

  it('rejects out-of-range stepIndex', () => {
    const out = output({ stepChanges: [{ stepIndex: 9, newText: 'x' }] });
    expect(validateAdaptation(out, ctx()).ok).toBe(false);
  });
});

describe('requestAdaptation', () => {
  it('retries once, then throws 422 with details (F9 AC4)', async () => {
    let calls = 0;
    const bad = output({
      substitutions: [{ ...output().substitutions[0]!, pantryItemId: 'nope' }],
    });
    await expect(
      requestAdaptation(originalRecipesFixture[1], ['2 cups buttermilk'], pantryFixture, { diets: [], allergens: [] }, {
        generate: async () => {
          calls++;
          return { data: bad, model: 'test-model' };
        },
      }),
    ).rejects.toBeInstanceOf(UnprocessableError);
    expect(calls).toBe(2);
  });

  it('succeeds on the retry', async () => {
    let calls = 0;
    const bad = output({
      substitutions: [{ ...output().substitutions[0]!, pantryItemId: 'nope' }],
    });
    const built = await requestAdaptation(
      originalRecipesFixture[1],
      ['2 cups buttermilk'],
      pantryFixture,
      { diets: [], allergens: [] },
      {
        generate: async () => {
          calls++;
          return { data: calls === 1 ? bad : output(), model: 'test-model' };
        },
      },
    );
    expect(calls).toBe(2);
    expect(built.substitutions).toHaveLength(1);
  });
});

describe('buildAdaptedRecipe', () => {
  it('applies step changes, marks changed flags, and keeps the original intact', () => {
    const before = JSON.stringify(originalRecipesFixture[1]);
    const built = buildAdaptedRecipe(originalRecipesFixture[1], output(), 'test-model');
    expect(built.steps[0]).toMatchObject({ text: 'Whisk the eggs and thinned yogurt.', changed: true });
    expect(built.steps[1]?.changed).toBe(false);
    expect(built.ingredients[0]).toMatchObject({ changed: true });
    expect(built.ingredients[0]?.parsed.normalizedName).toBeTruthy();
    expect(built.model).toBe('test-model');
    expect(JSON.stringify(originalRecipesFixture[1])).toBe(before);
  });
});
