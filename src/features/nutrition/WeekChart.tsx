'use client';

import { useCallback, useState } from 'react';
import type { DailyTotals } from '@/contracts/domain';
import { CHART_COLOR, columnPath, niceCeil, weekdayLabel } from './chart';

// SPEC F15: daily calories for the last 7 days, with the goal as a reference line. One series, so
// the card title names it and there's no legend. Protein is in the tooltip and the table.

const HEIGHT = 200;
const MARGIN = { top: 20, right: 8, bottom: 24, left: 44 };
const MAX_COLUMN = 24;
const INITIAL_WIDTH = 560;

export function WeekChart({ days }: { days: DailyTotals[] }) {
  const [width, setWidth] = useState(INITIAL_WIDTH);
  const [active, setActive] = useState<number | null>(null);

  // A callback ref: the box doesn't exist until the first meal replaces the empty state.
  const observeBox = useCallback((box: HTMLDivElement | null) => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  if (days.every((d) => d.entries === 0)) {
    return <p className="py-10 text-center text-sm text-muted">Log some food to see your week here.</p>;
  }

  const goal = days.at(-1)?.kcalGoal ?? null;
  const top = niceCeil(Math.max(...days.map((d) => d.kcal), goal ?? 0));
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const baseline = HEIGHT - MARGIN.bottom;
  const plotHeight = baseline - MARGIN.top;
  const band = plotWidth / days.length;
  const column = Math.min(MAX_COLUMN, band * 0.6);
  const y = (v: number) => baseline - (v / top) * plotHeight;
  const centerX = (i: number) => MARGIN.left + band * i + band / 2;
  const lastIndex = days.length - 1;
  const shown = active === null ? null : days[active];
  const dayName = (i: number) => (i === lastIndex ? 'Today' : weekdayLabel(days[i].date));

  return (
    <div>
      <div ref={observeBox} className="relative">
        <svg width={width} height={HEIGHT} className="block max-w-full" role="group" aria-label="Calories per day, last 7 days">
          {[0, top / 2, top].map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
                {tick}
              </text>
            </g>
          ))}

          {days.map((d, i) =>
            d.kcal > 0 ? (
              <path
                key={d.date}
                d={columnPath(centerX(i) - column / 2, baseline, column, Math.max(2, baseline - y(d.kcal)))}
                fill={CHART_COLOR}
                opacity={active === null || active === i ? 1 : 0.55}
              />
            ) : null,
          )}

          {goal != null && (
            <g>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(goal)} y2={y(goal)} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 4" />
              <text x={width - MARGIN.right} y={y(goal) - 5} textAnchor="end" fontSize={12} fill="var(--ink)">
                Goal {goal}
              </text>
            </g>
          )}

          {days[lastIndex].kcal > 0 && (
            <text x={centerX(lastIndex)} y={y(days[lastIndex].kcal) - 5} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)">
              {Math.round(days[lastIndex].kcal)}
            </text>
          )}

          {days.map((d, i) => (
            <text key={d.date} x={centerX(i)} y={HEIGHT - 6} textAnchor="middle" fontSize={12} fontWeight={i === lastIndex ? 600 : 400} fill={i === lastIndex ? 'var(--ink)' : 'var(--muted)'}>
              {dayName(i)}
            </text>
          ))}

          {days.map((d, i) => (
            <rect
              key={d.date}
              x={MARGIN.left + band * i}
              y={MARGIN.top}
              width={band}
              height={plotHeight + MARGIN.bottom}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${dayName(i)}: ${Math.round(d.kcal)} kcal, ${Math.round(d.proteinG)} g protein`}
              className="outline-none focus-visible:stroke-[var(--ink)]"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>

        {shown && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={{ left: Math.min(Math.max(centerX(active) - 56, 0), width - 128) }}
          >
            <p className="font-semibold">{dayName(active)}</p>
            <p className="tabular-nums">
              {Math.round(shown.kcal)} kcal · {Math.round(shown.proteinG)} g protein
            </p>
          </div>
        )}
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted">View as table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Calories</th>
              <th className="py-1 font-medium">Protein</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={d.date} className="border-t border-line">
                <td className="py-1">{dayName(i)}</td>
                <td className="py-1">{Math.round(d.kcal)} kcal</td>
                <td className="py-1">{Math.round(d.proteinG)} g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
