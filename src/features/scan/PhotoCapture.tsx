'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { fitWithin } from './pure';

// SPEC UF3: photos are downscaled in the browser before upload and never kept.

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

async function downscale(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // e.g. HEIC outside Safari: let the server accept or refuse the original
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', JPEG_QUALITY));
}

interface Shot {
  url: string;
  file: File;
}

export function PhotoCapture({
  max,
  busy,
  addLabel,
  submitLabel,
  onSubmit,
}: {
  max: number;
  busy: boolean;
  addLabel: string;
  submitLabel: string;
  onSubmit: (photos: Blob[]) => void;
}) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [preparing, setPreparing] = useState(false);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const live = urls.current;
    return () => live.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  function add(files: FileList | null) {
    const room = Math.max(0, max - shots.length);
    const added = Array.from(files ?? [])
      .slice(0, room)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    added.forEach((s) => urls.current.add(s.url));
    setShots((xs) => [...xs, ...added]);
  }

  function remove(shot: Shot) {
    URL.revokeObjectURL(shot.url);
    urls.current.delete(shot.url);
    setShots((xs) => xs.filter((x) => x !== shot));
  }

  async function submit() {
    setPreparing(true);
    try {
      onSubmit(await Promise.all(shots.map((s) => downscale(s.file))));
    } finally {
      setPreparing(false);
    }
  }

  const working = busy || preparing;

  return (
    <div className="grid gap-4">
      {shots.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {shots.map((s, i) => (
            <li key={s.url} className="grid gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img src={s.url} alt={`Photo ${i + 1}`} className="h-28 w-28 rounded-xl object-cover" />
              <Button variant="ghost" disabled={working} onClick={() => remove(s)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {shots.length < max && (
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold">
            {addLabel}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={working}
              onChange={(e) => {
                add(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
        <Button disabled={shots.length === 0 || working} onClick={() => void submit()}>
          {working ? 'Reading…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
