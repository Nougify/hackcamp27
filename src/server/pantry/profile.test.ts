import { describe, expect, it } from 'vitest';
import { rowToProfile } from './profile';

const BASE_ROW = {
  id: 'u1',
  email: 'a@b.com',
  display_name: 'A',
  avatar_url: null,
  tz: 'America/Vancouver',
  daily_kcal_goal: null,
  daily_protein_goal_g: null,
  diets: [] as string[],
  allergens: [] as string[],
  onboarded_at: null,
  past_best_before_grace_days: 0,
};

describe('rowToProfile', () => {
  it('maps a freshly created, not-yet-onboarded row', () => {
    const p = rowToProfile(BASE_ROW);
    expect(p).toMatchObject({
      id: 'u1',
      email: 'a@b.com',
      displayName: 'A',
      avatarUrl: null,
      tz: 'America/Vancouver',
      dailyKcalGoal: null,
      dailyProteinGoalG: null,
      diets: [],
      allergens: [],
      onboarded: false,
      pastBestBeforeGraceDays: 0,
    });
  });

  it('treats any non-null onboarded_at as onboarded, regardless of value', () => {
    expect(rowToProfile({ ...BASE_ROW, onboarded_at: new Date('2026-01-01T00:00:00Z') }).onboarded).toBe(true);
  });

  it('coerces a numeric-as-string protein goal to a number (postgres numeric)', () => {
    const p = rowToProfile({ ...BASE_ROW, daily_kcal_goal: 2000, daily_protein_goal_g: '120.5', past_best_before_grace_days: 3 });
    expect(p.dailyKcalGoal).toBe(2000);
    expect(p.dailyProteinGoalG).toBe(120.5);
    expect(p.pastBestBeforeGraceDays).toBe(3);
    expect(Number.isNaN(p.dailyProteinGoalG)).toBe(false);
  });

  it('keeps goal fields null rather than coercing null to 0', () => {
    const p = rowToProfile(BASE_ROW);
    expect(p.dailyKcalGoal).toBeNull();
    expect(p.dailyProteinGoalG).toBeNull();
  });

  it('passes diets and allergens through as-is', () => {
    const p = rowToProfile({ ...BASE_ROW, diets: ['vegan', 'gluten_free'], allergens: ['peanut', 'shellfish'] });
    expect(p.diets).toEqual(['vegan', 'gluten_free']);
    expect(p.allergens).toEqual(['peanut', 'shellfish']);
  });
});
