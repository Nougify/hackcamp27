import type { RecipeStep, StepTimer } from "@/contracts";
import { createTimer, settleTimers, toggleTimer } from "./timers";

export interface CookState {
  stepIndex: number;
  timers: StepTimer[];
  speaking: boolean;
  /** Countdowns that finished on the last tick; the view rings the alarm for these. */
  fired: StepTimer[];
}

export type CookAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "toggleTimer"; now: number }
  | { type: "tick"; now: number }
  | { type: "speaking"; speaking: boolean }
  | { type: "restore"; stepIndex: number; timers: StepTimer[] };

export function initCookState(stepIndex = 0): CookState {
  return { stepIndex, timers: [], speaking: false, fired: [] };
}

export function makeCookReducer(steps: RecipeStep[]) {
  const last = steps.length - 1;
  return function reduce(s: CookState, a: CookAction): CookState {
    switch (a.type) {
      case "next":
        return s.stepIndex < last ? { ...s, stepIndex: s.stepIndex + 1 } : s;
      case "prev":
        return s.stepIndex > 0 ? { ...s, stepIndex: s.stepIndex - 1 } : s;
      case "toggleTimer": {
        const step = steps[s.stepIndex];
        const existing = s.timers.find((t) => t.stepIndex === s.stepIndex);
        const toggled = toggleTimer(existing ?? createTimer(step.index, step.text, step.timerSeconds), a.now);
        const timers = existing ? s.timers.map((t) => (t === existing ? toggled : t)) : [...s.timers, toggled];
        return { ...s, timers };
      }
      case "tick": {
        const { timers, fired } = settleTimers(s.timers, a.now);
        return fired.length ? { ...s, timers, fired } : s.fired.length ? { ...s, fired: [] } : s;
      }
      case "speaking":
        return { ...s, speaking: a.speaking };
      case "restore":
        return { ...s, stepIndex: Math.min(Math.max(a.stepIndex, 0), last), timers: a.timers };
    }
  };
}
