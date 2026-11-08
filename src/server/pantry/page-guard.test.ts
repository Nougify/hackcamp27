import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/contracts/domain';
import { UnauthorizedError } from '@/lib/errors';
import type { AppUser } from '@/lib/current-user';

const requireUser = vi.hoisted(() => vi.fn());
const getProfile = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
);

vi.mock('@/lib/current-user', () => ({ requireUser }));
vi.mock('./profile', () => ({ getProfile }));
vi.mock('next/navigation', () => ({ redirect }));

const { requireProfile, requireOnboardedProfile } = await import('./page-guard');

const USER: AppUser = {
  id: 'u1',
  auth0Sub: 'auth0|1',
  email: 'a@b.com',
  displayName: 'A',
  avatarUrl: null,
  tz: 'America/Vancouver',
};

function profile(onboarded: boolean): UserProfile {
  return {
    id: USER.id,
    email: USER.email,
    displayName: USER.displayName,
    avatarUrl: USER.avatarUrl,
    tz: USER.tz,
    dailyKcalGoal: null,
    dailyProteinGoalG: null,
    diets: [],
    allergens: [],
    onboarded,
    pastBestBeforeGraceDays: 0,
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('requireProfile', () => {
  it('returns the user and profile when signed in', async () => {
    requireUser.mockResolvedValue(USER);
    getProfile.mockResolvedValue(profile(true));
    const r = await requireProfile();
    expect(r.user).toBe(USER);
    expect(r.profile.onboarded).toBe(true);
    expect(getProfile).toHaveBeenCalledWith(USER.id);
  });

  it('redirects to /auth/login when signed out', async () => {
    requireUser.mockRejectedValue(new UnauthorizedError('No active session'));
    await expect(requireProfile()).rejects.toThrow('REDIRECT:/auth/login');
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('rethrows errors other than UnauthorizedError', async () => {
    requireUser.mockRejectedValue(new Error('db down'));
    await expect(requireProfile()).rejects.toThrow('db down');
  });
});

describe('requireOnboardedProfile', () => {
  it('passes through once onboarding is complete', async () => {
    requireUser.mockResolvedValue(USER);
    getProfile.mockResolvedValue(profile(true));
    const r = await requireOnboardedProfile();
    expect(r.profile.onboarded).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects to /onboarding when not yet onboarded', async () => {
    requireUser.mockResolvedValue(USER);
    getProfile.mockResolvedValue(profile(false));
    await expect(requireOnboardedProfile()).rejects.toThrow('REDIRECT:/onboarding');
  });

  it('redirects to /auth/login before checking onboarding when signed out', async () => {
    requireUser.mockRejectedValue(new UnauthorizedError('No active session'));
    await expect(requireOnboardedProfile()).rejects.toThrow('REDIRECT:/auth/login');
    expect(getProfile).not.toHaveBeenCalled();
  });
});
