import { expiryInfo, isExpiringSoon } from '@/features/pantry/expiry';
import { TodayClient, type ExpiringItem, type TodayMeal } from '@/features/nutrition/TodayClient';
import { getHistory, getTodayTotals, listMeals } from '@/server/nutrition/daily';
import { requireOnboardedProfile } from '@/server/pantry/page-guard';
import { listPantry } from '@/server/pantry/repo';

// SPEC F15 / UF9.
export default async function TodayPage() {
  const { user, profile } = await requireOnboardedProfile();
  const grace = profile.pastBestBeforeGraceDays ?? 0;
  const totals = await getTodayTotals(user, profile);
  const [meals, history, pantry] = await Promise.all([
    listMeals(user.id, totals.date),
    getHistory(user, 7, profile),
    listPantry(user.id, user.tz, { sort: 'expiry', includeEmpty: false }),
  ]);

  const time = new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: user.tz });
  const todayMeals: TodayMeal[] = meals.map((m) => ({ ...m, timeLabel: time.format(new Date(m.eatenAt)) }));
  const expiring: ExpiringItem[] = pantry
    .filter((i) => isExpiringSoon(i.daysToExpiry, grace))
    .map((i) => {
      const info = expiryInfo(i.expiryDate, i.daysToExpiry, grace);
      return { id: i.id, name: i.name, quantityDisplay: i.quantityDisplay, text: info.text, band: info.band };
    });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-semibold">Today</h1>
      <TodayClient totals={totals} meals={todayMeals} history={history} expiring={expiring} pantryItems={pantry} />
    </main>
  );
}
