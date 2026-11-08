import type { CSSProperties } from 'react';
import type { MatchStatus } from '@/contracts/domain';
import { Badge } from '@/components/ui';

// "Have" gets its own green, closer to how shoppers read a pantry match than the shared accent tone.
const HAVE_STYLE: CSSProperties = { backgroundColor: 'var(--success-soft)', color: 'var(--success)' };

const MARKERS: Record<MatchStatus, { label: string; tone: 'accent' | 'danger' | 'neutral' | 'warn'; style?: CSSProperties }> = {
  have: { label: 'Have', tone: 'accent', style: HAVE_STYLE },
  missing: { label: 'Missing', tone: 'danger' },
  staple: { label: 'Staple', tone: 'neutral' },
  insufficient: { label: 'Low', tone: 'warn' },
};

export function MatchMarker({ status }: { status: MatchStatus }) {
  const m = MARKERS[status];
  return (
    <Badge tone={m.tone} style={m.style}>
      {m.label}
    </Badge>
  );
}

export function daysLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}
