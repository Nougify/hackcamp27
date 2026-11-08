#!/usr/bin/env node
// Self-hosts third-party WASM/model assets so the browser never fetches
// camera/vision code from a CDN (see SPEC.md §13 "Camera and video").
import { cp, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const copies = [
  {
    from: path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm'),
    to: path.join(root, 'public/mediapipe/wasm'),
  },
  {
    from: path.join(root, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'),
    to: path.join(root, 'public/zxing/zxing_reader.wasm'),
  },
];

for (const { from, to } of copies) {
  try {
    await access(from);
  } catch {
    console.warn(`[copy-assets] skipping missing source: ${from}`);
    continue;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`[copy-assets] ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

// public/models/gesture_recognizer.task is downloaded once by a human and
// committed to the repo (§10.6) — not fetched here.
