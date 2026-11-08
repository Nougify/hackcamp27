import { describe, expect, it } from 'vitest';
import { expandUpcE, gs1CheckDigit, hasValidCheckDigit, normalizeBarcode, normalizeGtin } from './gtin';

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

  // Team decision (docs/johnny-verify.md): indicator-0 GTIN-14 is the same item as its GTIN-13.
  it('collapses an indicator-0 GTIN-14 to GTIN-13', () => {
    expect(normalizeGtin('00036000291452')).toEqual({ ok: true, gtin: '0036000291452' });
  });

  it('accepts a valid GTIN-14 with indicator 1-9 unchanged', () => {
    expect(normalizeGtin('10036000291459')).toEqual({ ok: true, gtin: '10036000291459' });
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

describe("check digit", () => {
  it("computes GS1 mod-10", () => {
    expect(gs1CheckDigit("301762042200")).toBe(3); // Nutella 3017620422003
    expect(gs1CheckDigit("03600029145")).toBe(2); // UPC-A 036000291452
    expect(gs1CheckDigit("9638507")).toBe(4); // EAN-8 96385074
  });
  it("validates", () => {
    expect(hasValidCheckDigit("3017620422003")).toBe(true);
    expect(hasValidCheckDigit("3017620422004")).toBe(false);
    expect(hasValidCheckDigit("abc")).toBe(false);
  });
});

describe("normalizeBarcode", () => {
  it("valid EAN-13 stays as-is", () => {
    expect(normalizeBarcode("3017620422003")).toEqual({ ok: true, gtin: "3017620422003", lookupCode: "3017620422003", kind: "ean13" });
  });

  it("UPC-A is left-padded to GTIN-13 (F2 AC2)", () => {
    expect(normalizeBarcode("036000291452")).toEqual({ ok: true, gtin: "0036000291452", lookupCode: "0036000291452", kind: "upca" });
  });

  it("EAN-8 keeps 8 digits for lookup and pads the key to 13", () => {
    expect(normalizeBarcode("96385074")).toEqual({ ok: true, gtin: "0000096385074", lookupCode: "96385074", kind: "ean8" });
    expect(normalizeBarcode("96385074", "ean_8")).toMatchObject({ ok: true, kind: "ean8" });
  });

  it("bad check digit (F2 AC2)", () => {
    expect(normalizeBarcode("3017620422004")).toEqual({ ok: false, reason: "check_digit" });
    expect(normalizeBarcode("036000291453")).toEqual({ ok: false, reason: "check_digit" });
    expect(normalizeBarcode("96385075", "ean_8")).toEqual({ ok: false, reason: "check_digit" });
  });

  it("non-numeric: separators are removed, letters are rejected", () => {
    expect(normalizeBarcode(" 3017 6204-22003 ")).toMatchObject({ ok: true, gtin: "3017620422003" });
    expect(normalizeBarcode("3017.6204.22003")).toMatchObject({ ok: true, gtin: "3017620422003" });
    expect(normalizeBarcode("30176204x22003")).toEqual({ ok: false, reason: "non_numeric" });
    expect(normalizeBarcode("abc")).toEqual({ ok: false, reason: "non_numeric" });
  });

  it("wrong lengths", () => {
    for (const s of ["", "   ", "1234567", "123456789", "12345678901", "123456789012345"]) {
      expect(normalizeBarcode(s)).toEqual({ ok: false, reason: "length" });
    }
  });

  it("GTIN-14: indicator 0 collapses to GTIN-13, others stay 14", () => {
    expect(normalizeBarcode("03017620422003")).toEqual({ ok: true, gtin: "3017620422003", lookupCode: "3017620422003", kind: "gtin14" });
    const body = "1301762042200";
    const g14 = body + gs1CheckDigit(body);
    expect(normalizeBarcode(g14)).toEqual({ ok: true, gtin: g14, lookupCode: g14, kind: "gtin14" });
    expect(normalizeBarcode(body + ((gs1CheckDigit(body) + 1) % 10))).toEqual({ ok: false, reason: "check_digit" });
  });

  it("every canonical gtin matches the products.gtin CHECK (^[0-9]{13,14}$)", () => {
    for (const s of ["3017620422003", "036000291452", "96385074", "04252614", "03017620422003"]) {
      const r = normalizeBarcode(s);
      expect(r.ok && /^[0-9]{13,14}$/.test(r.gtin)).toBe(true);
    }
  });
});

describe("UPC-E", () => {
  it("expands per GS1 rules for each last-digit case", () => {
    expect(expandUpcE("04252614")).toBe("042100005264"); // d6 = 1
    expect(expandUpcE("01234505")).toBe("012000003455"); // d6 = 0 → 0 1 2 0 0000 3 4 5 + check 5
    expect(expandUpcE("01234531")).toBe("012300000451"); // d6 = 3
    expect(expandUpcE("01234541")).toBe("012340000051"); // d6 = 4
    expect(expandUpcE("01234567")).toBe("012345000067"); // d6 = 6
  });

  it("only number system 0 or 1", () => {
    expect(expandUpcE("24252614")).toBeNull();
    expect(expandUpcE("0425261")).toBeNull();
  });

  it("scanner-reported upc_e is expanded to GTIN-13", () => {
    expect(normalizeBarcode("04252614", "upc_e")).toEqual({ ok: true, gtin: "0042100005264", lookupCode: "0042100005264", kind: "upce" });
  });

  it("scanner-reported upc_e with a bad check digit is rejected", () => {
    expect(normalizeBarcode("04252615", "upc_e")).toEqual({ ok: false, reason: "check_digit" });
  });

  it("typed 8 digits: EAN-8 first, UPC-E when only that check passes", () => {
    // 04252614 fails the EAN-8 check but passes as UPC-E.
    expect(hasValidCheckDigit("04252614")).toBe(false);
    expect(normalizeBarcode("04252614")).toMatchObject({ ok: true, kind: "upce", gtin: "0042100005264" });
    // 96385074 is a valid EAN-8 (and starts with 9, so it can't be UPC-E anyway).
    expect(normalizeBarcode("96385074")).toMatchObject({ ok: true, kind: "ean8" });
  });
});
