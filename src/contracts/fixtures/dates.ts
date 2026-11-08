/** Small date helper shared only by fixtures — not the real pantry expiry logic (owned by B). */
export function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysToExpiry(isoDate: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(isoDate + 'T00:00:00Z');
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
