import { AddProductFlow } from '@/features/scan/AddProductFlow';
import { requireOnboardedProfile } from '@/server/pantry/page-guard';

// SPEC UF2, UF3, UF4.
export default async function AddToPantryPage() {
  await requireOnboardedProfile();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="mb-6 font-display text-3xl font-semibold">Add to pantry</h1>
      <AddProductFlow />
    </main>
  );
}
