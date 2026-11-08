import { describe, expect, it } from 'vitest';
import {
  applyNormalizedLines,
  isStapleIngredient,
  normalizeIngredientName,
  parseIngredientLine,
  parseRecipeIngredients,
} from './parse';

describe('parseIngredientLine', () => {
  it('parses qty + unit + name', () => {
    expect(parseIngredientLine('2 tbsp olive oil')).toMatchObject({
      qty: 2,
      unit: 'tbsp',
      name: 'olive oil',
      normalizedName: 'olive oil',
      dim: 'volume',
      isStaple: true,
      flags: [],
    });
  });

  it('parses fractions, mixed numbers and unicode fractions', () => {
    expect(parseIngredientLine('1/2 cup rice').qty).toBe(0.5);
    expect(parseIngredientLine('1 1/2 cups rice').qty).toBe(1.5);
    expect(parseIngredientLine('½ tsp salt').qty).toBe(0.5);
  });

  it('uses the midpoint of a range', () => {
    expect(parseIngredientLine('2-3 cloves garlic').qty).toBe(2.5);
  });

  it('counts bare quantities as pieces', () => {
    expect(parseIngredientLine('1 lemon, juiced')).toMatchObject({
      qty: 1,
      unit: null,
      name: 'lemon',
      normalizedName: 'lemon',
      dim: 'count',
      qtyBase: 1,
    });
  });

  it('drops preparation-only comma segments', () => {
    expect(parseIngredientLine('4 boneless, skinless chicken thighs')).toMatchObject({
      qty: 4,
      normalizedName: 'chicken thigh',
      dim: 'count',
    });
  });

  it('treats containers as count', () => {
    expect(parseIngredientLine('1 (400 g) can tomatoes')).toMatchObject({
      qty: 1,
      unit: 'pcs',
      normalizedName: 'tomato',
    });
  });

  it('flags to-taste lines as negligible staples with qty 0', () => {
    expect(parseIngredientLine('Salt and pepper, to taste')).toMatchObject({
      qty: 0,
      isStaple: true,
      flags: ['negligible'],
    });
  });

  it('flags empty lines as parse_failed', () => {
    expect(parseIngredientLine('   ').flags).toEqual(['parse_failed']);
  });

  it('converts qty to base units', () => {
    const ing = parseIngredientLine('1 kg flour');
    expect(ing.qtyBase).toBe(1000);
    expect(ing.dim).toBe('mass');
  });
});

describe('normalizeIngredientName', () => {
  it.each([
    ['Chicken Thighs', 'chicken thigh'],
    ['boneless, skinless chicken thighs', 'chicken thigh'],
    ['Eggs', 'egg'],
    ['Potatoes', 'potato'],
    ['Baby Spinach', 'spinach'],
    ['Olive Oil', 'olive oil'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIngredientName(input)).toBe(expected);
  });
});

describe('isStapleIngredient', () => {
  it.each([
    ['salt', true],
    ['sea salt', true],
    ['black pepper', true],
    ['olive oil', true],
    ['water', true],
    ['spinach', false],
    ['oily fish', false],
    ['salted butter', false],
  ])('%s → %s', (name, expected) => {
    expect(isStapleIngredient(name as string)).toBe(expected);
  });
});

describe('parseRecipeIngredients + applyNormalizedLines', () => {
  it('parses a full list', () => {
    const out = parseRecipeIngredients(['2 cups broth', 'Salt, to taste']);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ normalizedName: 'broth' });
    expect(out[1]?.flags).toEqual(['negligible']);
  });

  it('applies Gemini fixes only to parse_failed lines', () => {
    const parsed = parseRecipeIngredients(['2 cups broth', '   ']);
    const fixed = applyNormalizedLines(
      parsed,
      new Map([['   ', { raw: '   ', qty: 1, unit: 'pcs', name: 'mystery item', dim: 'count' }]]),
    );
    expect(fixed[0]?.normalizedName).toBe('broth');
    expect(fixed[1]).toMatchObject({ name: 'mystery item', normalizedName: 'mystery item', flags: [] });
  });
});
