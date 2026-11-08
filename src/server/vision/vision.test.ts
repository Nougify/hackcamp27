import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabelExtraction } from '@/lib/gemini/schemas';
import { assembleDate, parseCfia, regexCrossCheck, type DateComponents } from './date';
import { buildLabelResponse, macrosConsistent } from './label';

const geminiJson = vi.hoisted(() => vi.fn());
vi.mock('@/lib/gemini/client', () => ({ geminiJson }));
vi.mock('@/lib/current-user', () => ({
  requireUser: async () => ({ id: `user-${Math.random()}`, tz: 'America/Vancouver' }),
}));

const date = (over: Partial<DateComponents>): DateComponents => ({
  raw_text: null,
  date_type: 'best_before',
  year: null,
  month: 11,
  day: 15,
  year_was_printed: false,
  ambiguous_order: false,
  confidence: 'high',
  ...over,
});

describe('CFIA regex', () => {
  it('reads year-first dates, MA as May and AL as April', () => {
    expect(parseCfia('2026 NO 15')).toEqual([{ year: 2026, month: 11, day: 15 }]);
    expect(parseCfia('26 MA 03')).toEqual([{ year: 2026, month: 5, day: 3 }]);
    expect(parseCfia('AL 09')).toEqual([{ year: null, month: 4, day: 9 }]);
    expect(parseCfia('26 mr 03')).toEqual([{ year: 2026, month: 3, day: 3 }]);
  });

  it('does not read the bilingual BB/MA marker as May', () => {
    expect(parseCfia('BB/MA NO 15')).toEqual([{ year: null, month: 11, day: 15 }]);
    expect(parseCfia('BB/MA 2026 NO 15')).toEqual([{ year: 2026, month: 11, day: 15 }]);
    expect(parseCfia('BB/MA 26 NO 15')).toEqual([{ year: 2026, month: 11, day: 15 }]);
  });

  it('needs a real month code and day', () => {
    expect(parseCfia('LOT 4471')).toEqual([]);
    expect(parseCfia('NORTH 12')).toEqual([]);
    expect(parseCfia('NO 45')).toEqual([]);
  });

  it('cross-checks raw text against the components', () => {
    expect(regexCrossCheck(date({ raw_text: 'BB/MA NO 15' }))).toBe('agree');
    expect(regexCrossCheck(date({ raw_text: 'BB/MA OC 15' }))).toBe('disagree');
    expect(regexCrossCheck(date({ raw_text: '2027 NO 15', year: 2026, year_was_printed: true }))).toBe('disagree');
    expect(regexCrossCheck(date({ raw_text: 'EXP 11/15/26' }))).toBe('no_match');
    expect(regexCrossCheck(date({ raw_text: null }))).toBe('no_match');
  });
});

describe('assembleDate', () => {
  it('caps rawText at the length the pantry schema accepts', () => {
    expect(assembleDate(date({ raw_text: 'x'.repeat(300) }), '2026-11-07').rawText).toHaveLength(200);
  });

  it('uses a printed year', () => {
    const r = assembleDate(date({ year: 2026, year_was_printed: true }), '2026-11-07');
    expect(r).toMatchObject({ suggestedDate: '2026-11-15', yearInferred: false, needsUserChoice: false, candidates: ['2026-11-15'] });
  });

  it('expands a two-digit year', () => {
    expect(assembleDate(date({ year: 27, year_was_printed: true }), '2026-11-07').suggestedDate).toBe('2027-11-15');
  });

  it('infers a missing year as the next occurrence', () => {
    expect(assembleDate(date({}), '2026-11-07')).toMatchObject({ suggestedDate: '2026-11-15', yearInferred: true });
    expect(assembleDate(date({}), '2026-11-20')).toMatchObject({ suggestedDate: '2027-11-15', yearInferred: true });
  });

  it('infers across year end and keeps a date of today in this year', () => {
    expect(assembleDate(date({ month: 1, day: 5 }), '2026-12-28').suggestedDate).toBe('2027-01-05');
    expect(assembleDate(date({}), '2026-11-15').suggestedDate).toBe('2026-11-15');
  });

  it('ignores a year Gemini says was not printed', () => {
    expect(assembleDate(date({ year: 2030, year_was_printed: false }), '2026-11-07')).toMatchObject({ suggestedDate: '2026-11-15', yearInferred: true });
  });

  it('finds the next leap day when the year is missing', () => {
    expect(assembleDate(date({ month: 2, day: 29 }), '2026-11-07').suggestedDate).toBe('2028-02-29');
  });

  it('offers both orders when ambiguous', () => {
    const r = assembleDate(date({ year: 2027, year_was_printed: true, month: 5, day: 6, ambiguous_order: true, raw_text: '05/06/27' }), '2026-11-07');
    expect(r.candidates).toEqual(['2027-05-06', '2027-06-05']);
    expect(r.needsUserChoice).toBe(true);
  });

  it('needs no choice when only one order is a real date, or both are the same', () => {
    expect(assembleDate(date({ year: 2027, year_was_printed: true, month: 5, day: 26, ambiguous_order: true }), '2026-11-07')).toMatchObject({
      candidates: ['2027-05-26'],
      needsUserChoice: false,
    });
    expect(assembleDate(date({ year: 2027, year_was_printed: true, month: 5, day: 5, ambiguous_order: true }), '2026-11-07').candidates).toEqual(['2027-05-05']);
  });

  it('rejects dates more than 5 years ahead or 1 year past', () => {
    const today = '2026-11-07';
    expect(assembleDate(date({ year: 2031, month: 11, day: 8, year_was_printed: true }), today).suggestedDate).toBeNull();
    expect(assembleDate(date({ year: 2031, month: 11, day: 7, year_was_printed: true }), today).suggestedDate).toBe('2031-11-07');
    expect(assembleDate(date({ year: 2025, month: 11, day: 6, year_was_printed: true }), today).suggestedDate).toBeNull();
    expect(assembleDate(date({ year: 2025, month: 11, day: 7, year_was_printed: true }), today).suggestedDate).toBe('2025-11-07');
  });

  it('rejects impossible dates', () => {
    expect(assembleDate(date({ year: 2027, month: 2, day: 31, year_was_printed: true }), '2026-11-07').suggestedDate).toBeNull();
  });

  it('never suggests a packaged-on date', () => {
    const r = assembleDate(date({ date_type: 'packaged_on', year: 2026, year_was_printed: true, raw_text: 'PKD 2026 NO 15' }), '2026-11-07');
    expect(r).toMatchObject({ dateType: 'packaged_on', suggestedDate: null, candidates: [], needsUserChoice: false, rawText: 'PKD 2026 NO 15' });
  });

  it('returns nothing for a partial date', () => {
    expect(assembleDate(date({ day: null }), '2026-11-07')).toMatchObject({ suggestedDate: null, candidates: [] });
  });
});

const label = (over: Partial<LabelExtraction> = {}): LabelExtraction => ({
  is_food_product: true,
  name: 'Oat cereal',
  brand: 'Acme',
  nutrition_panel_visible: true,
  package_quantity_value: 500,
  package_quantity_unit: 'g',
  serving_size_text: '1 cup (40 g)',
  serving_size_value: 40,
  serving_size_unit: 'g',
  basis: 'per_serving',
  calories_kcal: 150,
  fat_g: 2,
  carbohydrate_g: 27,
  protein_g: 5,
  confidence: 'high',
  notes: null,
  ...over,
});

describe('label checks', () => {
  it('passes a clean Canadian per-serving panel', () => {
    const r = buildLabelResponse(label(), 'm', null);
    expect(r.draft).toMatchObject({ basis: 'serving', servingSize: { value: 40, unit: 'g' }, packageQuantity: { value: 500, unit: 'g' }, source: 'gemini_photo' });
    expect(r.draft.nutrients).toMatchObject({ energyKcal: 150, fatG: 2, carbohydrateG: 27, proteinG: 5 });
    expect(r.flaggedFields).toEqual([]);
    expect(r.macrosConsistent).toBe(true);
  });

  it('flags inconsistent macros', () => {
    const r = buildLabelResponse(label({ calories_kcal: 500 }), 'm', null);
    expect(r.macrosConsistent).toBe(false);
    expect(r.flaggedFields.toSorted()).toEqual(['carbohydrateG', 'energyKcal', 'fatG', 'proteinG']);
  });

  it('checks macros at the ±20% boundary and tolerates tiny values', () => {
    const n = { proteinG: 0, carbohydrateG: 25, fatG: 0 };
    expect(macrosConsistent({ ...n, energyKcal: 125 })).toBe(true);
    expect(macrosConsistent({ ...n, energyKcal: 83 })).toBe(false);
    expect(macrosConsistent({ energyKcal: 0, proteinG: 0, carbohydrateG: 0.5, fatG: 0 })).toBe(true);
    expect(macrosConsistent({ energyKcal: null, proteinG: 0, carbohydrateG: 0, fatG: 0 })).toBeNull();
  });

  it('removes and flags negative values', () => {
    const r = buildLabelResponse(label({ fat_g: -2 }), 'm', null);
    expect(r.draft.nutrients.fatG).toBeNull();
    expect(r.flaggedFields).toContain('fatG');
    expect(r.macrosConsistent).toBeNull();
  });

  it('flags an implausible or missing serving', () => {
    expect(buildLabelResponse(label({ serving_size_value: 1500 }), 'm', null)).toMatchObject({ draft: { servingSize: null }, flaggedFields: ['servingSize'] });
    expect(buildLabelResponse(label({ serving_size_value: null, serving_size_unit: null, serving_size_text: null }), 'm', null).flaggedFields).toEqual(['servingSize']);
  });

  it('converts kJ-only labels and flags the result', () => {
    const r = buildLabelResponse(label({ calories_kcal: null, notes: 'Only 418.4 kJ printed' }), 'm', null);
    expect(r.draft.nutrients.energyKcal).toBe(100);
    expect(r.flaggedFields).toContain('energyKcal');
  });

  it('flags everything on an unknown basis', () => {
    const r = buildLabelResponse(label({ basis: 'unknown' }), 'm', null);
    expect(r.draft.basis).toBe('serving');
    expect(r.flaggedFields).toEqual(expect.arrayContaining(['servingSize', 'energyKcal', 'fatG']));
  });

  it('maps per-100 bases and package units', () => {
    expect(buildLabelResponse(label({ basis: 'per_100ml' }), 'm', null).draft.basis).toBe('100ml');
    expect(buildLabelResponse(label({ package_quantity_unit: 'count', package_quantity_value: 12 }), 'm', null).draft.packageQuantity).toEqual({ value: 12, unit: 'pcs' });
  });

  it('flags a missing name but not on non-food photos', () => {
    expect(buildLabelResponse(label({ name: null }), 'm', null).flaggedFields).toContain('name');
    expect(buildLabelResponse(label({ name: null, is_food_product: false }), 'm', null)).toMatchObject({ isFoodProduct: false, flaggedFields: [] });
  });

  it('takes the scanned GTIN first, then a valid printed one', () => {
    expect(buildLabelResponse(label({ barcode_digits_if_visible: '3017620422003' }), 'm', '4006381333931').draft.gtin).toBe('4006381333931');
    expect(buildLabelResponse(label({ barcode_digits_if_visible: '3017620422003' }), 'm', null).draft.gtin).toBe('3017620422003');
    expect(buildLabelResponse(label({ barcode_digits_if_visible: '123' }), 'm', null).draft.gtin).toBeNull();
  });
});

describe('vision routes', () => {
  beforeEach(() => {
    geminiJson.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  function upload(path: string, field: string, sizes: number[], type = 'image/jpeg') {
    const form = new FormData();
    for (const size of sizes) form.append(field, new File([new Uint8Array(size)], 'a.jpg', { type }));
    return new Request(`http://localhost${path}`, { method: 'POST', body: form });
  }

  const MB = 1024 * 1024;

  it('rejects images over 4 MB with 413, more than 3 with 400, and bad types with 400 (F3 AC4)', async () => {
    const { POST } = await import('@/app/api/vision/label/route');
    expect((await POST(upload('/api/vision/label', 'images', [5 * MB]))).status).toBe(413);
    expect((await POST(upload('/api/vision/label', 'images', [1, 1, 1, 1]))).status).toBe(400);
    expect((await POST(upload('/api/vision/label', 'images', [1], 'application/pdf'))).status).toBe(400);
    expect((await POST(upload('/api/vision/label', 'images', []))).status).toBe(400);
    expect(geminiJson).not.toHaveBeenCalled();
  });

  it('accepts exactly 4 MB and returns the checked draft', async () => {
    geminiJson.mockResolvedValue({ data: label(), model: 'gemini-test' });
    const { POST } = await import('@/app/api/vision/label/route');
    const res = await POST(upload('/api/vision/label', 'images', [4 * MB]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isFoodProduct: true, model: 'gemini-test', draft: { source: 'gemini_photo' } });
    expect(geminiJson.mock.calls[0][0].images[0].mimeType).toBe('image/jpeg');
  });

  it('reports a Gemini failure as a 502 without the photo', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    geminiJson.mockRejectedValue(new Error('boom'));
    const { POST } = await import('@/app/api/vision/expiry/route');
    const res = await POST(upload('/api/vision/expiry', 'image', [1]));
    expect(res.status).toBe(502);
    expect(log).toHaveBeenCalledWith('[vision] extraction failed:', 'boom');
    expect(JSON.stringify(await res.json())).not.toContain('boom');
  });

  it('allows one expiry photo only', async () => {
    const { POST } = await import('@/app/api/vision/expiry/route');
    expect((await POST(upload('/api/vision/expiry', 'image', [1, 1]))).status).toBe(400);
  });
});
