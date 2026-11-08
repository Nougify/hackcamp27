import { describe, expect, it } from 'vitest';
import { normalizeIngredientName } from '@/server/recipes/parse';
import { detectAllergens, pantryAllergenTags } from './allergens';
import { addDays, daysBetween, daysUntil, isIsoDate, todayInTz } from './dates';
import { normalizePantryName, stripBrandAndSize } from './normalize';

describe('stripBrandAndSize', () => {
  it('removes each comma-separated brand phrase as whole words', () => {
    expect(stripBrandAndSize('Nutella Hazelnut Spread', 'Nutella, Ferrero')).toBe('Hazelnut Spread');
    expect(stripBrandAndSize('Kraft Smooth Peanut Butter', 'Kraft')).toBe('Smooth Peanut Butter');
    expect(stripBrandAndSize('Old El Paso Taco Shells', 'Old El Paso')).toBe('Taco Shells');
    expect(stripBrandAndSize("Kellogg's Corn Flakes", 'Kellogg')).toBe('Corn Flakes');
  });
  it('does not remove brand text inside other words', () => {
    expect(stripBrandAndSize('Krafty Cheese', 'Kraft')).toBe('Krafty Cheese');
  });
  it('removes package sizes and the EU estimated sign', () => {
    expect(stripBrandAndSize('Greek Yogurt 750 g', null)).toBe('Greek Yogurt');
    expect(stripBrandAndSize('Nutella 400 g e', 'Ferrero')).toBe('Nutella');
    expect(stripBrandAndSize('Milk 2 L', null)).toBe('Milk');
    expect(stripBrandAndSize('Sparkling Water 12 x 355 ml', null)).toBe('Sparkling Water');
    expect(stripBrandAndSize('Eggs 12 ct', null)).toBe('Eggs');
    expect(stripBrandAndSize('Olive oil 1.5L ℮', null)).toBe('Olive oil');
    expect(stripBrandAndSize('Butter 454g', null)).toBe('Butter');
  });
  it('keeps numbers that are not sizes', () => {
    expect(stripBrandAndSize('7 Grain Bread', null)).toBe('7 Grain Bread');
    expect(stripBrandAndSize('2% Milk', null)).toBe('2% Milk');
  });
});

describe('normalizePantryName', () => {
  it('matches recipe normalization once brand and size are gone', () => {
    expect(normalizePantryName('Kraft Smooth Peanut Butter', 'Kraft')).toBe(normalizeIngredientName('smooth peanut butter'));
    expect(normalizePantryName('Nutella Hazelnut Spread', 'Nutella, Ferrero')).toBe('hazelnut spread');
    expect(normalizePantryName('Fresh Baby Spinach 312 g', 'Compliments')).toBe(normalizeIngredientName('spinach'));
    expect(normalizePantryName('Large Eggs 12 ct', null)).toBe('egg');
    expect(normalizePantryName('Roma Tomatoes', null)).toBe('roma tomato');
  });
  it('falls back to the full name when stripping leaves nothing', () => {
    expect(normalizePantryName('Nutella', 'Nutella, Ferrero')).toBe('nutella');
    expect(normalizePantryName('400 g', null)).toBe(normalizeIngredientName('400 g') || '400 g');
  });
});

describe('dates', () => {
  it('todayInTz respects the time zone', () => {
    const now = new Date('2026-11-08T06:30:00Z'); // 23:30 the previous day in Vancouver (UTC-7)
    expect(todayInTz('America/Vancouver', now)).toBe('2026-11-07');
    expect(todayInTz('UTC', now)).toBe('2026-11-08');
  });
  it('daysUntil: today is 0, past dates are negative (F5 AC3)', () => {
    const now = new Date('2026-11-08T18:00:00Z');
    expect(daysUntil('2026-11-08', 'America/Vancouver', now)).toBe(0);
    expect(daysUntil('2026-11-10', 'America/Vancouver', now)).toBe(2);
    expect(daysUntil('2026-11-05', 'America/Vancouver', now)).toBe(-3);
  });
  it('daysBetween crosses month and year ends', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
  it('isIsoDate rejects impossible dates', () => {
    expect(isIsoDate('2026-11-15')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26-11-15')).toBe(false);
  });
  it('addDays', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-11-08', -6)).toBe('2026-11-02');
  });
});

describe('allergens', () => {
  it('detects allergens in names', () => {
    // Hang's map treats plant "milk" and nut "butter" as non-dairy.
    expect(detectAllergens(['Almond Milk'])).toEqual(['tree_nut']);
    expect(detectAllergens(['Smooth Peanut Butter'])).toEqual(['peanut']);
    expect(detectAllergens(['Butter'])).toEqual(['milk']);
    expect(detectAllergens(['Bread'])).toEqual(['wheat_gluten']);
    // Over-tagging is accepted (safe direction).
    expect(detectAllergens(['Peanut-free bar'])).toEqual(['peanut']);
    expect(detectAllergens(['Baby Spinach'])).toEqual([]);
    expect(detectAllergens([null, '', undefined])).toEqual([]);
  });
  it('unions given tags with detected ones, deduplicated in enum order', () => {
    expect(pantryAllergenTags(['soy', 'tree_nut'], 'Hazelnut spread')).toEqual(['tree_nut', 'soy']);
    expect(pantryAllergenTags(['fish'], 'Baby Spinach')).toEqual(['fish']);
    expect(pantryAllergenTags(null, 'Greek Yogurt')).toEqual(['milk']);
  });
  it('drops values that are not allergens', () => {
    expect(pantryAllergenTags(['celery' as never, 'egg'], 'Bread')).toEqual(['egg', 'wheat_gluten']);
  });
});
