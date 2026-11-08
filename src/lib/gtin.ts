export type GtinInvalidReason = 'length' | 'check_digit' | 'non_numeric';
export type GtinValidation = { ok: true; gtin: string } | { ok: false; reason: GtinInvalidReason };

const VALID_LENGTHS = [8, 12, 13, 14];

/** GS1 mod-10 check digit: weight 3 on the digit immediately left of the check digit, alternating. */
function hasValidCheckDigit(digits: string): boolean {
  const nums = digits.split('').map(Number);
  const check = nums[nums.length - 1]!;
  const payload = nums.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const fromRight = payload.length - 1 - i;
    const weight = fromRight % 2 === 0 ? 3 : 1;
    sum += payload[i]! * weight;
  }
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === check;
}

/**
 * Validates a scanned/typed barcode and normalizes it to our canonical
 * GTIN-13/14 (EAN-8 and UPC-A are left-padded with zeros to 13 digits).
 */
export function normalizeGtin(raw: string): GtinValidation {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return { ok: false, reason: 'non_numeric' };
  if (!VALID_LENGTHS.includes(trimmed.length)) return { ok: false, reason: 'length' };
  if (!hasValidCheckDigit(trimmed)) return { ok: false, reason: 'check_digit' };
  const gtin = trimmed.length === 14 ? trimmed : trimmed.padStart(13, '0');
  return { ok: true, gtin };
}
