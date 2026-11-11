import Link from 'next/link';
import { buttonClass } from '@/components/ui';
import { PantryList } from '@/features/pantry/PantryList';
import { requireOnboardedProfile } from '@/server/pantry/page-guard';
import { listPantry } from '@/server/pantry/repo';

// SPEC F5: pantry sorted by soonest best-before; colour band + text per item.
export default async function PantryPage() {
  const { user, profile } = await requireOnboardedProfile();
  const items = await listPantry(user.id, user.tz, { sort: 'expiry', includeEmpty: false });
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-semibold">Pantry</h1>
      <div className="mt-6">
        <PantryList
          initialItems={items}
          graceDays={profile.pastBestBeforeGraceDays ?? 0}
          addSlot={
            <Link href="/pantry/add" className={buttonClass()}>
              Add items
            </Link>
          }
        />
      </div>
    </main>
  );
}
