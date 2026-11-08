import { describe, expect, it } from 'vitest';
import { pantryForMatching, type PantryRow } from './pantry-view';

const TZ = 'America/Vancouver';
const NOW = new Date('2026-06-15T12:00:00-07:00'); // local date 2026-06-15 in America/Vancouver

function row(over: Partial<PantryRow> & { id: string; expiry_date: string | null }): PantryRow {
  return {
    gtin: null,
    name: over.name ?? 'Item',
    normalized_name: over.name ?? 'item',
    brand: null,
    dim: 'mass',
    quantity_base: 1,
    display_unit: 'g',
    grams_per_unit: null,
    density_g_per_ml: null,
    expiry_source: over.expiry_date ? 'manual' : null,
    expiry_raw_text: null,
    nutrition_basis: '100g',
    kcal_per_basis: null,
    protein_g_per_basis: null,
    carbs_g_per_basis: null,
    fat_g_per_basis: null,
    serving_size_base: null,
    allergen_tags: [],
    source: 'manual',
    user_verified: true,
    updated_at: new Date(),
    ...over,
  };
}

describe('pantryForMatching: pastBestBeforeGraceDays', () => {
  it('excludes an item 1 day past its date when there is no grace period (default)', () => {
    const rows = [row({ id: 'a', expiry_date: '2026-06-14' })]; // 1 day ago
    expect(pantryForMatching(rows, TZ, NOW)).toHaveLength(0);
  });

  it('includes an item within the grace period', () => {
    const rows = [row({ id: 'a', expiry_date: '2026-06-14' })]; // 1 day ago
    const result = pantryForMatching(rows, TZ, NOW, 25, 3);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('a');
  });

  it('still excludes an item past the grace period', () => {
    const rows = [row({ id: 'a', expiry_date: '2026-06-10' })]; // 5 days ago
    expect(pantryForMatching(rows, TZ, NOW, 25, 3)).toHaveLength(0);
  });

  it('includes an item exactly at the edge of the grace period', () => {
    const rows = [row({ id: 'a', expiry_date: '2026-06-12' })]; // 3 days ago
    expect(pantryForMatching(rows, TZ, NOW, 25, 3)).toHaveLength(1);
  });

  it('never excludes an item with no expiry date, regardless of grace days', () => {
    const rows = [row({ id: 'a', expiry_date: null })];
    expect(pantryForMatching(rows, TZ, NOW, 25, 0)).toHaveLength(1);
  });

  it('still excludes out-of-stock items even within the grace period', () => {
    const rows = [row({ id: 'a', expiry_date: '2026-06-14', quantity_base: 0 })];
    expect(pantryForMatching(rows, TZ, NOW, 25, 7)).toHaveLength(0);
  });
});
