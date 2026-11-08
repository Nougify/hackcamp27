import { describe, expect, it } from 'vitest';
import { expiryInfo, formatBestBeforeDate, isExpiringSoon } from './expiry';

describe('expiryInfo (F5 AC1, AC3)', () => {
  const Y = 2026;
  it('no date', () => {
    expect(expiryInfo(null, null, 0, Y)).toEqual({ band: 'none', text: 'No date', usable: true });
  });
  it('today shows 0 days as "Best before today"', () => {
    expect(expiryInfo('2026-11-08', 0, 0, Y)).toEqual({ band: 'soon', text: 'Best before today', usable: true });
  });
  it('≤3 days amber, ≤7 yellow, later neutral, with date text', () => {
    expect(expiryInfo('2026-11-10', 2, 0, Y)).toEqual({ band: 'soon', text: 'Best before Nov 10 · 2 days', usable: true });
    expect(expiryInfo('2026-11-09', 1, 0, Y).text).toBe('Best before Nov 9 · 1 day');
    expect(expiryInfo('2026-11-15', 7, 0, Y).band).toBe('week');
    expect(expiryInfo('2026-11-18', 10, 0, Y)).toEqual({ band: 'later', text: 'Best before Nov 18 · 10 days', usable: true });
  });
  it('past dates are red unless within the grace period', () => {
    expect(expiryInfo('2026-11-07', -1, 0, Y)).toEqual({ band: 'expired', text: 'Past best before · 1 day ago', usable: false });
    expect(expiryInfo('2026-11-06', -2, 3, Y)).toEqual({ band: 'grace', text: 'Past best before · 2 days ago', usable: true });
    expect(expiryInfo('2026-11-05', -3, 3, Y).band).toBe('grace');
    expect(expiryInfo('2026-11-04', -4, 3, Y).band).toBe('expired');
  });
  it('shows the year when it is not the current year', () => {
    expect(formatBestBeforeDate('2027-01-02', 2026)).toBe('Jan 2, 2027');
    expect(formatBestBeforeDate('2026-12-31', 2026)).toBe('Dec 31');
  });
});

describe('isExpiringSoon', () => {
  it('0..3 days by default; past dates only within grace', () => {
    expect([3, 0, 4, -1, null].map((d) => isExpiringSoon(d))).toEqual([true, true, false, false, false]);
    expect([-1, -2, -3].map((d) => isExpiringSoon(d, 2))).toEqual([true, true, false]);
  });
});
