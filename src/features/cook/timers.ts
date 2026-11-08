import type { StepTimer } from "@/contracts";

// SPEC F11: lower bound of a range, compound durations summed ("1 hour 15 minutes").
const DURATION = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/gi;
const UNIT_S: Record<string, number> = { s: 1, m: 60, h: 3600 };

/** Seconds from the first duration in the step text, or null when it names none.
 *  Only adjacent parts are summed ("1 hour 15 minutes", "1 hour and 15 minutes"), so
 *  "bake 20 minutes, then rest 5 minutes" is 20 minutes, not 25. */
export function parseDurationSeconds(text: string): number | null {
  let total = 0;
  let lastEnd = -1;
  for (const m of text.matchAll(DURATION)) {
    if (lastEnd >= 0 && !/^\s*(?:and\s*)?$/i.test(text.slice(lastEnd, m.index))) break;
    total += Number(m[1]) * UNIT_S[m[3][0].toLowerCase()];
    lastEnd = m.index + m[0].length;
  }
  return total > 0 ? Math.round(total) : null;
}

/** Countdown when the step has a duration, stopwatch otherwise. Starts idle. */
export function createTimer(stepIndex: number, stepText: string, timerSeconds: number | null): StepTimer {
  const secs = timerSeconds ?? parseDurationSeconds(stepText);
  const label = `Step ${stepIndex + 1} · ${stepText.length > 28 ? stepText.slice(0, 27).trimEnd() + "…" : stepText}`;
  return {
    id: `step-${stepIndex}`,
    label,
    stepIndex,
    kind: secs ? "countdown" : "stopwatch",
    durationMs: secs ? secs * 1000 : null,
    endsAt: null,
    startedAt: null,
    pausedRemainingMs: null,
    pausedElapsedMs: null,
    status: "idle",
  };
}

/** Running → paused, anything else → running. `done` restarts from the full duration. */
export function toggleTimer(t: StepTimer, now: number): StepTimer {
  if (t.status === "running") {
    return t.kind === "countdown"
      ? { ...t, status: "paused", endsAt: null, pausedRemainingMs: Math.max(0, t.endsAt! - now) }
      : { ...t, status: "paused", startedAt: null, pausedElapsedMs: now - t.startedAt! };
  }
  if (t.kind === "countdown") {
    const remaining = t.status === "paused" ? t.pausedRemainingMs! : t.durationMs!;
    return { ...t, status: "running", endsAt: now + remaining, pausedRemainingMs: null };
  }
  const elapsed = t.status === "paused" ? t.pausedElapsedMs! : 0;
  return { ...t, status: "running", startedAt: now - elapsed, pausedElapsedMs: null };
}

/** Countdown: ms left. Stopwatch: ms elapsed. Always derived from absolute times. */
export function timerMs(t: StepTimer, now: number): number {
  if (t.kind === "countdown") {
    if (t.status === "running") return Math.max(0, t.endsAt! - now);
    if (t.status === "paused") return t.pausedRemainingMs!;
    return t.status === "done" ? 0 : t.durationMs!;
  }
  if (t.status === "running") return now - t.startedAt!;
  return t.pausedElapsedMs ?? 0;
}

/** Marks running countdowns whose endsAt has passed as done. Returns the ones that just finished. */
export function settleTimers(timers: StepTimer[], now: number): { timers: StepTimer[]; fired: StepTimer[] } {
  const fired: StepTimer[] = [];
  const next = timers.map((t) => {
    if (t.kind === "countdown" && t.status === "running" && t.endsAt! <= now) {
      const done = { ...t, status: "done" as const, endsAt: null };
      fired.push(done);
      return done;
    }
    return t;
  });
  return { timers: fired.length ? next : timers, fired };
}

export function formatMs(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
