import { requireUser } from '@/lib/current-user';
import { handleRouteError, jsonOk } from '@/lib/http';
import type { UserProfile } from '@/contracts/domain';

export const runtime = 'nodejs';

// Phase 0 stub (owner: B). Returns a fixture profile for the signed-in user.
export async function GET() {
  try {
    const user = await requireUser();
    const profile: UserProfile = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      tz: user.tz,
      dailyKcalGoal: null,
      dailyProteinGoalG: null,
      diets: [],
      allergens: [],
      onboarded: false,
    };
    return jsonOk(profile);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH() {
  try {
    const user = await requireUser();
    const profile: UserProfile = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      tz: user.tz,
      dailyKcalGoal: 2000,
      dailyProteinGoalG: 120,
      diets: [],
      allergens: [],
      onboarded: true,
    };
    return jsonOk(profile);
  } catch (err) {
    return handleRouteError(err);
  }
}
