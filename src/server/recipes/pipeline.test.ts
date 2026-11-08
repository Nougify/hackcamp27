import { describe, expect, it } from 'vitest';
import { pantryFixture } from '@/contracts/fixtures';
import type { ExtractedRecipe } from './extract';
import { processExtracted } from './pipeline';

function extracted(partial: Partial<ExtractedRecipe> = {}): ExtractedRecipe {
  return {
    title: 'Spinach Chicken Skillet',
    author: 'Jane',
    siteName: 'chef.example',
    canonicalUrl: 'https://chef.example/skillet',
    ingredients: ['200 g baby spinach', '500 g chicken thigh', 'salt to taste'],
    steps: ['Cook the chicken.', 'Wilt the spinach.'],
    servings: 2,
    servingsDefaulted: false,
    yieldRaw: '2 servings',
    times: { prepMin: 10, cookMin: 20, totalMin: 30 },
    publisherNutrition: null,
    declaredDiet: [],
    extractionMethod: 'jsonld',
    ...partial,
  };
}

describe('processExtracted', () => {
  it('builds a candidate from a clean extraction (F6 AC1 shape)', async () => {
    const out = await processExtracted(extracted(), { pantry: pantryFixture, diets: [], allergens: [] });
    expect(out.kind).toBe('candidate');
    if (out.kind !== 'candidate') return;
    expect(out.matches).toHaveLength(3);
    expect(out.usesExpiring.map((u) => u.name)).toContain('Baby Spinach');
    expect(out.nutrition.basedOn).toBeGreaterThan(0);
    expect(out.steps).toHaveLength(2);
  });

  it('excludes with reason allergen when a line violates an allergy', async () => {
    const out = await processExtracted(extracted({ ingredients: ['200 g spinach', '2 tbsp peanut butter'] }), {
      pantry: pantryFixture,
      diets: [],
      allergens: ['peanut'],
    });
    expect(out).toMatchObject({ kind: 'excluded', reason: 'allergen' });
  });

  it('excludes with reason diet_violation for diet-only hits', async () => {
    const out = await processExtracted(extracted({ ingredients: ['500 g chicken thigh'] }), {
      pantry: pantryFixture,
      diets: ['vegetarian'],
      allergens: [],
    });
    expect(out).toMatchObject({ kind: 'excluded', reason: 'diet_violation' });
  });

  it('uses the injected normalizer for failed lines and survives its errors', async () => {
    const ok = await processExtracted(extracted({ ingredients: ['   '] }), { pantry: pantryFixture, diets: [], allergens: [] }, {
      normalize: async (raws) =>
        new Map(raws.map((r) => [r, { raw: r, qty: 1, unit: 'pcs' as const, name: 'mystery', dim: 'count' as const }])),
    });
    expect(ok.kind).toBe('candidate');

    const failed = await processExtracted(
      extracted({ ingredients: ['   '] }),
      { pantry: pantryFixture, diets: [], allergens: [] },
      {
        normalize: async () => {
          throw new Error('gemini down');
        },
      },
    );
    expect(failed.kind).toBe('candidate'); // best-effort: still a candidate
  });
});
