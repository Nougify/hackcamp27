import { describe, expect, it } from 'vitest';
import {
  extractJsonLdBlocks,
  extractJsonLdRecipe,
  findRecipeNode,
  normalizeInstructions,
  parseIsoDuration,
  parsePublisherNutrition,
  parseYield,
} from './jsonld';

describe('findRecipeNode', () => {
  it('finds a top-level Recipe', () => {
    expect(findRecipeNode({ '@type': 'Recipe', name: 'X' })).toMatchObject({ name: 'X' });
  });

  it('walks arrays and @graph', () => {
    const doc = {
      '@graph': [
        { '@type': 'WebPage', name: 'page' },
        { '@type': ['CreativeWork', 'Recipe'], name: 'Soup' },
      ],
    };
    expect(findRecipeNode(doc)).toMatchObject({ name: 'Soup' });
  });

  it('returns null when there is no Recipe node', () => {
    expect(findRecipeNode({ '@type': 'Article' })).toBeNull();
    expect(findRecipeNode([{ '@type': 'WebPage' }])).toBeNull();
  });
});

describe('normalizeInstructions', () => {
  it('splits a string into paragraphs', () => {
    expect(normalizeInstructions('Boil water.\n\nAdd salt.')).toEqual(['Boil water.', 'Add salt.']);
  });

  it('reads HowToStep text', () => {
    expect(normalizeInstructions([{ '@type': 'HowToStep', text: 'Chop.' }, 'Serve.'])).toEqual(['Chop.', 'Serve.']);
  });

  it('flattens HowToSection in order', () => {
    const v = [
      { '@type': 'HowToSection', name: 'Sauce', itemListElement: [{ '@type': 'HowToStep', text: 'Simmer.' }] },
      { '@type': 'HowToStep', text: 'Toss.' },
    ];
    expect(normalizeInstructions(v)).toEqual(['Simmer.', 'Toss.']);
  });
});

describe('parseYield', () => {
  it('takes the first integer', () => {
    expect(parseYield('Serves 4–6')).toEqual({ servings: 4, defaulted: false, raw: 'Serves 4–6' });
    expect(parseYield(2)).toEqual({ servings: 2, defaulted: false, raw: '2' });
  });

  it('defaults to 4 when unparseable', () => {
    expect(parseYield('a bunch')).toMatchObject({ servings: 4, defaulted: true });
    expect(parseYield(null)).toMatchObject({ servings: 4, defaulted: true });
  });
});

describe('parseIsoDuration', () => {
  it('parses PT durations to minutes', () => {
    expect(parseIsoDuration('PT10M')).toBe(10);
    expect(parseIsoDuration('PT1H15M')).toBe(75);
    expect(parseIsoDuration('PT30S')).toBe(1);
    expect(parseIsoDuration('P1DT2H')).toBe(1560);
  });

  it('returns null for garbage', () => {
    expect(parseIsoDuration('10 minutes')).toBeNull();
    expect(parseIsoDuration('PT')).toBeNull();
    expect(parseIsoDuration(null)).toBeNull();
  });
});

describe('parsePublisherNutrition', () => {
  it('parses calories and macros', () => {
    expect(
      parsePublisherNutrition({
        '@type': 'NutritionInformation',
        calories: '150 calories',
        proteinContent: '6 g',
        fatContent: '5g',
        sodiumContent: '300 mg',
      }),
    ).toMatchObject({ energyKcal: 150, proteinG: 6, fatG: 5, sodiumMg: 300 });
  });

  it('converts kJ to kcal', () => {
    expect(parsePublisherNutrition({ calories: '630 kJ' })?.energyKcal).toBeCloseTo(150.6, 0);
  });

  it('returns null when nothing usable is present', () => {
    expect(parsePublisherNutrition({ '@type': 'NutritionInformation' })).toBeNull();
    expect(parsePublisherNutrition(null)).toBeNull();
  });
});

describe('extractJsonLdRecipe', () => {
  const html = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Test Soup",
"author":{"@type":"Person","name":"Jane"},
"recipeYield":"4 servings","prepTime":"PT10M","cookTime":"PT20M",
"recipeIngredient":["2 cups broth","1 tsp salt"],
"recipeInstructions":[{"@type":"HowToStep","text":"Boil broth."},{"@type":"HowToStep","text":"Add salt."}],
"nutrition":{"@type":"NutritionInformation","calories":"150 calories"}}
</script></head><body></body></html>`;

  it('extracts a full recipe from JSON-LD', () => {
    const r = extractJsonLdRecipe(html);
    expect(r).toMatchObject({
      title: 'Test Soup',
      author: 'Jane',
      ingredients: ['2 cups broth', '1 tsp salt'],
      steps: ['Boil broth.', 'Add salt.'],
      servings: 4,
      servingsDefaulted: false,
    });
    expect(r?.times).toEqual({ prepMin: 10, cookMin: 20, totalMin: null });
    expect(r?.nutrition?.energyKcal).toBe(150);
  });

  it('returns null when the page has no recipe markup', () => {
    expect(extractJsonLdRecipe('<html><body>no recipe here</body></html>')).toBeNull();
    expect(
      extractJsonLdRecipe('<script type="application/ld+json">{"@type":"Article","name":"x"}</script>'),
    ).toBeNull();
  });

  it('skips recipes without ingredients or steps', () => {
    expect(
      extractJsonLdRecipe(
        '<script type="application/ld+json">{"@type":"Recipe","name":"Empty","recipeIngredient":[],"recipeInstructions":[]}</script>',
      ),
    ).toBeNull();
  });

  it('tolerates a trailing comma in the JSON', () => {
    const blocks = extractJsonLdBlocks('<script type="application/ld+json">{"a":1,}</script>');
    expect(blocks).toEqual([{ a: 1 }]);
  });
});
