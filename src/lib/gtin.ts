// SPEC F2 / §1.4. Barcode → canonical GTIN. Pure; used by the client scanner and the server.
//
// Rules (team decisions, see docs/johnny-verify.md):
//   - Spaces, hyphens and dots are separators and are removed. Any other non-digit → non_numeric.
//   - UPC-A (12) is left-padded to GTIN-13.
//   - EAN-8 keeps its 8 digits for provider calls (`lookupCode`) and is padded to 13 for `gtin`.
//   - UPC-E (8, number system 0/1) expands to UPC-A, then GTIN-13. A code the scanner reports as
//     upc_e is always expanded; a typed/unknown 8-digit code is EAN-8 if its check digit passes,
//     else UPC-E if that check passes.
//   - GTIN-14 with indicator 0 is the same item as its GTIN-13 and drops the leading 0.

export type GtinInvalidReason = 'length' | 'check_digit' | 'non_numeric';
export type GtinValidation = { ok: true; gtin: string } | { ok: false; reason: GtinInvalidReason };

export type BarcodeFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | 'unknown';
export type GtinKind = 'ean13' | 'upca' | 'ean8' | 'upce' | 'gtin14';

export type BarcodeResult =
  | {
      ok: true;
      /** Canonical 13/14-digit key: products.gtin, pantry_items.gtin, cache key. */
      gtin: string;
      /** Digits to send to barcode providers (the EAN-8 itself for EAN-8, else `gtin`). */
      lookupCode: string;
      kind: GtinKind;
    }
  | { ok: false; reason: GtinInvalidReason };

/** GS1 mod-10 check digit for `body` (all digits except the check digit). */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True when the last digit of an all-digit `code` is its GS1 check digit. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d{2,}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48;
}

/** Expands an 8-digit UPC-E (number system 0 or 1) to 12-digit UPC-A, or null if it can't be one. */
export function expandUpcE(code8: string): string | null {
  if (!/^[01]\d{7}$/.test(code8)) return null;
  const n = code8[0];
  const [d1, d2, d3, d4, d5, d6] = code8.slice(1, 7);
  const check = code8[7];
  let body: string;
  switch (d6) {
    case '0':
    case '1':
    case '2':
      body = `${n}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
      break;
    case '3':
      body = `${n}${d1}${d2}${d3}00000${d4}${d5}`;
      break;
    case '4':
      body = `${n}${d1}${d2}${d3}${d4}00000${d5}`;
      break;
    default:
      body = `${n}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
  return body + check;
}

/** Full normalization with the provider lookup code and the detected kind. */
export function normalizeBarcode(raw: string, format: BarcodeFormat = 'unknown'): BarcodeResult {
  const code = raw.replace(/[\s.-]+/g, '');
  if (code === '') return { ok: false, reason: 'length' };
  if (/\D/.test(code)) return { ok: false, reason: 'non_numeric' };

  switch (code.length) {
    case 8:
      return normalize8(code, format);
    case 12:
      return hasValidCheckDigit(code)
        ? { ok: true, gtin: `0${code}`, lookupCode: `0${code}`, kind: 'upca' }
        : { ok: false, reason: 'check_digit' };
    case 13:
      return hasValidCheckDigit(code)
        ? { ok: true, gtin: code, lookupCode: code, kind: 'ean13' }
        : { ok: false, reason: 'check_digit' };
    case 14: {
      if (!hasValidCheckDigit(code)) return { ok: false, reason: 'check_digit' };
      // Indicator 0: identical item to the GTIN-13 (same check digit, weights align from the right).
      const gtin = code.startsWith('0') ? code.slice(1) : code;
      return { ok: true, gtin, lookupCode: gtin, kind: 'gtin14' };
    }
    default:
      return { ok: false, reason: 'length' };
  }
}

/**
 * Validates a scanned/typed barcode and normalizes it to our canonical GTIN-13/14.
 * Same rules as normalizeBarcode(), without the lookup code and kind.
 */
export function normalizeGtin(raw: string, format: BarcodeFormat = 'unknown'): GtinValidation {
  const r = normalizeBarcode(raw, format);
  return r.ok ? { ok: true, gtin: r.gtin } : r;
}

function normalize8(code: string, format: BarcodeFormat): BarcodeResult {
  const asEan8 = (): BarcodeResult => ({ ok: true, gtin: code.padStart(13, '0'), lookupCode: code, kind: 'ean8' });
  const asUpcE = (): BarcodeResult | null => {
    const upca = expandUpcE(code);
    if (!upca || !hasValidCheckDigit(upca)) return null;
    return { ok: true, gtin: `0${upca}`, lookupCode: `0${upca}`, kind: 'upce' };
  };

  if (format === 'upc_e') return asUpcE() ?? { ok: false, reason: 'check_digit' };
  if (hasValidCheckDigit(code)) return asEan8();
  if (format === 'ean_8') return { ok: false, reason: 'check_digit' };
  return asUpcE() ?? { ok: false, reason: 'check_digit' };
}
