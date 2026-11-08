'use client';

import { useRouter } from 'next/navigation';
import type { UserProfile } from '@/contracts/domain';
import { ProfileForm } from '@/features/pantry/ProfileForm';

export function OnboardingClient({ profile }: { profile: UserProfile }) {
  const router = useRouter();
  return (
    <ProfileForm
      initial={profile}
      mode="onboarding"
      onSaved={() => {
        router.replace('/today');
        router.refresh();
      }}
    />
  );
}
