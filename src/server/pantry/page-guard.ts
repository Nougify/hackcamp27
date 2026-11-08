import 'server-only';
import { redirect } from 'next/navigation';
import type { UserProfile } from '@/contracts/domain';
import { requireUser, type AppUser } from '@/lib/current-user';
import { UnauthorizedError } from '@/lib/errors';
import { getProfile } from './profile';

// For Workstream B pages (server components). Signed out → /auth/login. Not yet onboarded →
// /onboarding (UF1 step 3; team decision: enforced in B's pages only).

export async function requireProfile(): Promise<{ user: AppUser; profile: UserProfile }> {
  let user: AppUser;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect('/auth/login');
    throw err;
  }
  return { user, profile: await getProfile(user.id) };
}

export async function requireOnboardedProfile(): Promise<{ user: AppUser; profile: UserProfile }> {
  const r = await requireProfile();
  if (!r.profile.onboarded) redirect('/onboarding');
  return r;
}
