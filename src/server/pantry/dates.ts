// Calendar-date helpers in the user's time zone (SPEC F5 AC3, F15 local_date). Pure.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date ('YYYY-MM-DD') in IANA time zone `tz`. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** True for a real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Whole calendar days from `from` to `to` (both 'YYYY-MM-DD'). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Days from today (in `tz`) until `isoDate`. 0 = today, negative = past date. */
export function daysUntil(isoDate: string, tz: string, now: Date = new Date()): number {
  return daysBetween(todayInTz(tz, now), isoDate);
}

/** 'YYYY-MM-DD' shifted by `days`. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
