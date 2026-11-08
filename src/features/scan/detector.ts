// SPEC F2: the native BarcodeDetector where it reads EAN-13, otherwise the ZXing ponyfill with its
// WASM served from our own origin (no CDN, §10.6).

export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export interface DetectedCode {
  rawValue: string;
  format: string;
}

export interface Detector {
  detect(source: ImageBitmapSource): Promise<DetectedCode[]>;
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

async function nativeDetector(): Promise<Detector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = await Native.getSupportedFormats();
    if (!supported.includes('ean_13')) return null;
    return new Native({ formats: BARCODE_FORMATS.filter((f) => supported.includes(f)) });
  } catch {
    return null;
  }
}

async function ponyfillDetector(): Promise<Detector> {
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : `${prefix}${path}`),
    },
  });
  return new BarcodeDetector({ formats: [...BARCODE_FORMATS] });
}

let detector: Promise<Detector> | null = null;

export function getDetector(): Promise<Detector> {
  detector ??= nativeDetector()
    .then((native) => native ?? ponyfillDetector())
    .catch((err: unknown) => {
      detector = null; // allow a retry after a failed WASM load
      throw err;
    });
  return detector;
}
