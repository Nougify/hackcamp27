import { describe, expect, it } from 'vitest';
import type { Allergen, DietFlag } from '@/contracts/domain';
import { checkDiet } from './check';

function fails(line: string, rule: DietFlag | Allergen): boolean {
  const diets: DietFlag[] = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'high_protein'].includes(rule as string)
    ? [rule as DietFlag]
    : [];
  const allergens: Allergen[] = diets.length > 0 ? [] : [rule as Allergen];
  return !checkDiet([line], { diets, allergens }).ok;
}

describe('F7 AC1 acceptance table', () => {
  it('"2 tbsp soy sauce" fails gluten_free and soy', () => {
    expect(fails('2 tbsp soy sauce', 'gluten_free')).toBe(true);
    expect(fails('2 tbsp soy sauce', 'soy')).toBe(true);
  });

  it('"2 tbsp tamari (gluten-free)" passes gluten_free, fails soy', () => {
    expect(fails('2 tbsp tamari (gluten-free)', 'gluten_free')).toBe(false);
    expect(fails('2 tbsp tamari (gluten-free)', 'soy')).toBe(true);
  });

  it('"1 cup almond flour" fails tree_nut, passes gluten_free', () => {
    expect(fails('1 cup almond flour', 'tree_nut')).toBe(true);
    expect(fails('1 cup almond flour', 'gluten_free')).toBe(false);
  });

  it('"chicken stock" fails vegetarian; "vegetable stock" passes', () => {
    expect(fails('1 cup chicken stock', 'vegetarian')).toBe(true);
    expect(fails('1 cup vegetable stock', 'vegetarian')).toBe(false);
  });
});

describe('allergen coverage (≥3 cases each)', () => {
  const cases: Array<[string, Allergen, boolean]> = [
    // peanut
    ['2 tbsp peanut butter', 'peanut', true],
    ['satay skewers', 'peanut', true],
    ['1 tbsp groundnut oil', 'peanut', true],
    ['2 tbsp almond butter', 'peanut', false],
    // tree_nut
    ['1 cup chopped walnuts', 'tree_nut', true],
    ['100 g marzipan', 'tree_nut', true],
    ['cashew cream', 'tree_nut', true],
    ['2 tbsp peanut butter', 'tree_nut', false],
    ['nutmeg, grated', 'tree_nut', false],
    // sesame
    ['1 tbsp tahini', 'sesame', true],
    ['sesame oil', 'sesame', true],
    ['everything bagel seasoning', 'sesame', false],
    // milk
    ['200 g cheddar cheese', 'milk', true],
    ['1 cup buttermilk', 'milk', true],
    ['2 tbsp ghee', 'milk', true],
    ['1 cup coconut milk', 'milk', false],
    ['2 tbsp peanut butter', 'milk', false],
    ['1 cup oat milk', 'milk', false],
    // egg
    ['2 eggs, beaten', 'egg', true],
    ['3 tbsp mayonnaise', 'egg', true],
    ['aioli for serving', 'egg', true],
    ['1 eggplant, diced', 'egg', false],
    // fish
    ['1 salmon fillet', 'fish', true],
    ['1 tbsp fish sauce', 'fish', true],
    ['worcestershire sauce', 'fish', true],
    ['1 lemon', 'fish', false],
    // shellfish
    ['12 large shrimp', 'shellfish', true],
    ['1 lobster tail', 'shellfish', true],
    ['calamari rings', 'shellfish', true],
    ['1 salmon fillet', 'shellfish', false],
    // soy
    ['200 g firm tofu', 'soy', true],
    ['2 tbsp miso paste', 'soy', true],
    ['1 cup edamame', 'soy', true],
    ['1 cup green peas', 'soy', false],
    // wheat_gluten
    ['2 cups all-purpose flour', 'wheat_gluten', true],
    ['200 g spaghetti', 'wheat_gluten', true],
    ['1 tbsp barley miso', 'wheat_gluten', true],
    ['2 cups rice flour', 'wheat_gluten', false],
    ['gluten-free bread', 'wheat_gluten', false],
    // mustard
    ['1 tbsp dijon mustard', 'mustard', true],
    ['mustard seeds', 'mustard', true],
    ['1 tbsp ketchup', 'mustard', false],
    // sulphite
    ['1 cup red wine', 'sulphite', true],
    ['dried apricots', 'sulphite', true],
    ['wine vinegar', 'sulphite', true],
    ['1 cup grape juice', 'sulphite', false],
  ];

  it.each(cases)('%s vs %s → fails=%s', (line, rule, expected) => {
    expect(fails(line as string, rule as Allergen)).toBe(expected);
  });
});

describe('diet coverage (≥3 cases each)', () => {
  const cases: Array<[string, DietFlag, boolean]> = [
    // vegetarian
    ['500 g ground beef', 'vegetarian', true],
    ['4 slices bacon', 'vegetarian', true],
    ['1 tbsp gelatin', 'vegetarian', true],
    ['1 can tuna', 'vegetarian', true],
    ['1 cup vegetable broth', 'vegetarian', false],
    ['200 g paneer', 'vegetarian', false],
    // vegan
    ['1 cup milk', 'vegan', true],
    ['2 eggs', 'vegan', true],
    ['1 tbsp honey', 'vegan', true],
    ['500 g chicken breast', 'vegan', true],
    ['200 g tofu', 'vegan', false],
    // gluten_free
    ['1 cup rolled oats', 'gluten_free', false],
    ['3 tbsp soy sauce', 'gluten_free', true],
    ['200 g seitan', 'gluten_free', true],
    // dairy_free
    ['100 g parmesan', 'dairy_free', true],
    ['1 cup yogurt', 'dairy_free', true],
    ['1 cup coconut cream', 'dairy_free', false],
    // high_protein is never a filter
    ['500 g chicken breast', 'high_protein', false],
    ['1 tbsp sugar', 'high_protein', false],
  ];

  it.each(cases)('%s vs %s → fails=%s', (line, rule, expected) => {
    expect(fails(line as string, rule as DietFlag)).toBe(expected);
  });
});

describe('violation shape', () => {
  it('reports the longest matching keyword per rule per line', () => {
    const res = checkDiet(['2 tbsp soy sauce'], { diets: ['gluten_free'], allergens: ['soy'] });
    expect(res.ok).toBe(false);
    expect(res.violations).toHaveLength(2);
    expect(res.violations).toContainEqual({
      ingredientRaw: '2 tbsp soy sauce',
      rule: 'gluten_free',
      matchedKeyword: 'soy sauce',
    });
  });

  it('matches against normalizedName as well as raw', () => {
    const res = checkDiet([{ raw: '500 g boneless thighs', normalizedName: 'chicken thigh' }], {
      diets: ['vegetarian'],
      allergens: [],
    });
    expect(res.ok).toBe(false);
    expect(res.violations[0]?.matchedKeyword).toBe('chicken');
  });

  it('is case-insensitive and plural-tolerant', () => {
    expect(checkDiet(['2 EGGS'], { diets: [], allergens: ['egg'] }).ok).toBe(false);
    expect(checkDiet(['fresh Walnuts'], { diets: [], allergens: ['tree_nut'] }).ok).toBe(false);
  });
});
