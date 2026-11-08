// Geometry for the hand-rolled /today charts. Pure.

/** Passes the chart palette validator on the app's surfaces; the --accent token reads too gray. */
export const CHART_COLOR = '#2e8540';

/** Smallest 1/2/5 × 10ⁿ at or above `value`, so the top axis label is a round number. */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** A column with a rounded data-end and a square baseline. */
export function columnPath(x: number, baseline: number, width: number, height: number, radius = 4): string {
  const r = Math.min(radius, width / 2, height);
  const top = baseline - height;
  return [
    `M${x},${baseline}`,
    `V${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `H${x + width - r}`,
    `Q${x + width},${top} ${x + width},${top + r}`,
    `V${baseline}`,
    'Z',
  ].join(' ');
}

/** Stroke offset that leaves `value / goal` of a ring drawn; a value past the goal fills it. */
export function ringOffset(circumference: number, value: number, goal: number): number {
  const fraction = goal > 0 ? Math.min(1, Math.max(0, value / goal)) : 0;
  return circumference * (1 - fraction);
}

/** "Mon" for a calendar date, without any time zone shift. */
export function weekdayLabel(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`));
}
