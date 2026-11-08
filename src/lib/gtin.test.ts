import { describe, expect, it } from 'vitest';
import { normalizeGtin } from './gtin';

describe('normalizeGtin', () => {
  it('accepts a valid EAN-13 unchanged', () => {
    expect(normalizeGtin('5901234123457')).toEqual({ ok: true, gtin: '5901234123457' });
  });

  it('pads a valid UPC-A to GTIN-13', () => {
    expect(normalizeGtin('036000291452')).toEqual({ ok: true, gtin: '0036000291452' });
  });

  it('pads a valid EAN-8 to GTIN-13', () => {
    expect(normalizeGtin('96385074')).toEqual({ ok: true, gtin: '0000096385074' });
  });

  it('accepts a valid GTIN-14 unchanged', () => {
    expect(normalizeGtin('00036000291452')).toEqual({ ok: true, gtin: '00036000291452' });
  });

  it('rejects a bad check digit', () => {
    expect(normalizeGtin('5901234123450')).toEqual({ ok: false, reason: 'check_digit' });
  });

  it('rejects the wrong length', () => {
    expect(normalizeGtin('123456789')).toEqual({ ok: false, reason: 'length' });
  });

  it('rejects non-numeric input', () => {
    expect(normalizeGtin('590123412345X')).toEqual({ ok: false, reason: 'non_numeric' });
  });

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeGtin('  5901234123457  ')).toEqual({ ok: true, gtin: '5901234123457' });
  });
});
