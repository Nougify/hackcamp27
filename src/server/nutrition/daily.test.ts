import { describe, expect, it } from 'vitest';
import { manualMealSchema } from './daily';

describe('manualMealSchema: quick_add', () => {
  const base = { kind: 'quick_add' as const, label: 'Protein bar', kcal: 200, proteinG: 20 };

  it('accepts the minimal valid shape', () => {
    expect(manualMealSchema.safeParse(base).success).toBe(true);
  });

  it('accepts optional carbsG/fatG/eatenAt', () => {
    const r = manualMealSchema.safeParse({ ...base, carbsG: 10, fatG: 5, eatenAt: '2026-06-15T12:00:00-07:00' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty label', () => {
    expect(manualMealSchema.safeParse({ ...base, label: '' }).success).toBe(false);
  });

  it('rejects kcal over the 50,000 cap', () => {
    expect(manualMealSchema.safeParse({ ...base, kcal: 50_001 }).success).toBe(false);
    expect(manualMealSchema.safeParse({ ...base, kcal: 50_000 }).success).toBe(true);
  });

  it('rejects negative protein', () => {
    expect(manualMealSchema.safeParse({ ...base, proteinG: -1 }).success).toBe(false);
  });

  it('rejects an eatenAt without a timezone offset', () => {
    // z.iso.datetime({ offset: true }) requires an explicit offset, so a bare
    // local datetime string must be rejected rather than silently assumed UTC.
    expect(manualMealSchema.safeParse({ ...base, eatenAt: '2026-06-15T12:00:00' }).success).toBe(false);
  });
});

describe('manualMealSchema: pantry_item', () => {
  const base = { kind: 'pantry_item' as const, pantryItemId: '00000000-0000-4000-8000-000000000001', amount: 100, unit: 'g', deductFromPantry: true };

  it('accepts a valid shape', () => {
    expect(manualMealSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a non-uuid pantryItemId', () => {
    expect(manualMealSchema.safeParse({ ...base, pantryItemId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a zero or negative amount', () => {
    expect(manualMealSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(manualMealSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
  });

  it('rejects an amount over the 100,000 cap', () => {
    expect(manualMealSchema.safeParse({ ...base, amount: 100_001 }).success).toBe(false);
  });

  it('rejects an unknown display unit', () => {
    expect(manualMealSchema.safeParse({ ...base, unit: 'bushel' }).success).toBe(false);
  });

  it('requires deductFromPantry to be present', () => {
    const withoutFlag: Record<string, unknown> = { ...base };
    delete withoutFlag.deductFromPantry;
    expect(manualMealSchema.safeParse(withoutFlag).success).toBe(false);
  });
});

describe('manualMealSchema: barcode', () => {
  const base = { kind: 'barcode' as const, gtin: '5901234123457', amount: 1, unit: 'pcs' };

  it('accepts a valid shape', () => {
    expect(manualMealSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a gtin over 40 characters', () => {
    expect(manualMealSchema.safeParse({ ...base, gtin: '1'.repeat(41) }).success).toBe(false);
  });

  it('rejects an unknown display unit', () => {
    expect(manualMealSchema.safeParse({ ...base, unit: 'firkin' }).success).toBe(false);
  });
});

describe('manualMealSchema: discriminant', () => {
  it('rejects an unknown kind', () => {
    expect(manualMealSchema.safeParse({ kind: 'teleported', label: 'x', kcal: 1, proteinG: 1 }).success).toBe(false);
  });

  it('rejects a payload missing kind entirely', () => {
    expect(manualMealSchema.safeParse({ label: 'x', kcal: 1, proteinG: 1 }).success).toBe(false);
  });
});
