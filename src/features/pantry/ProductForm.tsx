'use client';

import { useId, useState, type ReactNode } from 'react';
import type { Allergen, DisplayUnit, Nutrients } from '@/contracts/domain';
import { Button } from '@/components/ui';
import { unitDim } from '@/lib/units';
import { ALLERGENS, ALLERGEN_LABELS, UNIT_LABELS } from './labels';

// SPEC F3/F5: ONE form for manual entry, editing and Gemini label drafts. Requires name, quantity
// and unit; nutrition optional. Nothing is saved until the user presses the submit button
// (confirm-before-save, §12 rule 2). Flagged fields are highlighted.

export type NutritionBasis = '100g' | '100ml' | 'unit';
export type FlaggableField = keyof Nutrients | 'servingSize' | 'packageQuantity' | 'name';

export interface ProductFormValues {
  name: string;
  brand: string | null;
  quantity: number;
  displayUnit: DisplayUnit;
  gramsPerUnit: number | null;
  densityGPerMl: number | null;
  expiryDate: string | null;
  expirySource: 'photo' | 'manual' | null;
  expiryRawText: string | null;
  nutritionBasis: NutritionBasis;
  nutrition: Nutrients | null;
  servingSizeBase: number | null;
  allergenTags: Allergen[];
}

export interface AppliedExpiry {
  date: string;
  source: 'photo' | 'manual';
  rawText: string | null;
}

export interface ProductFormInitial extends Partial<Omit<ProductFormValues, 'quantity'>> {
  quantity?: number | null;
}

const UNITS = Object.keys(UNIT_LABELS) as DisplayUnit[];
const NUTRIENT_FIELDS: Array<{ key: 'energyKcal' | 'proteinG' | 'carbohydrateG' | 'fatG'; label: string; unit: string }> = [
  { key: 'energyKcal', label: 'Calories', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'carbohydrateG', label: 'Carbohydrate (total)', unit: 'g' },
  { key: 'fatG', label: 'Fat', unit: 'g' },
];

const str = (n: number | null | undefined) => (n == null ? '' : String(n));
/** '' → null; otherwise a finite number ≥ 0, or NaN for invalid input. */
function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
}

const inputClass = (flagged = false) =>
  `min-h-11 w-full rounded-xl border bg-surface px-3 text-ink ${flagged ? 'border-warn ring-2 ring-warn/40' : 'border-line'}`;

export function ProductForm({
  initial,
  flaggedFields = [],
  badge,
  expirySlot,
  allowZeroQuantity = false,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: {
  initial?: ProductFormInitial;
  flaggedFields?: FlaggableField[];
  /** e.g. <Badge tone="ai">Read by AI, please confirm</Badge> */
  badge?: ReactNode;
  /** Controls under the date field, e.g. "Photo of date" (F4). `apply` fills the date in. */
  expirySlot?: (apply: (expiry: AppliedExpiry) => void) => ReactNode;
  /** Editing an item that's already empty must not force the user to invent stock. */
  allowZeroQuantity?: boolean;
  submitLabel?: string;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const id = useId();
  const flagged = new Set<FlaggableField>(flaggedFields);

  const [name, setName] = useState(initial?.name ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [quantity, setQuantity] = useState(str(initial?.quantity));
  const [unit, setUnit] = useState<DisplayUnit>(initial?.displayUnit ?? 'g');
  const [gramsPerUnit, setGramsPerUnit] = useState(str(initial?.gramsPerUnit));
  const [density, setDensity] = useState(str(initial?.densityGPerMl));
  const [hasExpiry, setHasExpiry] = useState(initial?.expiryDate != null);
  const [expiryDate, setExpiryDate] = useState(initial?.expiryDate ?? '');
  const [basis, setBasis] = useState<NutritionBasis>(initial?.nutritionBasis ?? defaultBasis(initial?.displayUnit ?? 'g'));
  const [nutrients, setNutrients] = useState<Record<string, string>>(() =>
    Object.fromEntries(NUTRIENT_FIELDS.map((f) => [f.key, str(initial?.nutrition?.[f.key])])),
  );
  const [servingSize, setServingSize] = useState(str(initial?.servingSizeBase));
  const [allergens, setAllergens] = useState<Allergen[]>(initial?.allergenTags ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A stored or photo-read date keeps its source and raw text only while the date is left unchanged.
  const [knownExpiry, setKnownExpiry] = useState<AppliedExpiry | null>(
    initial?.expiryDate ? { date: initial.expiryDate, source: initial.expirySource ?? 'manual', rawText: initial.expiryRawText ?? null } : null,
  );
  const applyExpiry = (expiry: AppliedExpiry) => {
    setKnownExpiry(expiry);
    setHasExpiry(true);
    setExpiryDate(expiry.date);
  };
  const dim = unitDim(unit);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const q = parseNum(quantity);
    if (!name.trim()) return setError('Enter a name.');
    if (q === null || Number.isNaN(q) || (q === 0 && !allowZeroQuantity)) return setError('Enter a quantity greater than 0.');
    if (hasExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return setError('Pick a best-before date, or choose "No date".');

    const nums = Object.fromEntries(NUTRIENT_FIELDS.map((f) => [f.key, parseNum(nutrients[f.key] ?? '')])) as Record<
      (typeof NUTRIENT_FIELDS)[number]['key'],
      number | null
    >;
    if (Object.values(nums).some((v) => Number.isNaN(v))) return setError('Nutrition values must be numbers ≥ 0.');
    const serving = parseNum(servingSize);
    const gpu = parseNum(gramsPerUnit);
    const dens = parseNum(density);
    if ([serving, gpu, dens].some((v) => Number.isNaN(v) || v === 0)) return setError('Sizes must be numbers greater than 0.');

    const anyNutrient = Object.values(nums).some((v) => v !== null);
    const dateKnown = hasExpiry && knownExpiry !== null && expiryDate === knownExpiry.date;
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        brand: brand.trim() || null,
        quantity: q,
        displayUnit: unit,
        gramsPerUnit: dim === 'count' ? gpu : (initial?.gramsPerUnit ?? null),
        densityGPerMl: dim === 'volume' ? dens : (initial?.densityGPerMl ?? null),
        expiryDate: hasExpiry ? expiryDate : null,
        expirySource: hasExpiry ? (dateKnown ? knownExpiry.source : 'manual') : null,
        expiryRawText: dateKnown ? knownExpiry.rawText : null,
        nutritionBasis: basis,
        nutrition: anyNutrient
          ? { energyKcal: nums.energyKcal, proteinG: nums.proteinG, carbohydrateG: nums.carbohydrateG, fatG: nums.fatG }
          : null,
        servingSizeBase: basis === 'unit' ? null : serving,
        allergenTags: allergens,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const toggleAllergen = (a: Allergen) => setAllergens((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]));

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      {badge}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Name <span className="sr-only">(required)</span>
          <input
            className={inputClass(flagged.has('name'))}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Brand <span className="font-normal text-muted">(optional)</span>
          <input className={inputClass()} value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={120} autoComplete="off" />
        </label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Quantity you have</legend>
        <div className="flex gap-2">
          <input
            aria-label="Quantity"
            className={`${inputClass(flagged.has('packageQuantity'))} max-w-40`}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
          <select
            aria-label="Unit"
            className={`${inputClass()} max-w-36`}
            value={unit}
            onChange={(e) => {
              const u = e.target.value as DisplayUnit;
              setUnit(u);
              if (unitDim(u) !== dim) setBasis(defaultBasis(u));
            }}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </div>
        {dim === 'count' && (
          <label className="grid max-w-xs gap-1 text-sm">
            Weight of one piece (g) <span className="text-muted">optional, helps convert recipes</span>
            <input className={inputClass()} inputMode="decimal" value={gramsPerUnit} onChange={(e) => setGramsPerUnit(e.target.value)} />
          </label>
        )}
        {dim === 'volume' && (
          <label className="grid max-w-xs gap-1 text-sm">
            Density (g per ml) <span className="text-muted">optional, e.g. 1.03 for milk</span>
            <input className={inputClass()} inputMode="decimal" value={density} onChange={(e) => setDensity(e.target.value)} />
          </label>
        )}
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Best before</legend>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name={`${id}-expiry`} checked={hasExpiry} onChange={() => setHasExpiry(true)} /> Enter date
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name={`${id}-expiry`} checked={!hasExpiry} onChange={() => setHasExpiry(false)} /> No date
          </label>
        </div>
        {hasExpiry && (
          <input
            type="date"
            aria-label="Best-before date"
            className={`${inputClass()} max-w-52`}
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />
        )}
        {hasExpiry && knownExpiry?.rawText && expiryDate === knownExpiry.date && (
          <p className="text-sm text-muted">
            Read: <code className="rounded bg-surface-2 px-1">{knownExpiry.rawText}</code>
          </p>
        )}
        {expirySlot?.(applyExpiry)}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">
          Nutrition <span className="font-normal text-muted">(optional, but helps track calories)</span>
        </legend>
        <label className="grid max-w-xs gap-1 text-sm">
          Values are
          <select className={inputClass()} value={basis} onChange={(e) => setBasis(e.target.value as NutritionBasis)}>
            <option value="100g">per 100 g</option>
            <option value="100ml">per 100 ml</option>
            <option value="unit">per piece</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {NUTRIENT_FIELDS.map((f) => (
            <label key={f.key} className="grid gap-1 text-sm">
              {f.label} ({f.unit})
              <input
                className={inputClass(flagged.has(f.key))}
                inputMode="decimal"
                value={nutrients[f.key]}
                onChange={(e) => setNutrients((n) => ({ ...n, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {basis !== 'unit' && (
          <label className="grid max-w-xs gap-1 text-sm">
            Serving size ({basis === '100ml' ? 'ml' : 'g'}) <span className="text-muted">optional</span>
            <input
              className={inputClass(flagged.has('servingSize'))}
              inputMode="decimal"
              value={servingSize}
              onChange={(e) => setServingSize(e.target.value)}
            />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Contains allergens</legend>
        <div className="flex flex-wrap gap-2">
          {ALLERGENS.map((a) => (
            <label
              key={a}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${
                allergens.includes(a) ? 'border-accent bg-accent-soft text-accent' : 'border-line'
              }`}
            >
              <input type="checkbox" className="sr-only" checked={allergens.includes(a)} onChange={() => toggleAllergen(a)} />
              <span aria-hidden>{allergens.includes(a) ? '✓' : '+'}</span> {ALLERGEN_LABELS[a]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Always check product labels for allergens.</p>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function defaultBasis(unit: DisplayUnit): NutritionBasis {
  const d = unitDim(unit);
  return d === 'volume' ? '100ml' : d === 'count' ? 'unit' : '100g';
}
