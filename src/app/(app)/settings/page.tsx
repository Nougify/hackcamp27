import { requireProfile } from '@/server/pantry/page-guard';
import { SettingsClient } from './SettingsClient';

// SPEC F1 settings: profile, diets, allergens, goals, tz, grace days; cook-mode gesture settings
// (Jerry's component, mounted here); log out; delete my data (P1).
export default async function SettingsPage() {
  const { profile } = await requireProfile();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-semibold">Settings</h1>
      <SettingsClient profile={profile} />
    </main>
  );
}
