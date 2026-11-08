import 'server-only';
import type { Allergen, DietFlag, UserProfile } from '@/contracts/domain';
import sql from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type { UpdateMeInput } from './validation';

// Profile reads/writes for /api/me, onboarding and settings (SPEC F1). requireUser() (dev's
// src/lib/current-user.ts) only returns identity, so diets/allergens/goals/onboarding come from
// here (team decision 2026-11-08). Every query is scoped by the session's user id.

interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  tz: string;
  daily_kcal_goal: number | null;
  daily_protein_goal_g: number | string | null;
  diets: string[];
  allergens: string[];
  onboarded_at: Date | null;
  past_best_before_grace_days: number;
}

const COLUMNS = [
  'id', 'email', 'display_name', 'avatar_url', 'tz', 'daily_kcal_goal', 'daily_protein_goal_g',
  'diets', 'allergens', 'onboarded_at', 'past_best_before_grace_days',
];
const DAY_MS = 86_400_000;

/** Fresh fragment per query (postgres.js fragments are lazy query objects; don't share one). */
const columns = () => sql(COLUMNS);

export function rowToProfile(r: UserRow): UserProfile {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    tz: r.tz,
    dailyKcalGoal: r.daily_kcal_goal == null ? null : Number(r.daily_kcal_goal),
    dailyProteinGoalG: r.daily_protein_goal_g == null ? null : Number(r.daily_protein_goal_g),
    diets: r.diets as DietFlag[],
    allergens: r.allergens as Allergen[],
    onboarded: r.onboarded_at !== null,
    pastBestBeforeGraceDays: Number(r.past_best_before_grace_days),
  };
}

export async function getProfile(userId: string): Promise<UserProfile> {
  const [row] = await sql<UserRow[]>`SELECT ${columns()} FROM users WHERE id = ${userId}`;
  if (!row) throw new NotFoundError('User not found');
  return rowToProfile(row);
}

export async function updateProfile(userId: string, patch: UpdateMeInput): Promise<UserProfile> {
  const set: Record<string, unknown> = {};
  if (patch.displayName !== undefined) set.display_name = patch.displayName;
  if (patch.tz !== undefined) set.tz = patch.tz;
  if (patch.dailyKcalGoal !== undefined) set.daily_kcal_goal = patch.dailyKcalGoal;
  if (patch.dailyProteinGoalG !== undefined) set.daily_protein_goal_g = patch.dailyProteinGoalG;
  if (patch.diets !== undefined) set.diets = patch.diets;
  if (patch.allergens !== undefined) set.allergens = patch.allergens;
  if (patch.pastBestBeforeGraceDays !== undefined) set.past_best_before_grace_days = patch.pastBestBeforeGraceDays;

  const keys = Object.keys(set);
  const onboard = patch.completeOnboarding === true;
  if (keys.length === 0 && !onboard) return getProfile(userId);

  const onboardedAt = onboard ? sql`COALESCE(onboarded_at, now())` : sql`onboarded_at`;
  const [row] = keys.length
    ? await sql<UserRow[]>`
        UPDATE users SET ${sql(set, keys)}, onboarded_at = ${onboardedAt}
        WHERE id = ${userId} RETURNING ${columns()}`
    : await sql<UserRow[]>`
        UPDATE users SET onboarded_at = ${onboardedAt}
        WHERE id = ${userId} RETURNING ${columns()}`;
  if (!row) throw new NotFoundError('User not found');
  return rowToProfile(row);
}

/**
 * Settings → "Delete my data": removes the users row; every user-owned table cascades. The
 * daily_nutrition aggregate has no FK, and its policy only refreshes 30 days, so older buckets
 * are refreshed here to drop them. The refresh can't share a transaction with the delete.
 */
export async function deleteUserData(userId: string): Promise<void> {
  const [{ first }] = await sql<{ first: Date | null }[]>`SELECT min(eaten_at) AS first FROM meal_logs WHERE user_id = ${userId}`;
  const result = await sql`DELETE FROM users WHERE id = ${userId}`;
  if (result.count === 0) throw new NotFoundError('User not found');

  // Only what the policy won't revisit (it overlaps by a day). Refreshing recent buckets would
  // materialize today's and advance the watermark, hiding new meals from real-time results.
  const to = new Date(Date.now() - 29 * DAY_MS);
  if (!first || first >= to) return;
  const from = new Date(first.getTime() - 2 * DAY_MS);
  try {
    await sql`CALL refresh_continuous_aggregate('daily_nutrition', ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`;
  } catch (err) {
    // The account is already gone, so a retry would 404; log it for an operator to re-run.
    console.error('[delete-user] daily_nutrition refresh failed', err);
  }
}
