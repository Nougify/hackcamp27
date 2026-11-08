import { describe, expect, it } from 'vitest';
import { amountError, amountInStock, loggableUnits, nutritionForAmount, type FoodSource } from './amounts';
import { columnPath, niceCeil, ringOffset, weekdayLabel } from './chart';

const yogurt: FoodSource = {
  basis: '100g',
  nutrition: { energyKcal: 59, proteinG: 10, carbohydrateG: 3.6, fatG: 0.4 },
  stockDim: 'mass',
  gramsPerUnit: null,
  densityGPerMl: null,
};

describe('loggableUnits when not deducting', () => {
  const eggs: FoodSource = { ...yogurt, stockDim: 'count' };

  it('needs a stock conversion only when the pantry is deducted', () => {
    expect(loggableUnits(eggs)).toEqual([]);
    expect(loggableUnits(eggs, false)).toContain('g');
  });
});

describe('nutritionForAmount', () => {
  it('computes 170 g of yogurt (F15 AC1)', () => {
    expect(nutritionForAmount(yogurt, 170, 'g')).toEqual({ ok: true, meal: { kcal: 100.3, proteinG: 17, carbsG: 6.1, fatG: 0.7 } });
  });

  it('converts units within a dimension', () => {
    const r = nutritionForAmount(yogurt, 0.5, 'kg');
    expect(r.ok && r.meal.kcal).toBe(295);
  });

  it('uses grams per piece for count stock on a mass basis', () => {
    const eggs: FoodSource = { ...yogurt, nutrition: { energyKcal: 140, proteinG: 12, carbohydrateG: 1, fatG: 10 }, stockDim: 'count', gramsPerUnit: 50 };
    const r = nutritionForAmount(eggs, 2, 'pcs');
    expect(r.ok && r.meal.kcal).toBe(140);
    expect(amountInStock(eggs, 100, 'g')).toBe(2);
  });

  it('uses density between volume and mass', () => {
    const milk: FoodSource = { ...yogurt, stockDim: 'volume', densityGPerMl: 1.03 };
    const r = nutritionForAmount(milk, 100, 'ml');
    expect(r.ok && r.meal.kcal).toBe(60.8);
  });

  it('computes per-piece nutrition', () => {
    const bar: FoodSource = { ...yogurt, basis: 'unit', stockDim: 'count', nutrition: { energyKcal: 200, proteinG: null, carbohydrateG: null, fatG: null } };
    expect(nutritionForAmount(bar, 3, 'pcs')).toEqual({ ok: true, meal: { kcal: 600, proteinG: 0, carbsG: null, fatG: null } });
  });

  it('blocks food with no calorie data, even with protein', () => {
    expect(nutritionForAmount({ ...yogurt, nutrition: { energyKcal: null, proteinG: 10, carbohydrateG: null, fatG: null } }, 100, 'g')).toEqual({ ok: false, reason: 'no_calories' });
    expect(amountError('no_calories')).toContain('no calorie data');
  });

  it('refuses a conversion with no bridge', () => {
    expect(nutritionForAmount(yogurt, 1, 'cup')).toEqual({ ok: false, reason: 'no_conversion' });
    expect(nutritionForAmount(yogurt, 1, 'pcs')).toEqual({ ok: false, reason: 'no_conversion' });
  });

  it.each([0, -1, Number.NaN])('rejects amount %d', (a) => {
    expect(nutritionForAmount(yogurt, a, 'g')).toEqual({ ok: false, reason: 'invalid_amount' });
  });

  it('counts 0 kcal as data', () => {
    const r = nutritionForAmount({ ...yogurt, nutrition: { energyKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 } }, 100, 'g');
    expect(r.ok && r.meal.kcal).toBe(0);
  });
});

describe('loggableUnits', () => {
  it('offers only convertible units', () => {
    expect(loggableUnits(yogurt)).toEqual(['g', 'kg', 'oz', 'lb']);
    expect(loggableUnits({ ...yogurt, densityGPerMl: 1 })).toContain('cup');
    expect(loggableUnits({ ...yogurt, stockDim: 'count', gramsPerUnit: 50 })).toContain('pcs');
  });
  it('needs both the basis and the stock to convert', () => {
    expect(loggableUnits({ ...yogurt, stockDim: 'volume' })).toEqual([]);
  });
});

describe('chart geometry', () => {
  it.each([
    [0, 100],
    [87, 100],
    [100, 100],
    [101, 200],
    [1800, 2000],
    [2100, 5000],
  ])('rounds %d up to %d', (v, out) => expect(niceCeil(v)).toBe(out));

  it('rounds the data end and keeps the baseline square', () => {
    expect(columnPath(10, 100, 20, 50)).toBe('M10,100 V54 Q10,50 14,50 H26 Q30,50 30,54 V100 Z');
  });

  it('caps the radius on a short column', () => {
    expect(columnPath(0, 10, 20, 2)).toContain('V10');
  });

  it('fills a ring in proportion and stops at the goal', () => {
    expect(ringOffset(100, 50, 200)).toBe(75);
    expect(ringOffset(100, 500, 200)).toBe(0);
    expect(ringOffset(100, 0, 200)).toBe(100);
  });

  it('labels a calendar date without shifting it', () => {
    expect(weekdayLabel('2026-11-08')).toBe('Sun');
  });
});
