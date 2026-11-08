// Copies self-hosted WASM into public/ so the browser never loads it from a CDN (SPEC §10.6, §13).
// Runs on postinstall and prebuild. The gesture model is committed at public/models/ instead.
import { cpSync, mkdirSync } from 'node:fs';

const copies = [
  ['node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm'],
  ['node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'public/zxing/zxing_reader.wasm'],
];

for (const [from, to] of copies) {
  mkdirSync(to.endsWith('.wasm') ? to.slice(0, to.lastIndexOf('/')) : to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`copy-assets: ${from} -> ${to}`);
}
