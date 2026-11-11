'use client';

import { useId, useState } from 'react';
import type { ReceiptExtractionResponse } from '@/contracts/api';
import type { DisplayUnit } from '@/contracts/domain';
import { Badge, Button, Card } from '@/components/ui';
import { UNIT_LABELS } from '@/features/pantry/labels';

// Scan-receipt review: a lightweight editable list, not a full ProductForm per row — receipts
// carry no nutrition/allergen data, and a full form per line would be unusable for a long
// receipt. "Remove" covers both misreads and items bought for someone else. Nothing is added
// to the pantry until "Add N items" is pressed.

const UNITS = Object.keys(UNIT_LABELS) as DisplayUnit[];

export interface ReceiptLineInput {
  name: string;
  quantity: number;
  displayUnit: DisplayUnit;
}

interface Row {
  id: string;
  name: string;
  quantity: string;
  displayUnit: DisplayUnit;
}

let nextId = 0;

export function ReceiptReview({
  response,
  onConfirm,
  onCancel,
}: {
  response: ReceiptExtractionResponse;
  onConfirm: (items: ReceiptLineInput[]) => Promise<{ failedNames: string[] }>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [rows, setRows] = useState<Row[]>(() =>
    response.items.map((item) => ({
      id: `${id}-${nextId++}`,
      name: item.name,
      quantity: String(item.quantity ?? 1),
      displayUnit: item.displayUnit,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const removeRow = (rowId: string) => setRows((rs) => rs.filter((r) => r.id !== rowId));
  const updateRow = (rowId: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed: ReceiptLineInput[] = [];
    for (const row of rows) {
      const name = row.name.trim();
      const quantity = Number(row.quantity.trim().replace(',', '.'));
      if (!name) return setError('Every item needs a name, or remove it.');
      if (!Number.isFinite(quantity) || quantity <= 0) return setError(`Enter a quantity greater than 0 for "${name}".`);
      parsed.push({ name, quantity, displayUnit: row.displayUnit });
    }
    if (parsed.length === 0) return setError('Add at least one item, or cancel.');

    setSaving(true);
    try {
      const { failedNames } = await onConfirm(parsed);
      if (failedNames.length > 0) {
        setRows((rs) => rs.filter((r) => failedNames.includes(r.name.trim())));
        setError(`Couldn't add: ${failedNames.join(', ')}. The rest were added — try these again.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-semibold">Items from your receipt</h2>
          <Badge tone="ai">Read by AI, please confirm</Badge>
        </div>
        {response.nonFoodCount > 0 && (
          <p className="text-sm text-muted">
            {response.nonFoodCount} non-food {response.nonFoodCount === 1 ? 'line' : 'lines'} (tax, bags, deposits, …) were left out.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="text-sm text-muted">No items left. Add them manually instead, or cancel.</p>
        ) : (
          <div className="grid gap-3">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
                <label className="grid min-w-40 flex-1 gap-1 text-sm">
                  Name
                  <input
                    className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
                    value={row.name}
                    onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    maxLength={120}
                  />
                </label>
                <label className="grid w-24 gap-1 text-sm">
                  Qty
                  <input
                    aria-label={`Quantity for ${row.name || 'item'}`}
                    className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                  />
                </label>
                <label className="grid w-28 gap-1 text-sm">
                  Unit
                  <select
                    aria-label={`Unit for ${row.name || 'item'}`}
                    className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
                    value={row.displayUnit}
                    onChange={(e) => updateRow(row.id, { displayUnit: e.target.value as DisplayUnit })}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="button" variant="ghost" onClick={() => removeRow(row.id)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving || rows.length === 0}>
            {saving ? 'Adding…' : `Add ${rows.length} item${rows.length === 1 ? '' : 's'} to pantry`}
          </Button>
          {onCancel && (
            <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
