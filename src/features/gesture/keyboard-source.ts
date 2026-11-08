import type { GestureAction, GestureHud, GestureSource } from "@/contracts";

// Phase 0 mock (SPEC §11.8): digit keys 1–8 emit the 8 GestureActions in contract order,
// so cook mode can be driven through the gesture path before MediaPipe works.
const KEYS: GestureAction[] = ["ARM", "DISARM", "NEXT_STEP", "PREV_STEP", "SCROLL_UP", "SCROLL_DOWN", "TIMER_TOGGLE", "SPEAK_TOGGLE"];

export class KeyboardGestureSource implements GestureSource {
  private actionCbs = new Set<(a: GestureAction) => void>();
  private hudCbs = new Set<(h: GestureHud) => void>();
  private armed = false;

  private onKey = (e: KeyboardEvent) => {
    const el = e.target instanceof Element ? e.target : null;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || el?.closest("input, textarea, select, [contenteditable]")) return;
    const action = KEYS[Number(e.key) - 1];
    if (!action) return;
    if (action === "ARM") this.armed = true;
    if (action === "DISARM") this.armed = false;
    this.actionCbs.forEach((cb) => cb(action));
    this.hudCbs.forEach((cb) =>
      cb({
        state: this.armed ? "armed" : "hand_seen",
        pose: "None",
        holdProgress: 0,
        pendingAction: null,
        armedRemainingMs: this.armed ? 5000 : 0,
        lastAction: { action, at: Date.now() },
        hint: null,
        fps: 0,
      }),
    );
  };

  async start() {
    window.addEventListener("keydown", this.onKey);
  }

  stop() {
    window.removeEventListener("keydown", this.onKey);
  }

  onAction(cb: (a: GestureAction) => void) {
    this.actionCbs.add(cb);
    return () => void this.actionCbs.delete(cb);
  }

  onHud(cb: (h: GestureHud) => void) {
    this.hudCbs.add(cb);
    return () => void this.hudCbs.delete(cb);
  }
}
