import { describe, expect, it } from 'vitest';
import { createPantryItemSchema, updateMeSchema, updatePantryItemSchema } from './validation';

const MINIMAL_CREATE = {
  name: 'Milk',
  quantity: 1,
  displayUnit: 'l' as const,
  nutritionBasis: '100ml' as const,
  userVerified: true,
  source: 'manual' as const,
};

describe('createPantryItemSchema: expiryDate/expirySource must be set together', () => {
  it('accepts neither field present', () => {
    expect(createPantryItemSchema.safeParse(MINIMAL_CREATE).success).toBe(true);
  });

  it('accepts both explicitly null', () => {
    const r = createPantryItemSchema.safeParse({ ...MINIMAL_CREATE, expiryDate: null, expirySource: null });
    expect(r.success).toBe(true);
  });

  it('accepts both set', () => {
    const r = createPantryItemSchema.safeParse({ ...MINIMAL_CREATE, expiryDate: '2026-12-01', expirySource: 'manual' });
    expect(r.success).toBe(true);
  });

  it('rejects a date with no source', () => {
    const r = createPantryItemSchema.safeParse({ ...MINIMAL_CREATE, expiryDate: '2026-12-01', expirySource: null });
    expect(r.success).toBe(false);
  });

  it('rejects a source with no date', () => {
    const r = createPantryItemSchema.safeParse({ ...MINIMAL_CREATE, expiryDate: null, expirySource: 'manual' });
    expect(r.success).toBe(false);
  });
});

describe('updatePantryItemSchema', () => {
  it('rejects an empty patch (nothing to update)', () => {
    expect(updatePantryItemSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field patch with no expiry fields at all', () => {
    expect(updatePantryItemSchema.safeParse({ userVerified: true }).success).toBe(true);
  });

  it('rejects providing only expirySource without expiryDate', () => {
    // expiryDate is absent (not even null), so it is treated like null for the consistency
    // check, and a non-null expirySource then disagrees with it.
    const r = updatePantryItemSchema.safeParse({ expirySource: 'manual' });
    expect(r.success).toBe(false);
  });

  it('accepts clearing both expiry fields together', () => {
    const r = updatePantryItemSchema.safeParse({ expiryDate: null, expirySource: null });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    const r = updatePantryItemSchema.safeParse({ userVerified: true, bogus: 1 });
    expect(r.success).toBe(false);
  });
});

describe('updateMeSchema', () => {
  it('accepts an empty patch', () => {
    expect(updateMeSchema.safeParse({}).success).toBe(true);
  });

  it('accepts pastBestBeforeGraceDays within 0-14', () => {
    expect(updateMeSchema.safeParse({ pastBestBeforeGraceDays: 0 }).success).toBe(true);
    expect(updateMeSchema.safeParse({ pastBestBeforeGraceDays: 14 }).success).toBe(true);
  });

  it('rejects pastBestBeforeGraceDays outside 0-14', () => {
    expect(updateMeSchema.safeParse({ pastBestBeforeGraceDays: -1 }).success).toBe(false);
    expect(updateMeSchema.safeParse({ pastBestBeforeGraceDays: 15 }).success).toBe(false);
    expect(updateMeSchema.safeParse({ pastBestBeforeGraceDays: 1.5 }).success).toBe(false);
  });

  it('deduplicates diets and allergens while keeping order', () => {
    const r = updateMeSchema.safeParse({ diets: ['vegan', 'vegan', 'gluten_free'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.diets).toEqual(['vegan', 'gluten_free']);
  });

  it('rejects an unknown diet or allergen value', () => {
    expect(updateMeSchema.safeParse({ diets: ['carnivore'] }).success).toBe(false);
    expect(updateMeSchema.safeParse({ allergens: ['gluten'] }).success).toBe(false);
  });

  it('rejects an invalid IANA time zone', () => {
    expect(updateMeSchema.safeParse({ tz: 'Mars/Olympus' }).success).toBe(false);
  });

  it('allows dailyKcalGoal/dailyProteinGoalG to be cleared with null', () => {
    const r = updateMeSchema.safeParse({ dailyKcalGoal: null, dailyProteinGoalG: null });
    expect(r.success).toBe(true);
  });
});
