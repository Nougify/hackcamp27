'use client';

import { useState, useSyncExternalStore } from 'react';
import type { UpdateMeRequest } from '@/contracts/api';
import type { Allergen, DietFlag, UserProfile } from '@/contracts/domain';
import { Button } from '@/components/ui';
import { meApi } from './api';
import { ALLERGENS, ALLERGEN_LABELS, DIETS, DIET_LABELS } from './labels';

// SPEC UF1 / F1: diets, allergens, daily goals (optional) and time zone. Settings additionally
// edits the display name and the grace period (team decision 2026-11-08).

const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink';

// Time zones and the device zone come from the browser's Intl data, which differs from Node's, so
// they're read through useSyncExternalStore with a server snapshot of null (hydration-safe).
let zoneCache: { zones: string[]; device: string | null } | null = null;
function browserZones() {
  if (!zoneCache) {
    try {
      zoneCache = { zones: Intl.supportedValuesOf('timeZone'), device: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null };
    } catch {
      zoneCache = { zones: [], device: null };
    }
  }
  return zoneCache;
}
const noSubscribe = () => () => {};

function Chips<T extends string>({
  legend,
  options,
  labels,
  value,
  onChange,
}: {
  legend: string;
  options: T[];
  labels: Record<T, string>;
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <label
              key={o}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${
                on ? 'border-accent bg-accent-soft text-accent' : 'border-line'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              />
              <span aria-hidden>{on ? '✓' : '+'}</span> {labels[o]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ProfileForm({
  initial,
  mode,
  onSaved,
}: {
  initial: UserProfile;
  mode: 'onboarding' | 'settings';
  onSaved: (p: UserProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? '');
  const [diets, setDiets] = useState<DietFlag[]>(initial.diets);
  const [allergens, setAllergens] = useState<Allergen[]>(initial.allergens);
  const [kcal, setKcal] = useState(initial.dailyKcalGoal == null ? '' : String(initial.dailyKcalGoal));
  const [protein, setProtein] = useState(initial.dailyProteinGoalG == null ? '' : String(initial.dailyProteinGoalG));
  const [tz, setTz] = useState(initial.tz);
  const [grace, setGrace] = useState(String(initial.pastBestBeforeGraceDays ?? 0));
  const browser = useSyncExternalStore(noSubscribe, browserZones, () => null);
  const zones = browser ? (browser.zones.includes(initial.tz) ? browser.zones : [initial.tz, ...browser.zones]) : [initial.tz];
  const deviceTz = browser?.device ?? null;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const kcalNum = kcal.trim() === '' ? null : Number(kcal);
    const proteinNum = protein.trim() === '' ? null : Number(protein.replace(',', '.'));
    if (kcalNum !== null && (!Number.isInteger(kcalNum) || kcalNum < 1 || kcalNum > 20000)) {
      return setError('Calorie goal must be a whole number between 1 and 20000, or empty.');
    }
    if (proteinNum !== null && (!Number.isFinite(proteinNum) || proteinNum < 0 || proteinNum > 1000)) {
      return setError('Protein goal must be between 0 and 1000 g, or empty.');
    }
    const graceNum = Number(grace);
    if (mode === 'settings' && (!Number.isInteger(graceNum) || graceNum < 0 || graceNum > 14)) {
      return setError('Days past best-before must be a whole number from 0 to 14.');
    }
    const body: UpdateMeRequest = {
      diets,
      allergens,
      dailyKcalGoal: kcalNum,
      dailyProteinGoalG: proteinNum,
      tz,
      ...(mode === 'onboarding' ? { completeOnboarding: true } : { pastBestBeforeGraceDays: graceNum }),
      ...(mode === 'settings' && displayName.trim() ? { displayName: displayName.trim() } : {}),
    };
    setSaving(true);
    try {
      onSaved(await meApi.update(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      {mode === 'settings' && (
        <label className="grid max-w-md gap-1 text-sm font-semibold">
          Display name
          <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
        </label>
      )}

      <Chips legend="Diets" options={DIETS} labels={DIET_LABELS} value={diets} onChange={setDiets} />
      <div>
        <Chips legend="Allergies" options={ALLERGENS} labels={ALLERGEN_LABELS} value={allergens} onChange={setAllergens} />
        <p className="mt-2 text-xs text-muted">
          Recipes with these are hidden. Filters are strict, but always check product labels for allergens.
        </p>
      </div>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">
          Daily goals <span className="font-normal text-muted">(optional)</span>
        </legend>
        <label className="grid gap-1 text-sm">
          Calories (kcal)
          <input className={inputClass} inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="e.g. 2000" />
        </label>
        <label className="grid gap-1 text-sm">
          Protein (g)
          <input className={inputClass} inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="e.g. 100" />
        </label>
      </fieldset>

      <div className="grid max-w-md gap-1 text-sm">
        <label htmlFor="tz" className="font-semibold">
          Time zone
        </label>
        <select id="tz" className={inputClass} value={tz} onChange={(e) => setTz(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        {deviceTz && deviceTz !== tz && zones.includes(deviceTz) && (
          <button type="button" className="justify-self-start text-sm font-semibold text-accent underline" onClick={() => setTz(deviceTz)}>
            Use this device&apos;s time zone ({deviceTz.replaceAll('_', ' ')})
          </button>
        )}
      </div>

      {mode === 'settings' && (
        <label className="grid max-w-md gap-1 text-sm">
          <span className="font-semibold">Use items up to this many days past best-before</span>
          <input
            className={`${inputClass} max-w-28`}
            type="number"
            min={0}
            max={14}
            step={1}
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
          />
          <span className="text-muted">
            0 = never. Items within this window still show in &quot;Expiring soon&quot; and recipe search, marked
            &quot;Past best before&quot;.
          </span>
        </label>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? 'Saving…' : mode === 'onboarding' ? 'Continue' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
