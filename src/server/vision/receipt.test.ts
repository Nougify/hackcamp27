import { describe, expect, it } from 'vitest';
import type { ReceiptExtraction } from '@/lib/gemini/schemas';
import { buildReceiptResponse } from './receipt';

const extraction = (over: Partial<ReceiptExtraction>): ReceiptExtraction => ({
  items: [],
  confidence: 'high',
  notes: null,
  ...over,
});

describe('buildReceiptResponse', () => {
  it('keeps only food items and counts the rest', () => {
    const r = buildReceiptResponse(
      extraction({
        items: [
          { name: 'Bananas', is_food_item: true, quantity: 1, unit: 'count' },
          { name: 'HST', is_food_item: false, quantity: null, unit: null },
          { name: 'Paper towels', is_food_item: false, quantity: null, unit: null },
        ],
      }),
      'gemini-test',
    );
    expect(r.items).toEqual([{ name: 'Bananas', quantity: 1, displayUnit: 'pcs' }]);
    expect(r.nonFoodCount).toBe(2);
    expect(r.model).toBe('gemini-test');
  });

  it('defaults a missing unit to pcs and maps count to pcs', () => {
    const r = buildReceiptResponse(
      extraction({ items: [{ name: 'Milk', is_food_item: true, quantity: 2, unit: null }] }),
      'm',
    );
    expect(r.items[0]).toEqual({ name: 'Milk', quantity: 2, displayUnit: 'pcs' });
  });

  it('maps a printed unit to the matching display unit', () => {
    const r = buildReceiptResponse(
      extraction({ items: [{ name: 'Flour', is_food_item: true, quantity: 1.36, unit: 'kg' }] }),
      'm',
    );
    expect(r.items[0]).toEqual({ name: 'Flour', quantity: 1.36, displayUnit: 'kg' });
  });

  it('clamps a non-positive or missing quantity to null', () => {
    const r = buildReceiptResponse(
      extraction({
        items: [
          { name: 'Eggs', is_food_item: true, quantity: 0, unit: 'count' },
          { name: 'Butter', is_food_item: true, quantity: -1, unit: 'count' },
          { name: 'Bread', is_food_item: true, quantity: null, unit: null },
        ],
      }),
      'm',
    );
    expect(r.items.map((i) => i.quantity)).toEqual([null, null, null]);
  });

  it('drops a food line whose name is blank', () => {
    const r = buildReceiptResponse(extraction({ items: [{ name: '   ', is_food_item: true, quantity: 1, unit: 'count' }] }), 'm');
    expect(r.items).toEqual([]);
    expect(r.nonFoodCount).toBe(0);
  });

  it('passes through confidence and notes', () => {
    const r = buildReceiptResponse(extraction({ confidence: 'low', notes: 'blurry photo' }), 'm');
    expect(r.confidence).toBe('low');
    expect(r.notes).toBe('blurry photo');
  });
});
