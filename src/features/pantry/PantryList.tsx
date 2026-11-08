'use client';

import { useCallback, useState } from 'react';
import type { CreatePantryItemRequest } from '@/contracts/api';
import type { PantryItem } from '@/contracts/domain';
import { Badge, Button, Card, Dialog, useToast } from '@/components/ui';
import { fromBase } from '@/lib/units';
import { pantryApi } from './api';
import { BAND_CLASSES, expiryInfo } from './expiry';
import { ALLERGEN_LABELS, UNIT_LABELS } from './labels';
import { itemNutritionLines } from './nutrition-text';
import { ProductForm, type ProductFormValues } from './ProductForm';

// SPEC F5 + F10 (item part): pantry list sorted by soonest best-before, colour band + text,
// inline adjust / discard / edit / delete. Empty items are hidden.

type Sort = 'expiry' | 'name';

const withoutFloatNoise = (n: number | null) => (n === null ? null : Number(n.toFixed(6)));

export function PantryList({ initialItems, graceDays, addSlot }: { initialItems: PantryItem[]; graceDays: number; addSlot?: React.ReactNode }) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [sort, setSort] = useState<Sort>('expiry');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const [deleting, setDeleting] = useState<PantryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (next: { sort: Sort }) => {
    setLoading(true);
    setError(null);
    try {
      setItems((await pantryApi.list(next)).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your pantry.');
    } finally {
      setLoading(false);
    }
  }, []);

  const view = { sort };
  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await action();
      toast(done);
      await reload(view);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  async function addManual(v: ProductFormValues) {
    const body: CreatePantryItemRequest = { ...v, gtin: null, source: 'manual', userVerified: true };
    await pantryApi.create(body);
    setAdding(false);
    toast(`Added ${v.name}`);
    await reload(view);
  }

  async function saveEdit(item: PantryItem, v: ProductFormValues) {
    await pantryApi.update(item.id, {
      name: v.name,
      brand: v.brand,
      quantity: v.quantity,
      displayUnit: v.displayUnit,
      gramsPerUnit: v.gramsPerUnit,
      densityGPerMl: v.densityGPerMl,
      // Only send the expiry when it changed, so the stored source and printed text
      // ("BB/MA 2026 NO 15") survive unrelated edits.
      ...(v.expiryDate !== item.expiryDate
        ? { expiryDate: v.expiryDate, expirySource: v.expirySource, expiryRawText: v.expiryRawText }
        : {}),
      nutritionBasis: v.nutritionBasis,
      nutrition: v.nutrition,
      servingSizeBase: v.servingSizeBase,
      allergenTags: v.allergenTags,
      userVerified: true,
    });
    setEditing(null);
    toast(`Saved ${v.name}`);
    await reload(view);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {addSlot}
        <Button variant={addSlot ? 'secondary' : 'primary'} onClick={() => setAdding(true)}>
          Add manually
        </Button>
        <label className="ml-auto flex min-h-11 items-center gap-2 text-sm">
          Sort
          <select
            className="min-h-11 rounded-xl border border-line bg-surface px-3"
            value={sort}
            onChange={(e) => {
              const s = e.target.value as Sort;
              setSort(s);
              void reload({ sort: s });
            }}
          >
            <option value="expiry">Best before (soonest first)</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-muted" aria-live="polite">Loading your pantry…</p>}

      {items.length === 0 && !loading ? (
        <Card>
          <p className="font-semibold">Your pantry is empty.</p>
          <p className="mt-1 text-sm text-muted">Scan a barcode or add an item by hand to get started.</p>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {items.map((item) => (
            <PantryRow
              key={item.id}
              item={item}
              graceDays={graceDays}
              onAdjust={(quantity) => run(() => pantryApi.update(item.id, { quantity, adjustReason: 'manual_adjust' }), `Updated ${item.name}`)}
              onDiscard={() => run(() => pantryApi.update(item.id, { adjustReason: 'discard' }), `Discarded ${item.name}`)}
              onRestock={() => run(() => pantryApi.restock(item.id), `Restocked ${item.name}`)}
              onEdit={() => setEditing(item)}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </ul>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add an item">
        {adding && <ProductForm submitLabel="Add to pantry" onSubmit={addManual} onCancel={() => setAdding(false)} />}
      </Dialog>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : 'Edit'}>
        {editing && (
          <ProductForm
            key={editing.id}
            initial={{
              ...editing,
              quantity: withoutFloatNoise(fromBase(editing.quantityBase, editing.dim, editing.displayUnit)),
              expiryRawText: null,
            }}
            allowZeroQuantity
            submitLabel="Save changes"
            onSubmit={(v) => saveEdit(editing, v)}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title="Delete item?">
        {deleting && (
          <div className="grid gap-4">
            <p>
              Delete <strong>{deleting.name}</strong> from your pantry? Meals you already logged keep their nutrition.
            </p>
            <div className="flex gap-3">
              <Button
                variant="danger"
                onClick={() => {
                  const d = deleting;
                  setDeleting(null);
                  void run(() => pantryApi.remove(d.id), `Deleted ${d.name}`);
                }}
              >
                Delete
              </Button>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function PantryRow({
  item,
  graceDays,
  onAdjust,
  onDiscard,
  onRestock,
  onEdit,
  onDelete,
}: {
  item: PantryItem;
  graceDays: number;
  onAdjust: (quantity: number) => Promise<void>;
  onDiscard: () => Promise<void>;
  onRestock: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const info = expiryInfo(item.expiryDate, item.daysToExpiry, graceDays);
  const band = BAND_CLASSES[info.band];
  const empty = item.quantityBase <= 0;
  const current = fromBase(item.quantityBase, item.dim, item.displayUnit) ?? 0;
  const [adjusting, setAdjusting] = useState(false);
  const prefill = String(Math.round(current * 100) / 100);
  const [value, setValue] = useState(prefill);
  const nutrition = itemNutritionLines(item);

  return (
    <li className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${band.stripe}`} />
      <div className="grid gap-2 py-4 pl-5 pr-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {item.name}
              {item.brand && <span className="font-normal text-muted"> · {item.brand}</span>}
            </p>
            <p className="text-sm">
              {empty ? <span className="font-semibold text-muted">Empty</span> : item.quantityDisplay}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${band.badge}`}>{info.text}</span>
        </div>

        {nutrition.map((line) => (
          <p key={line} className="text-xs text-muted">
            {line}
          </p>
        ))}
        {item.allergenTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.allergenTags.map((a) => (
              <Badge key={a}>Contains {ALLERGEN_LABELS[a].split(' (')[0].toLowerCase()}</Badge>
            ))}
          </div>
        )}
        {(item.source === 'openfoodfacts' || item.source === 'dataandapis') && (
          <p className="text-xs text-muted">Product data: Open Food Facts (ODbL)</p>
        )}

        {adjusting ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (value.trim() === prefill) return setAdjusting(false); // the prefill is rounded; saving it would change the stock
              const q = value.trim() === '' ? Number.NaN : Number(value.replace(',', '.'));
              if (!Number.isFinite(q) || q < 0) return;
              await onAdjust(q);
              setAdjusting(false);
            }}
          >
            <label className="flex items-center gap-2 text-sm">
              Now have
              <input
                className="min-h-11 w-28 rounded-xl border border-line bg-surface px-3"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
              {UNIT_LABELS[item.displayUnit]}
            </label>
            <Button type="submit">Save</Button>
            <Button variant="ghost" onClick={() => setAdjusting(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {empty ? (
              <Button variant="secondary" onClick={() => void onRestock()}>
                Restock
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setValue(prefill);
                    setAdjusting(true);
                  }}
                >
                  Adjust
                </Button>
                <Button variant="secondary" onClick={() => void onDiscard()}>
                  Discard
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="ghost" onClick={onDelete}>
              Delete
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}
