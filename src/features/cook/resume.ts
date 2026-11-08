import type { StepTimer } from "@/contracts";

// SPEC F11 recovery: {sessionId, stepIndex, timers, updatedAt} on every change; offer resume if < 12 h old.
const MAX_AGE_MS = 12 * 3600_000;
const key = (sessionId: string) => `mise.cook.${sessionId}`;

export interface SavedCook {
  sessionId: string;
  stepIndex: number;
  timers: StepTimer[];
  updatedAt: number;
}

export function saveCook(s: SavedCook) {
  try {
    localStorage.setItem(key(s.sessionId), JSON.stringify(s));
  } catch {} // private mode / quota: resume is a convenience
}

export function loadCook(sessionId: string, now = Date.now()): SavedCook | null {
  try {
    const s = JSON.parse(localStorage.getItem(key(sessionId)) ?? "null") as SavedCook | null;
    return s && s.sessionId === sessionId && now - s.updatedAt < MAX_AGE_MS ? s : null;
  } catch {
    return null;
  }
}

export function clearCook(sessionId: string) {
  try {
    localStorage.removeItem(key(sessionId));
  } catch {}
}
