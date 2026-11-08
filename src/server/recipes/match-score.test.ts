import { describe, expect, it } from 'vitest';
import { pantryFixture } from '@/contracts/fixtures';
import type { PantryItem, RecipeIngredient } from '@/contracts/domain';
import { matchIngredients } from './match';
import { computeScores } from './score';

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

describe('matchIngredients', () => {
  it('matches exact normalized names', () => {
    const [m] = matchIngredients([ing({ raw: 'spinach', normalizedName: 'spinach' })], pantryFixture);
    expect(m).toMatchObject({ status: 'have', pantryItemName: 'Baby Spinach', daysToExpiry: 2 });
  });

  it('matches through the synonym map', () => {
    const [m] = matchIngredients([ing({ raw: 'scallions', normalizedName: 'scallion' })], [
      { ...pantryFixture[4]!, normalizedName: 'green onion', name: 'Green onions' },
    ]);
    expect(m?.status).toBe('have');
  });

  it('cilantro and coriander match both ways', () => {
    const herb = (n: string) => ({ ...pantryFixture[4]!, normalizedName: n, name: n });
    expect(matchIngredients([ing({ raw: 'cilantro', normalizedName: 'cilantro' })], [herb('coriander')])[0]?.status).toBe('have');
    expect(matchIngredients([ing({ raw: 'coriander', normalizedName: 'coriander' })], [herb('cilantro')])[0]?.status).toBe('have');
  });

  it('matches token subsets ("chicken thigh" ⊂ "boneless chicken thighs")', () => {
    const [m] = matchIngredients([ing({ raw: 'chicken thigh', normalizedName: 'chicken thigh' })], [
      { ...pantryFixture[1]!, normalizedName: 'boneless chicken thigh' },
    ]);
    expect(m?.status).toBe('have');
  });

  it('rejects single-token subset false positives ("rice" vs "rice vinegar")', () => {
    const [m] = matchIngredients([ing({ raw: 'rice', normalizedName: 'rice' })], [
      { ...pantryFixture[3]!, normalizedName: 'rice vinegar', name: 'Rice vinegar' },
    ]);
    expect(m?.status).toBe('missing');
  });

  it('breaks ties by soonest expiry (FEFO)', () => {
    const a: PantryItem = { ...pantryFixture[0]!, id: 'a', daysToExpiry: 5, expiryDate: '2099-01-01' };
    const b: PantryItem = { ...pantryFixture[0]!, id: 'b', daysToExpiry: 1, expiryDate: '2099-01-01' };
    const [m] = matchIngredients([ing({ raw: 'spinach', normalizedName: 'spinach' })], [a, b]);
    expect(m?.pantryItemId).toBe('b');
  });

  it('excludes expired and empty rows', () => {
    const expired: PantryItem = { ...pantryFixture[0]!, daysToExpiry: -2 };
    const empty: PantryItem = { ...pantryFixture[0]!, quantityBase: 0 };
    const [m1] = matchIngredients([ing({ raw: 'spinach', normalizedName: 'spinach' })], [expired]);
    const [m2] = matchIngredients([ing({ raw: 'spinach', normalizedName: 'spinach' })], [empty]);
    expect(m1?.status).toBe('missing');
    expect(m2?.status).toBe('missing');
  });

  it('marks staples without consulting the pantry', () => {
    const [m] = matchIngredients([ing({ raw: 'salt', normalizedName: 'salt', isStaple: true })], []);
    expect(m?.status).toBe('staple');
  });

  it('reports insufficient when the pantry holds less than required', () => {
    const [m] = matchIngredients(
      [ing({ raw: '500 g spinach', normalizedName: 'spinach', qty: 500, unit: 'g', dim: 'mass', qtyBase: 500 })],
      pantryFixture, // spinach: 200 g
    );
    expect(m).toMatchObject({ status: 'insufficient', daysToExpiry: 2 });
  });

  it('compares across dimensions via bridges', () => {
    // 3 lemons ≈ 300 g; recipe needs 350 g of lemon → insufficient.
    const [m] = matchIngredients(
      [ing({ raw: '350 g lemon', normalizedName: 'lemon', qty: 350, unit: 'g', dim: 'mass', qtyBase: 350 })],
      pantryFixture,
    );
    expect(m?.status).toBe('insufficient');
  });

  it('treats uncomparable matches as have (planner flags them)', () => {
    // Lemon in cups vs pantry in count with no density → can't compare.
    const noBridge: PantryItem = { ...pantryFixture.find((p) => p.normalizedName === 'lemon')!, gramsPerUnit: null };
    const [m] = matchIngredients(
      [ing({ raw: '2 cups lemon', normalizedName: 'lemon', qty: 2, unit: 'cup', dim: 'volume', qtyBase: 473 })],
      [noBridge],
    );
    expect(m?.status).toBe('have');
  });
});

describe('computeScores', () => {
  const spinach = ing({ raw: 'spinach', normalizedName: 'spinach' });
  const chicken = ing({ raw: 'chicken', normalizedName: 'chicken thigh' });
  const salt = ing({ raw: 'salt', normalizedName: 'salt', isStaple: true });

  it('matches the formula on fixture data (F6 AC6)', () => {
    const scores = computeScores(
      [
        {
          ingredients: [spinach, chicken, salt],
          matches: [
            { ingredientIndex: 0, status: 'have', pantryItemId: 'a', pantryItemName: 'Spinach', daysToExpiry: 1 },
            { ingredientIndex: 1, status: 'have', pantryItemId: 'b', pantryItemName: 'Chicken', daysToExpiry: 2 },
            { ingredientIndex: 2, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
          ],
          proteinPerServingG: 38,
        },
        {
          ingredients: [spinach, chicken, salt],
          matches: [
            { ingredientIndex: 0, status: 'missing', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
            { ingredientIndex: 1, status: 'have', pantryItemId: 'b', pantryItemName: 'Chicken', daysToExpiry: 30 },
            { ingredientIndex: 2, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
          ],
          proteinPerServingG: 10,
        },
      ],
      { highProtein: true },
    );
    // Candidate 1: coverage 1, expiry Σw=1/2+1/3=0.8333 → 0.8333/1.8333≈0.4545,
    // protein min(38/40,1)=0.95 → 0.5+0.1591+0.1425 ≈ 0.8016.
    expect(scores[0]).toMatchObject({ coverage: 1, missingCount: 0 });
    expect(scores[0]?.expiryScore).toBeCloseTo(0.4545, 3);
    expect(scores[0]?.score).toBeCloseTo(0.8016, 3);
    // Candidate 2: coverage 0.5, expiry Σw=1/31≈0.0323 → ≈0.0313, protein 0.25,
    // missing 1 → 0.25+0.01094+0.0375-0.1 ≈ 0.1984.
    expect(scores[1]?.coverage).toBe(0.5);
    expect(scores[1]?.missingCount).toBe(1);
    expect(scores[1]?.score).toBeCloseTo(0.1984, 3);
  });

  it('ignores protein without the high_protein diet', () => {
    const [s] = computeScores(
      [{ ingredients: [spinach], matches: [{ ingredientIndex: 0, status: 'have', pantryItemId: 'a', pantryItemName: 'S', daysToExpiry: null }], proteinPerServingG: 40 }],
      { highProtein: false },
    );
    expect(s?.score).toBe(0.5); // coverage 1, no expiry info, no protein, no missing
  });

  it('gives all-staple recipes full coverage', () => {
    const [s] = computeScores(
      [{ ingredients: [salt], matches: [{ ingredientIndex: 0, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null }], proteinPerServingG: null }],
      { highProtein: false },
    );
    expect(s?.coverage).toBe(1);
  });
});
