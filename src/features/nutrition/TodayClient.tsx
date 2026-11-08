'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DailyTotals, MealLog, PantryItem } from '@/contracts/domain';
import { Button, Card, Dialog, useToast, buttonClass } from '@/components/ui';
import { BAND_CLASSES, type ExpiryBand } from '@/features/pantry/expiry';
import { mealsApi } from './api';
import { LogFoodDialog } from './LogFoodDialog';
import { Ring } from './Ring';
import { WeekChart } from './WeekChart';

// SPEC F15 / UF9. The server page supplies everything; after a change, router.refresh() re-reads it.

export interface TodayMeal extends MealLog {
  /** Formatted on the server, in the user's time zone. */
  timeLabel: string;
}

export interface ExpiringItem {
  id: string;
  name: string;
  quantityDisplay: string;
  text: string;
  band: ExpiryBand;
}

export function TodayClient({
  totals,
  meals,
  history,
  expiring,
  pantryItems,
}: {
  totals: DailyTotals;
  meals: TodayMeal[];
  history: DailyTotals[];
  expiring: ExpiringItem[];
  pantryItems: PantryItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const [logOpen, setLogOpen] = useState(false);
  const [deleting, setDeleting] = useState<TodayMeal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => startRefresh(() => router.refresh());

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await mealsApi.remove(deleting.id, deleting.eatenAt);
      setDeleting(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that meal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 grid gap-6">
      <Card className="grid gap-6">
        <div className="grid grid-cols-2 justify-items-center gap-4">
          <Ring label="Calories" value={totals.kcal} goal={totals.kcalGoal} unit="kcal" />
          <Ring label="Protein" value={totals.proteinG} goal={totals.proteinGoalG} unit="g" />
        </div>
        <Button size="lg" className="h-16 w-full text-xl!" onClick={() => setLogOpen(true)}>
          + Log food
        </Button>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-display text-xl font-semibold">Today&apos;s meals</h2>
          {meals.length === 0 ? (
            <p className="text-sm text-muted">Nothing logged yet today.</p>
          ) : (
            <ul className="grid gap-1">
              {meals.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{m.label}</p>
                    <p className="text-sm text-muted tabular-nums">
                      {m.timeLabel} · {Math.round(m.kcal)} kcal · {Math.round(m.proteinG)} g protein
                    </p>
                  </div>
                  <Button variant="ghost" aria-label={`Delete ${m.label}`} onClick={() => setDeleting(m)}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-display text-xl font-semibold">Expiring soon</h2>
          {expiring.length === 0 ? (
            <p className="text-sm text-muted">Nothing in your pantry is close to its best-before date.</p>
          ) : (
            <>
              <ul className="grid gap-2">
                {expiring.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">
                      {item.name} <span className="font-normal text-muted">{item.quantityDisplay}</span>
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_CLASSES[item.band].badge}`}>{item.text}</span>
                  </li>
                ))}
              </ul>
              <Link href="/recipes" className={buttonClass('secondary', 'md', 'mt-4')}>
                Find recipes with these
              </Link>
            </>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-display text-xl font-semibold">Calories, last 7 days</h2>
        <WeekChart days={history} />
      </Card>

      <LogFoodDialog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        items={pantryItems}
        onLogged={(label) => {
          setLogOpen(false);
          toast(`${label} logged`);
          refresh();
        }}
      />

      <Dialog open={deleting !== null} onClose={() => !busy && setDeleting(null)} title="Delete this meal?">
        <div className="grid gap-4">
          <p>
            {deleting?.label} will be removed from today. Your pantry won&apos;t change, so if this meal used pantry food, adjust the quantity on the
            Pantry page.
          </p>
          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="danger" disabled={busy} onClick={() => void confirmDelete()}>
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
