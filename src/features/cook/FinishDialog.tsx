"use client";

import { useEffect, useState } from "react";
import type { DeductionLine, FinishPreview, FinishResult, UnitDim } from "@/contracts";
import { Badge, Button, Dialog } from "@/components/ui";
import { ApiRequestError, finishSession, getFinishPreview } from "./api";

const UNIT: Record<UnitDim, string> = { mass: "g", volume: "ml", count: "pcs" };
const BASIS_LABEL = {
  estimate: "≈ estimate",
  publisher: "Publisher's nutrition",
  low_coverage_estimate: "≈ rough estimate (low coverage)",
};

type Line = DeductionLine & { checked: boolean; qty: string };

/** A line the user can deduct: matched to a pantry item with a known unit. */
export const deductible = (l: DeductionLine) =>
  l.pantryItemId !== null && l.dim !== null && (l.status === "ok" || l.status === "clamped" || l.status === "unconvertible");

export function toLines(p: FinishPreview): Line[] {
  return p.deductions.map((d) => ({
    ...d,
    // Unconvertible lines start unchecked and empty: the user enters the amount ("Adjust manually").
    checked: deductible(d) && d.status !== "unconvertible",
    qty: d.proposedQtyBase === null || d.status === "unconvertible" ? "" : String(Math.round(d.proposedQtyBase * 10) / 10),
  }));
}

/** SPEC F14 dialog: servings, editable deduction preview, editable nutrition, one confirm. */
export function FinishDialog({
  sessionId,
  servingsPlanned,
  open,
  onClose,
  onFinished,
}: {
  sessionId: string;
  servingsPlanned: number;
  open: boolean;
  onClose: () => void;
  /** null = the session was already finished elsewhere (409). */
  onFinished: (r: FinishResult | null) => void;
}) {
  const [servingsCooked, setServingsCooked] = useState(servingsPlanned);
  const [servingsEaten, setServingsEaten] = useState(1);
  // The plan remembers which servings count it was built for; Confirm needs it to match.
  const [plan, setPlan] = useState<{ servings: number; preview: FinishPreview } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-plan whenever servings cooked changes (debounced). Line edits reset with the new plan.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      getFinishPreview(sessionId, servingsCooked)
        .then((p) => {
          if (cancelled) return;
          setPlan({ servings: servingsCooked, preview: p });
          setLines(toLines(p));
          setKcal(String(Math.round(p.suggestedLogPerServing.kcal)));
          setProtein(String(Math.round(p.suggestedLogPerServing.proteinG)));
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(`Couldn't load the pantry preview: ${e.message}`));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, sessionId, servingsCooked]);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const kcalN = Number(kcal);
  const proteinN = Number(protein);
  const nutritionValid = kcal !== "" && protein !== "" && kcalN >= 0 && proteinN >= 0;
  const preview = plan?.servings === servingsCooked ? plan.preview : null; // null while re-planning or after a failed load
  const valid = preview !== null && (servingsEaten === 0 || nutritionValid);

  async function confirm() {
    if (!preview || !valid) return;
    setSaving(true);
    setError(null);
    const s = preview.suggestedLogPerServing;
    const edited = kcalN !== Math.round(s.kcal) || proteinN !== Math.round(s.proteinG);
    try {
      const result = await finishSession(sessionId, {
        servingsCooked,
        servingsEaten,
        deductions: lines
          .filter((l) => l.checked && l.pantryItemId && Number(l.qty) > 0)
          .map((l) => ({ pantryItemId: l.pantryItemId!, qtyBase: Number(l.qty) })),
        perServingOverride: servingsEaten > 0 && edited ? { kcal: kcalN, proteinG: proteinN } : undefined,
      });
      onFinished(result);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) return onFinished(null);
      setSaving(false);
      setError("Couldn't save. Nothing was changed, so you can try again.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Finish cooking" className="theme-cook max-h-[90dvh] w-[min(44rem,calc(100vw-2rem))]">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stepper label="Servings cooked" value={servingsCooked} min={1} onChange={setServingsCooked} />
        <Stepper label="Servings you ate" value={servingsEaten} min={0} onChange={setServingsEaten} />
      </div>

      <h3 className="mt-6 text-lg font-semibold">Remove from pantry</h3>
      {!preview && !error && <p className="mt-2 text-muted">Working out what you used…</p>}
      <ul className="mt-2 divide-y divide-line">
        {(preview ? lines : []).map((l, i) => (
          <li key={`${l.ingredientRaw}-${i}`} className="flex flex-wrap items-center gap-3 py-3">
            {deductible(l) ? (
              <>
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-6 shrink-0 accent-[var(--accent)]"
                    checked={l.checked}
                    onChange={(e) => update(i, { checked: e.target.checked })}
                  />
                  <span className="min-w-0">
                    <span className="block">{l.status === "unconvertible" ? `${l.pantryItemName ?? l.ingredientRaw} (${l.ingredientRaw})` : l.display}</span>
                    {l.status === "clamped" && <Badge tone="warn">Only {l.availableQtyBase} {UNIT[l.dim!]} left</Badge>}
                    {l.status === "unconvertible" && <Badge tone="warn">Adjust manually</Badge>}
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="sr-only">Amount of {l.pantryItemName ?? l.ingredientRaw} to remove</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={l.availableQtyBase ?? undefined}
                    step="any"
                    value={l.qty}
                    onChange={(e) => update(i, { qty: e.target.value, checked: Number(e.target.value) > 0 })}
                    className="w-24 rounded-lg border border-line bg-surface px-3 py-2 text-right"
                  />
                  <span className="w-8 text-muted">{UNIT[l.dim!]}</span>
                </label>
              </>
            ) : (
              <span className="min-w-0 flex-1 text-muted">
                {l.ingredientRaw}{" "}
                <Badge>{l.status === "staple" ? "Staple" : l.status === "no_match" ? "Not in pantry" : "Adjust manually"}</Badge>
              </span>
            )}
          </li>
        ))}
      </ul>

      {preview && servingsEaten > 0 && (
        <>
          <h3 className="mt-6 flex flex-wrap items-center gap-2 text-lg font-semibold">
            Nutrition per serving <Badge tone="ai">{BASIS_LABEL[preview.suggestedLogPerServing.basis]}</Badge>
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <NumberField label="kcal" value={kcal} onChange={setKcal} />
            <NumberField label="Protein (g)" value={protein} onChange={setProtein} />
          </div>
          {nutritionValid && (
            <p className="mt-2 text-sm text-muted">
              Logs {servingsEaten} serving{servingsEaten === 1 ? "" : "s"} · {Math.round(kcalN * servingsEaten)} kcal ·{" "}
              {Math.round(proteinN * servingsEaten)} g protein
            </p>
          )}
        </>
      )}
      {servingsEaten === 0 && <p className="mt-6 text-muted">Nothing will be logged as eaten. The pantry is still updated.</p>}

      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button size="lg" variant="ghost" onClick={onClose}>
          Keep cooking
        </Button>
        <Button size="lg" onClick={confirm} disabled={!valid || saving}>
          {saving ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </Dialog>
  );
}

function Stepper({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <div>
      <span className="text-sm text-muted">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <Button size="lg" variant="secondary" aria-label={`Fewer: ${label}`} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
          −
        </Button>
        <span className="w-12 text-center text-2xl font-semibold" aria-live="polite">
          {value}
        </span>
        <Button size="lg" variant="secondary" aria-label={`More: ${label}`} onClick={() => onChange(value + 1)}>
          +
        </Button>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-lg"
      />
    </label>
  );
}
