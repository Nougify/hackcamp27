import type { MatchStatus } from '@/contracts/domain';
import { Badge } from '@/components/ui/primitives';

const MARKERS: Record<MatchStatus, { label: string; tone: 'good' | 'bad' | 'neutral' | 'warn' }> = {
  have: { label: 'Have', tone: 'good' },
  missing: { label: 'Missing', tone: 'bad' },
  staple: { label: 'Staple', tone: 'neutral' },
  insufficient: { label: 'Low', tone: 'warn' },
};

export function MatchMarker({ status }: { status: MatchStatus }) {
  const m = MARKERS[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function daysLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}
