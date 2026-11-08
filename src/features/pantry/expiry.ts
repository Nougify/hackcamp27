// SPEC F5 / §12 rules 5 & 9: expiry colour band plus text ("colour is never the only cue"), and
// "Best before" wording (team decision: always "Best before"). Grace days (UserProfile
// pastBestBeforeGraceDays, team decision 2026-11-08): an item up to N days past its date still
// counts as usable, so it gets the amber band instead of red. Pure; used on client and server.

export type ExpiryBand = 'expired' | 'grace' | 'soon' | 'week' | 'later' | 'none';

export interface ExpiryInfo {
  band: ExpiryBand;
  /** e.g. "Best before Nov 15 · 2 days", "Best before today", "Past best before · 3 days ago" */
  text: string;
  /** true when the item still counts as usable (not expired beyond grace). */
  usable: boolean;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** 'Nov 15' (or 'Nov 15, 2027' when not in `currentYear`). Formats the calendar date, no time zone shift. */
export function formatBestBeforeDate(isoDate: string, currentYear: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(y !== currentYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

export function expiryInfo(
  expiryDate: string | null,
  daysToExpiry: number | null,
  graceDays = 0,
  currentYear: number = new Date().getFullYear(),
): ExpiryInfo {
  if (expiryDate == null || daysToExpiry == null) return { band: 'none', text: 'No date', usable: true };
  const grace = Math.max(0, Math.floor(graceDays));
  if (daysToExpiry < 0) {
    const ago = -daysToExpiry;
    const text = `Past best before · ${plural(ago, 'day')} ago`;
    return ago <= grace ? { band: 'grace', text, usable: true } : { band: 'expired', text, usable: false };
  }
  if (daysToExpiry === 0) return { band: 'soon', text: 'Best before today', usable: true };
  const when = `Best before ${formatBestBeforeDate(expiryDate, currentYear)} · ${plural(daysToExpiry, 'day')}`;
  if (daysToExpiry <= 3) return { band: 'soon', text: when, usable: true };
  if (daysToExpiry <= 7) return { band: 'week', text: when, usable: true };
  return { band: 'later', text: when, usable: true };
}

/** "Expiring soon" on /today: due within 3 days, or past the date but within the grace period. */
export function isExpiringSoon(daysToExpiry: number | null, graceDays = 0): boolean {
  if (daysToExpiry == null) return false;
  return daysToExpiry <= 3 && daysToExpiry >= -Math.max(0, Math.floor(graceDays));
}

/** Tailwind classes per band. Red / amber / yellow / neutral (F5). Yellow uses Tailwind's palette
 *  because the shared design tokens have no yellow; text always accompanies the colour. */
export const BAND_CLASSES: Record<ExpiryBand, { stripe: string; badge: string }> = {
  expired: { stripe: 'bg-danger', badge: 'bg-danger-soft text-danger' },
  grace: { stripe: 'bg-warn', badge: 'bg-warn-soft text-warn' },
  soon: { stripe: 'bg-warn', badge: 'bg-warn-soft text-warn' },
  week: { stripe: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-900' },
  later: { stripe: 'bg-line', badge: 'bg-surface-2 text-muted' },
  none: { stripe: 'bg-line', badge: 'bg-surface-2 text-muted' },
};
