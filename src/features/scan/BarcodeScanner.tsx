'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { normalizeBarcode, type BarcodeResult } from '@/lib/gtin';
import { getDetector } from './detector';
import { asBarcodeFormat, createReadConfirmer } from './pure';

// SPEC F2 scanner. Load through next/dynamic with ssr:false. The typed input is always visible, so
// the flow works with no camera at all.

export type ScannedCode = Extract<BarcodeResult, { ok: true }>;

const SCAN_INTERVAL_MS = 150;
const INVALID = "That barcode doesn't look valid";

/** Native select arrow, rendered manually so it sits cleanly inside the rounded field. */
const CHEVRON_STYLE = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%23716354' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.75rem center',
  backgroundSize: '1rem',
} as const;

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Camera access is blocked. Allow it in your browser, or type the barcode below.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found. Type the barcode below, or use a photo.';
  return "The camera isn't available. Type the barcode below, or use a photo.";
}

/** `ignoreGtin`: the camera skips this code and keeps scanning (it just failed and may still be in view). Typing it still works. */
export function BarcodeScanner({ onCode, notice, ignoreGtin = null }: { onCode: (code: ScannedCode) => void; notice?: string | null; ignoreGtin?: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onCodeRef = useRef(onCode);
  const ignoreRef = useRef(ignoreGtin);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    onCodeRef.current = onCode;
    ignoreRef.current = ignoreGtin;
  }, [onCode, ignoreGtin]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const video = videoRef.current;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera API');
        const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size },
        });
        if (cancelled || !video) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        await video.play();
        if (cancelled) return;

        setCameraMessage(null);
        const track = s.getVideoTracks()[0] ?? null;
        trackRef.current = track;
        setTorch({ available: Boolean((track?.getCapabilities?.() as TorchCapabilities | undefined)?.torch), on: false });
        // Device labels are only readable once permission has been granted.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));

        const detector = await getDetector();
        const confirmRead = createReadConfirmer(2);
        const tick = async () => {
          if (cancelled) return;
          try {
            if (video.readyState >= 2) {
              const codes = await detector.detect(video);
              if (cancelled) return;
              for (const code of codes) {
                // A failed check digit here is a misread: keep scanning without bothering the user.
                const result = normalizeBarcode(code.rawValue, asBarcodeFormat(code.format));
                if (result.ok && result.gtin !== ignoreRef.current && confirmRead(code.rawValue)) {
                  onCodeRef.current(result);
                  return;
                }
              }
            }
          } catch {
            // A frame that can't be decoded is not an error; try the next one.
          }
          timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
        };
        void tick();
      } catch (err) {
        if (!cancelled) setCameraMessage(cameraError(err));
      }
    }

    void start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      if (video) video.srcObject = null;
    };
  }, [deviceId]);

  async function toggleTorch() {
    const next = !torch.on;
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      setTorch((t) => ({ ...t, available: false }));
    }
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    if (typed.trim() === '') return;
    const result = normalizeBarcode(typed);
    if (result.ok) onCode(result);
    else setMessage(INVALID);
  }

  async function readPhoto(file: File) {
    setMessage(null);
    setReading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const detector = await getDetector();
      const codes = await detector.detect(bitmap);
      bitmap.close();
      if (codes.length === 0) return setMessage('No barcode found in that photo. Try again closer up, or type it below.');
      const result = normalizeBarcode(codes[0].rawValue, asBarcodeFormat(codes[0].format));
      if (result.ok) onCode(result);
      else setMessage(INVALID);
    } catch {
      setMessage("We couldn't read that photo. Try again, or type the barcode below.");
    } finally {
      setReading(false);
    }
  }

  const shown = message ?? notice ?? null;

  return (
    <div className="grid gap-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-ink">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline muted aria-label="Camera preview for scanning a barcode" />
        {cameraMessage ? (
          <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">{cameraMessage}</p>
        ) : (
          <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/70" />
        )}
      </div>

      {(devices.length > 1 || torch.available) && (
        <div className="flex flex-wrap items-center gap-3">
          {devices.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              Camera
              <select
                className="min-h-11 max-w-60 appearance-none rounded-xl border border-line bg-surface pl-3 pr-9"
                style={CHEVRON_STYLE}
                value={deviceId ?? ''}
                onChange={(e) => setDeviceId(e.target.value || null)}
              >
                <option value="">Default</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {torch.available && (
            <Button variant="secondary" aria-pressed={torch.on} onClick={() => void toggleTorch()}>
              {torch.on ? 'Torch off' : 'Torch on'}
            </Button>
          )}
        </div>
      )}

      <form onSubmit={submitTyped} className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-52 flex-1 gap-1 text-sm font-semibold">
          Type barcode
          <input
            className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
            inputMode="numeric"
            autoComplete="off"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setMessage(null);
            }}
          />
        </label>
        <Button type="submit">Look up</Button>
      </form>

      <label className="text-sm">
        <span className="font-semibold text-accent underline">{reading ? 'Reading photo…' : 'Use a photo of the barcode instead'}</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={reading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void readPhoto(file);
          }}
        />
      </label>

      {shown && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {shown}
        </p>
      )}
    </div>
  );
}
