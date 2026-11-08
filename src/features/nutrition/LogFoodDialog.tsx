'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { DisplayUnit, PantryItem, Product } from '@/contracts/domain';
import { Button, Dialog } from '@/components/ui';
import { UNIT_LABELS } from '@/features/pantry/labels';
import { scanApi } from '@/features/scan/api';
import type { ScannedCode } from '@/features/scan/BarcodeScanner';
import { amountError, amountInStock, itemSource, loggableUnits, nutritionForAmount, productSource, type FoodSource } from './amounts';
import { mealsApi } from './api';

// SPEC UF9: From pantry, Scan, or Quick add.

const BarcodeScanner = dynamic(() => import('@/features/scan/BarcodeScanner').then((m) => m.BarcodeScanner), { ssr: false });

type Tab = 'pantry' | 'scan' | 'quick';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'pantry', label: 'From pantry' },
  { id: 'scan', label: 'Scan' },
  { id: 'quick', label: 'Quick add' },
];

const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink';
const selectClass = 'min-h-11 w-full appearance-none rounded-xl border border-line bg-surface pl-3 pr-9 text-ink';
/** Native select arrow, rendered manually so it sits cleanly inside the rounded field. */
const chevronStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%23716354' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.75rem center',
  backgroundSize: '1rem',
} as const;
const parse = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
      {children}
    </p>
  );
}

/** Amount, unit and a live preview. */
function AmountFields({
  source,
  units,
  amount,
  setAmount,
  unit,
  setUnit,
}: {
  source: FoodSource;
  units: DisplayUnit[];
  amount: string;
  setAmount: (v: string) => void;
  unit: DisplayUnit;
  setUnit: (u: DisplayUnit) => void;
}) {
  const n = parse(amount);
  const result = nutritionForAmount(source, n, unit);
  return (
    <>
      <div className="flex gap-2">
        <label className="grid max-w-40 flex-1 gap-1 text-sm font-semibold">
          Amount
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="grid max-w-36 flex-1 gap-1 text-sm font-semibold">
          Unit
          <select className={selectClass} style={chevronStyle} value={unit} onChange={(e) => setUnit(e.target.value as DisplayUnit)}>
            {units.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {result.ok ? (
        <p className="text-sm tabular-nums">
          ≈ {Math.round(result.meal.kcal)} kcal · {Math.round(result.meal.proteinG)} g protein
        </p>
      ) : (
        amount.trim() !== '' && <Problem>{amountError(result.reason)}</Problem>
      )}
      {source.nutrition.energyKcal == null && amount.trim() === '' && <Problem>{amountError('no_calories')}</Problem>}
    </>
  );
}

function FromPantry({ items, onDone }: { items: PantryItem[]; onDone: (label: string) => void }) {
  const [id, setId] = useState(items[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [chosenUnit, setChosenUnit] = useState<DisplayUnit | null>(null);
  const [deduct, setDeduct] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = items.find((i) => i.id === id);
  if (!item) return <p className="text-sm text-muted">Your pantry is empty. Use Scan or Quick add instead.</p>;

  const source = itemSource(item);
  const units = loggableUnits(source, deduct);
  const unit = chosenUnit && units.includes(chosenUnit) ? chosenUnit : units.includes(item.displayUnit) ? item.displayUnit : units[0];
  const n = parse(amount);
  const canLog = unit !== undefined && nutritionForAmount(source, n, unit).ok;
  const stock = unit && Number.isFinite(n) ? amountInStock(source, n, unit) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canLog || !item) return;
    setSaving(true);
    setError(null);
    try {
      await mealsApi.log({ kind: 'pantry_item', pantryItemId: item.id, amount: n, unit, deductFromPantry: deduct });
      onDone(item.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <label className="grid gap-1 text-sm font-semibold">
        Item
        <select
          className={selectClass}
          style={chevronStyle}
          value={item.id}
          onChange={(e) => {
            setId(e.target.value);
            setAmount('');
            setChosenUnit(null);
          }}
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} · {i.quantityDisplay}
            </option>
          ))}
        </select>
      </label>
      {unit === undefined ? (
        <Problem>{amountError('no_conversion')}</Problem>
      ) : (
        <AmountFields source={source} units={units} amount={amount} setAmount={setAmount} unit={unit} setUnit={setChosenUnit} />
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} /> Also remove from pantry
      </label>
      {deduct && stock !== null && stock > item.quantityBase && <p className="text-sm text-muted">You only have {item.quantityDisplay}, so the item will be emptied.</p>}
      {error && <Problem>{error}</Problem>}
      <div>
        <Button type="submit" disabled={!canLog || saving}>
          {saving ? 'Logging…' : 'Log food'}
        </Button>
      </div>
    </form>
  );
}

function FromScan({ onDone }: { onDone: (label: string) => void }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [failedGtin, setFailedGtin] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [chosenUnit, setChosenUnit] = useState<DisplayUnit | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(code: ScannedCode) {
    setLooking(true);
    setNotice(null);
    try {
      const r = await scanApi.lookup(code.lookupCode);
      if (r.status === 'found') {
        setFailedGtin(null);
        setProduct(r.product);
        setAmount(r.product.servingSize ? String(r.product.servingSize.value) : '');
      } else {
        setFailedGtin(code.gtin);
        setNotice(r.status === 'not_found' ? "We couldn't find this product. Use Quick add instead." : "That barcode doesn't look valid");
      }
    } catch (e) {
      setFailedGtin(code.gtin);
      setNotice(e instanceof Error ? e.message : 'Could not look up that barcode.');
    } finally {
      setLooking(false);
    }
  }

  if (looking) {
    return (
      <p role="status" className="text-sm text-muted">
        Looking up that barcode…
      </p>
    );
  }
  if (!product) return <BarcodeScanner onCode={(c) => void lookup(c)} notice={notice} ignoreGtin={failedGtin} />;

  const source = productSource(product);
  const units = loggableUnits(source);
  const unit = chosenUnit && units.includes(chosenUnit) ? chosenUnit : units[0];
  const n = parse(amount);
  const canLog = unit !== undefined && nutritionForAmount(source, n, unit).ok;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canLog || !product) return;
    setSaving(true);
    setError(null);
    try {
      await mealsApi.log({ kind: 'barcode', gtin: product.gtin, amount: n, unit });
      onDone(product.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div>
        <p className="font-semibold">{product.name}</p>
        {product.brand && <p className="text-sm text-muted">{product.brand}</p>}
        <p className="mt-1 text-xs text-muted">Product data: Open Food Facts (ODbL)</p>
      </div>
      {unit !== undefined && <AmountFields source={source} units={units} amount={amount} setAmount={setAmount} unit={unit} setUnit={setChosenUnit} />}
      {error && <Problem>{error}</Problem>}
      <div className="flex gap-3">
        <Button type="submit" disabled={!canLog || saving}>
          {saving ? 'Logging…' : 'Log food'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setProduct(null);
            setChosenUnit(null);
            setAmount('');
            setError(null);
          }}
        >
          Scan another
        </Button>
      </div>
    </form>
  );
}

function QuickAdd({ onDone }: { onDone: (label: string) => void }) {
  const [label, setLabel] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const k = parse(kcal);
    const p = protein.trim() === '' ? 0 : parse(protein);
    if (!label.trim()) return setError('Enter what you ate.');
    if (!Number.isFinite(k) || k < 0) return setError('Enter the calories.');
    if (!Number.isFinite(p) || p < 0) return setError('Protein must be a number of 0 or more.');
    setSaving(true);
    setError(null);
    try {
      await mealsApi.log({ kind: 'quick_add', label: label.trim(), kcal: k, proteinG: p });
      onDone(label.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log that.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <label className="grid gap-1 text-sm font-semibold">
        What did you eat?
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} autoComplete="off" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm font-semibold">
          Calories (kcal)
          <input className={inputClass} inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Protein (g)
          <input className={inputClass} inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </label>
      </div>
      {error && <Problem>{error}</Problem>}
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Logging…' : 'Log food'}
        </Button>
      </div>
    </form>
  );
}

export function LogFoodDialog({ open, onClose, items, onLogged }: { open: boolean; onClose: () => void; items: PantryItem[]; onLogged: (label: string) => void }) {
  const [tab, setTab] = useState<Tab>('pantry');
  return (
    <Dialog open={open} onClose={onClose} title="Log food">
      {/* Rendered only while open, so closing the dialog stops the camera. */}
      {open && (
        <div className="grid gap-4">
          <div role="tablist" aria-label="How to log food" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold ${tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'pantry' && <FromPantry items={items} onDone={onLogged} />}
          {tab === 'scan' && <FromScan onDone={onLogged} />}
          {tab === 'quick' && <QuickAdd onDone={onLogged} />}
          <div>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
