'use client';

import { useState } from 'react';
import type { ExpiryExtractionResponse } from '@/contracts/api';
import { Badge, Button, Dialog } from '@/components/ui';
import type { AppliedExpiry } from '@/features/pantry/ProductForm';
import { formatBestBeforeDate } from '@/features/pantry/expiry';
import { scanApi } from './api';
import { PhotoCapture } from './PhotoCapture';

// SPEC UF4 / F4: a date read from a photo is only a suggestion. The user confirms it here, and a
// packaged-on date is never offered as a best-before date.

export function ExpiryCapture({ onConfirm }: { onConfirm: (expiry: AppliedExpiry) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExpiryExtractionResponse | null>(null);
  const [date, setDate] = useState('');

  function reset() {
    setResult(null);
    setDate('');
    setError(null);
  }

  async function read(photos: Blob[]) {
    setBusy(true);
    setError(null);
    try {
      const r = await scanApi.readExpiry(photos[0]);
      setResult(r);
      setDate(r.needsUserChoice ? '' : (r.suggestedDate ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't read that photo.");
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!result) return;
    const wasRead = result.candidates.includes(date);
    onConfirm({ date, source: wasRead ? 'photo' : 'manual', rawText: wasRead ? result.rawText : null });
    setOpen(false);
    reset();
  }

  const year = new Date().getFullYear();
  const packaged = result?.dateType === 'packaged_on';

  return (
    <>
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Photo of date
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          if (busy) return;
          setOpen(false);
          reset();
        }}
        title="Best-before date"
      >
        {/* This dialog sits inside ProductForm's <form>: Enter here must not submit that form. */}
        <div
          className="grid gap-4"
          onKeyDown={(e) => {
            // Skip the file input: Enter there must still open the picker.
            if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'file') e.preventDefault();
          }}
        >
          {result && <Badge tone="ai">Read by AI, please confirm</Badge>}
          {!result && <PhotoCapture max={1} busy={busy} addLabel="Take a close photo" submitLabel="Read date" onSubmit={(p) => void read(p)} />}

          {result && packaged && (
            <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2 text-sm">
              This is a packaged-on date, not an expiry
            </p>
          )}

          {result?.rawText && (
            <p className="text-sm text-muted">
              Read: <code className="rounded bg-surface-2 px-1">{result.rawText}</code>
            </p>
          )}

          {result && !packaged && (
            <>
              {result.needsUserChoice && (
                <fieldset className="grid gap-1">
                  <legend className="mb-1 text-sm font-semibold">This date could be read two ways. Which is right?</legend>
                  {result.candidates.map((c) => (
                    <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="radio" name="expiry-candidate" checked={date === c} onChange={() => setDate(c)} />
                      {formatBestBeforeDate(c, year)}
                    </label>
                  ))}
                </fieldset>
              )}
              {!result.suggestedDate && <p className="text-sm">We couldn&apos;t work out a date from that photo. Enter it below.</p>}
              <label className="grid max-w-52 gap-1 text-sm font-semibold">
                Best before
                <input
                  type="date"
                  className="min-h-11 rounded-xl border border-line bg-surface px-3 text-ink"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              {result.yearInferred && <p className="text-sm text-muted">No year was printed, so this assumes the next time that date comes up.</p>}
              {(result.regexCrossCheck === 'disagree' || result.confidence === 'low') && (
                <p className="text-sm text-muted">We&apos;re not sure about this one. Check it against the package.</p>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {result && (
            <div className="flex flex-wrap gap-3">
              {!packaged && (
                <Button disabled={!date} onClick={confirm}>
                  Confirm date
                </Button>
              )}
              <Button variant="secondary" onClick={reset}>
                Try another photo
              </Button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
