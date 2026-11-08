import { CHART_COLOR, ringOffset } from './chart';

// SPEC F15: a progress ring against a goal. With no goal set it shows the total only.

const SIZE = 132;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Ring({ label, value, goal, unit }: { label: string; value: number; goal: number | null; unit: string }) {
  const shown = Math.round(value);
  const center = (
    <>
      <span className="font-display text-3xl font-semibold leading-none tabular-nums">{shown}</span>
      <span className="mt-1 text-xs leading-none text-muted">{unit}</span>
    </>
  );

  if (goal == null) {
    // No ring to fit inside here, so the number can run much bigger, with the unit sitting
    // on its baseline instead of stacked underneath.
    return (
      <div className="grid justify-items-center gap-2 py-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-6xl font-semibold leading-none tracking-tighter tabular-nums">{shown}</span>
          <span className="text-lg leading-none text-muted">{unit}</span>
        </div>
        <p className="mt-2 text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted">No goal set</p>
      </div>
    );
  }

  const over = Math.round(value - goal);
  return (
    <div className="grid justify-items-center gap-2">
      <div className="relative h-[132px] w-[132px]">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label}: ${shown} of ${goal} ${unit}`} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--line)" strokeWidth={STROKE} />
          {value > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={CHART_COLOR}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={ringOffset(CIRCUMFERENCE, value, goal)}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-content-center justify-items-center">{center}</div>
      </div>
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-muted tabular-nums">{over > 0 ? `${over} ${unit} over goal` : `of ${goal} ${unit}`}</p>
    </div>
  );
}
