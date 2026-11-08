"use client";

import type { GestureConfig } from "@/contracts";
import { Button, Dialog } from "@/components/ui";
import { DEFAULT_PREFS, type CookPrefs } from "./settings";

const SENSITIVITY = { low: 0.8, normal: 0.7, high: 0.6 } as const; // minScore: higher sensitivity = lower bar
const HOLD = { short: 500, normal: 800, long: 1200 } as const;

const pick = <T extends Record<string, number>>(m: T, v: number) =>
  (Object.entries(m).reduce((best, [k, x]) => (Math.abs(x - v) < Math.abs(m[best] - v) ? k : best), Object.keys(m)[0]) as keyof T);

/** Cook-mode settings (SPEC §11: Sensitivity, Hold time, Always armed), saved per device. */
export function GestureSettings({
  open,
  onClose,
  prefs,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  prefs: CookPrefs;
  onChange: (p: CookPrefs) => void;
}) {
  const g = prefs.gesture;
  const setG = (patch: Partial<GestureConfig>) => onChange({ ...prefs, gesture: { ...g, ...patch } });

  return (
    <Dialog open={open} onClose={onClose} title="Cook mode settings" className="theme-cook">
      <div className="grid gap-5">
        <Field label="Gesture sensitivity" hint="Lower it if gestures fire by accident.">
          <Select
            value={pick(SENSITIVITY, g.minScore)}
            options={{ low: "Low", normal: "Normal", high: "High" }}
            onChange={(k) => setG({ minScore: SENSITIVITY[k], fistMinScore: Math.min(0.9, SENSITIVITY[k] + 0.1) })}
          />
        </Field>

        <Field label="Hold time" hint="How long to hold a point, 🤟, fist or victory sign.">
          <Select
            value={pick(HOLD, g.actionHoldMs)}
            options={{ short: "Short (0.5 s)", normal: "Normal (0.8 s)", long: "Long (1.2 s)" }}
            onChange={(k) => setG({ actionHoldMs: HOLD[k], armHoldMs: Math.round(HOLD[k] * 0.75) })}
          />
        </Field>

        <Check
          label="Always armed"
          hint="Skip the open-palm step. Stirring may trigger actions."
          checked={g.alwaysArmed}
          onChange={(v) => setG({ alwaysArmed: v })}
        />
        <Check label="Show camera preview" checked={prefs.showCamera} onChange={(v) => onChange({ ...prefs, showCamera: v })} />
        <Check label="Read each step aloud automatically" checked={prefs.autoRead} onChange={(v) => onChange({ ...prefs, autoRead: v })} />

        <Field label="Processor" hint="Applies the next time hands-free starts. Try CPU if gestures feel laggy.">
          <Select value={g.delegate} options={{ GPU: "GPU", CPU: "CPU" }} onChange={(k) => setG({ delegate: k })} />
        </Field>
      </div>

      <div className="mt-6 flex justify-between gap-3">
        <Button variant="ghost" onClick={() => onChange(DEFAULT_PREFS)}>Reset to defaults</Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="font-semibold">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

function Select<K extends string>({ value, options, onChange }: { value: K; options: Record<K, string>; onChange: (k: K) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as K)}
      className="min-h-11 rounded-lg border border-line bg-surface px-3 text-ink"
    >
      {(Object.entries(options) as [K, string][]).map(([k, label]) => (
        <option key={k} value={k}>{label}</option>
      ))}
    </select>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 size-5 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-semibold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}
