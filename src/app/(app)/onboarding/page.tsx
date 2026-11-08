import { redirect } from 'next/navigation';
import { requireProfile } from '@/server/pantry/page-guard';
import { OnboardingClient } from './OnboardingClient';

// SPEC UF1 / F1 AC4: set diets, allergens, goals and time zone once; later visits skip this page.
export default async function OnboardingPage() {
  const { profile } = await requireProfile();
  if (profile.onboarded) redirect('/today');
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-semibold">Welcome to Mise</h1>
      <p className="mt-2 text-muted">
        Tell us how you eat. You can change all of this later in Settings.
      </p>
      <div className="mt-8">
        <OnboardingClient profile={profile} />
      </div>
    </main>
  );
}
