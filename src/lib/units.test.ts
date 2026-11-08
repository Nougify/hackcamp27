import { describe, expect, it } from 'vitest';
import { convertBetween, formatQty, fromBase, parseUnit, toBase } from './units';

describe('toBase / fromBase', () => {
  it('converts every mass factor', () => {
    expect(toBase(1, 'g')).toEqual({ dim: 'mass', qtyBase: 1 });
    expect(toBase(1, 'kg')).toEqual({ dim: 'mass', qtyBase: 1000 });
    expect(toBase(1, 'oz')?.qtyBase).toBeCloseTo(28.3495, 4);
    expect(toBase(1, 'lb')?.qtyBase).toBeCloseTo(453.592, 3);
  });

  it('converts every volume factor', () => {
    expect(toBase(1, 'ml')).toEqual({ dim: 'volume', qtyBase: 1 });
    expect(toBase(1, 'l')).toEqual({ dim: 'volume', qtyBase: 1000 });
    expect(toBase(1, 'tsp')?.qtyBase).toBeCloseTo(4.92892, 4);
    expect(toBase(1, 'tbsp')?.qtyBase).toBeCloseTo(14.7868, 3);
    expect(toBase(1, 'cup')?.qtyBase).toBeCloseTo(236.588, 2);
    expect(toBase(1, 'fl_oz')?.qtyBase).toBeCloseTo(29.5735, 3);
  });

  it('treats count units as 1:1', () => {
    expect(toBase(3, 'pcs')).toEqual({ dim: 'count', qtyBase: 3 });
  });

  it('round-trips cup -> ml -> cup', () => {
    const { qtyBase } = toBase(2, 'cup')!;
    expect(qtyBase).toBeCloseTo(473.176, 2);
    expect(fromBase(qtyBase, 'volume', 'cup')).toBeCloseTo(2, 6);
  });

  it('round-trips kg <-> g', () => {
    const { qtyBase } = toBase(1.5, 'kg')!;
    expect(qtyBase).toBe(1500);
    expect(fromBase(qtyBase, 'mass', 'g')).toBe(1500);
    expect(fromBase(qtyBase, 'mass', 'kg')).toBe(1.5);
  });

  it('rejects a unit from the wrong dimension', () => {
    expect(fromBase(1000, 'mass', 'l')).toBeNull();
  });
});

describe('convertBetween', () => {
  it('is a no-op across the same dimension', () => {
    expect(convertBetween(500, 'mass', 'mass', {})).toBe(500);
  });

  it('bridges count -> mass via gramsPerUnit', () => {
    expect(convertBetween(2, 'count', 'mass', { gramsPerUnit: 50 })).toBe(100);
  });

  it('bridges mass -> count via gramsPerUnit', () => {
    expect(convertBetween(150, 'mass', 'count', { gramsPerUnit: 50 })).toBe(3);
  });

  it('bridges volume -> mass via densityGPerMl', () => {
    expect(convertBetween(100, 'volume', 'mass', { densityGPerMl: 1.03 })).toBeCloseTo(103, 6);
  });

  it('bridges mass -> volume via densityGPerMl', () => {
    expect(convertBetween(103, 'mass', 'volume', { densityGPerMl: 1.03 })).toBeCloseTo(100, 6);
  });

  it('chains count -> volume through grams when both bridges are present', () => {
    expect(convertBetween(2, 'count', 'volume', { gramsPerUnit: 50, densityGPerMl: 1 })).toBe(100);
  });

  it('returns null when no bridge is available', () => {
    expect(convertBetween(2, 'count', 'mass', {})).toBeNull();
    expect(convertBetween(100, 'volume', 'mass', {})).toBeNull();
    expect(convertBetween(2, 'count', 'volume', { gramsPerUnit: 50 })).toBeNull();
  });
});

describe('parseUnit aliases', () => {
  it.each([
    ['Tbsp', 'tbsp'],
    ['tablespoons', 'tbsp'],
    ['TSP', 'tsp'],
    ['grams', 'g'],
    ['Kilograms', 'kg'],
    ['lbs', 'lb'],
    ['fl.oz', 'fl_oz'],
    ['each', 'pcs'],
    ['clove', 'pcs'],
    ['eggs', 'pcs'],
  ])('parses %s as %s', (raw, expected) => {
    expect(parseUnit(raw)).toBe(expected);
  });

  it('returns null for unknown units', () => {
    expect(parseUnit('smidgen')).toBeNull();
  });
});

describe('formatQty', () => {
  it('formats mass under 1000 g as grams', () => {
    expect(formatQty(350, 'mass')).toBe('350 g');
  });

  it('formats mass at or above 1000 g as kg', () => {
    expect(formatQty(1500, 'mass')).toBe('1.5 kg');
  });

  it('formats count as pcs', () => {
    expect(formatQty(3, 'count')).toBe('3 pcs');
  });

  it('honours a preferred unit matching the dimension', () => {
    expect(formatQty(2000, 'mass', 'g')).toBe('2000 g');
  });
});
