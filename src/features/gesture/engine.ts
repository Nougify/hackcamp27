import type { CannedGesture, GestureAction, GestureConfig, GestureHud } from '@/contracts';

/** Minimal GestureRecognizerResult-like input. Landmarks are normalized, unmirrored camera coords. */
export type EngineFrame = {
  hand: null | {
    landmarks: Array<{ x: number; y: number }>;
    gesture: CannedGesture;
    score: number;
  };
  /** Camera frame width / height; landmarks are normalized per axis. Default 4/3. */
  aspect?: number;
};

type Snapshot = Omit<GestureHud, 'fps' | 'error'>;

const DISCRETE: Partial<Record<CannedGesture, GestureAction>> = {
  Closed_Fist: 'TIMER_TOGGLE',
  Victory: 'SPEAK_TOGGLE',
  Pointing_Up: 'NEXT_STEP', // built-in classifier gestures (custom point detection didn't work on real input)
  ILoveYou: 'PREV_STEP',
};
const SCROLL: Partial<Record<CannedGesture, GestureAction>> = {
  Thumb_Up: 'SCROLL_UP',
  Thumb_Down: 'SCROLL_DOWN',
};
const EDGE = 0.01;
const MORE_LIGHT_MS = 3000;
const SCROLL_RELEASE_COOLDOWN_MS = 300;
// A new pose must persist this long before it counts, so one jittery frame can't break a hold (≈2 frames at 15 fps).
const POSE_SETTLE_MS = 150;
// Next/previous poses must be held still: an index finger on a knife spine while chopping moves, and restarts the hold.
const STILL: Partial<Record<CannedGesture, true>> = { Pointing_Up: true, ILoveYou: true };
const STILL_MAX_DRIFT = 0.05; // index-tip movement allowed during the hold (fraction of frame height; x scaled by aspect)

export class GestureEngine {
  private cfg: GestureConfig;
  private present = false;       // a valid hand was seen and not yet lost >= releaseMs
  private lastSeen = 0;
  private pose: CannedGesture = 'None';
  private poseSince = 0;
  private cand: CannedGesture = 'None'; // raw pose waiting to settle
  private candSince = 0;
  private anchor: { x: number; y: number } | null = null; // index tip where a STILL hold started
  private fired = false;         // one-shot latch per continuous pose hold (ARM or discrete action)
  private needRelease = false;   // discrete pose action fired; pose must change before re-arming
  private cooldownUntil = 0;
  private armedUntil = 0;        // 0 = not armed
  private nextScroll: number | null = null;
  private scrolled = false;
  private lastAction: Snapshot['lastAction'] = null;
  private hint: Snapshot['hint'] = null;
  private lowSince: number | null = null;

  constructor(config: GestureConfig) {
    this.cfg = config;
  }

  setConfig(c: GestureConfig): void {
    this.cfg = c;
  }

  reset(): void {
    this.present = false;
    this.lastSeen = 0;
    this.pose = 'None';
    this.poseSince = 0;
    this.cand = 'None';
    this.candSince = 0;
    this.anchor = null;
    this.fired = false;
    this.needRelease = false;
    this.cooldownUntil = 0;
    this.armedUntil = 0;
    this.nextScroll = null;
    this.scrolled = false;
    this.lastAction = null;
    this.hint = null;
    this.lowSince = null;
  }

  update(frame: EngineFrame, now: number): GestureAction[] {
    const c = this.cfg;
    const out: GestureAction[] = [];
    const emit = (a: GestureAction) => {
      out.push(a);
      this.lastAction = { action: a, at: now };
    };

    // Expiry. A hold already in progress is allowed to finish (it extends the window).
    if (!c.alwaysArmed && this.armedUntil > 0 && now > this.armedUntil && !this.isHolding(now)) {
      this.armedUntil = 0;
      emit('DISARM');
    }

    const h = frame.hand;
    let hint: Snapshot['hint'] = null;
    let valid = false;
    if (h) {
      const ys = h.landmarks.map((p) => p.y);
      const tall = Math.max(...ys) - Math.min(...ys) >= c.minHandHeightFrac;
      const edge = h.landmarks.some(
        (p) => p.x < EDGE || p.x > 1 - EDGE || p.y < EDGE || p.y > 1 - EDGE,
      );
      if (!tall) hint = 'move_closer';
      valid = tall && !edge;
    }

    if (!h || !valid) {
      this.lowSince = null;
      if (this.present && now - this.lastSeen >= c.releaseMs) this.lose(now);
      this.hint = hint;
      return out;
    }
    this.present = true;
    this.lastSeen = now;

    const low = h.score < c.minScore;
    this.lowSince = low ? (this.lowSince ?? now) : null;
    if (this.lowSince !== null && now - this.lowSince >= MORE_LIGHT_MS) hint = 'more_light';
    this.hint = hint;

    const raw: CannedGesture = low || (h.gesture === 'Closed_Fist' && h.score < c.fistMinScore) ? 'None' : h.gesture;
    if (raw !== this.cand) {
      this.cand = raw;
      this.candSince = now;
    }
    if (this.cand !== this.pose && now - this.candSince >= POSE_SETTLE_MS) {
      if (this.scrolled) this.cooldownUntil = Math.max(this.cooldownUntil, now + SCROLL_RELEASE_COOLDOWN_MS);
      this.scrolled = false;
      this.nextScroll = null;
      this.needRelease = false;
      this.fired = false;
      this.anchor = null; // e.g. Pointing_Up → ILoveYou: don't measure drift from the old hold
      this.pose = this.cand;
      this.poseSince = this.candSince; // hold timing counts from when the pose first appeared
    }
    const pose = this.pose;
    // Debouncing only protects the latch; actions need the pose to be showing right now.
    const steady = raw === pose;

    if (STILL[pose] && steady) {
      const tip = h.landmarks[8];
      if (!this.anchor) this.anchor = tip;
      else if (!this.fired && Math.hypot((tip.x - this.anchor.x) * (frame.aspect ?? 4 / 3), tip.y - this.anchor.y) > STILL_MAX_DRIFT) {
        this.anchor = tip;
        this.poseSince = now; // moved: start the hold again
      }
    } else if (!STILL[pose]) {
      this.anchor = null;
    }

    if (!this.isArmed()) {
      if (steady && pose === 'Open_Palm' && !this.fired && now - this.poseSince >= c.armHoldMs) {
        this.fired = true; // latch: palm held through a later expiry does not instantly re-arm
        this.armedUntil = now + c.armWindowMs;
        emit('ARM');
      }
      return out;
    }
    if (this.isCooling(now)) return out;

    // Hold timing starts when the cooldown ends, not when the pose began.
    const base = Math.max(this.poseSince, this.cooldownUntil);
    const discrete = DISCRETE[pose];
    const scroll = SCROLL[pose];
    if (steady && discrete && !this.fired && now - base >= c.actionHoldMs) {
      this.fired = true;
      this.needRelease = true;
      this.cooldownUntil = now + c.cooldownMs;
      this.armedUntil = now + c.armWindowMs;
      emit(discrete);
    } else if (steady && scroll) {
      this.nextScroll ??= base + c.scrollFirstMs;
      if (now >= this.nextScroll) {
        this.nextScroll += c.scrollRepeatMs;
        if (this.nextScroll <= now) this.nextScroll = now + c.scrollRepeatMs;
        this.scrolled = true;
        this.armedUntil = now + c.armWindowMs;
        emit(scroll);
      }
    }
    return out;
  }

  hud(now: number): Snapshot {
    const c = this.cfg;
    const armed = this.isArmed() && (this.present || !c.alwaysArmed);
    let state: Snapshot['state'];
    let holdProgress = 0;
    let pendingAction: GestureAction | null = null;
    const pose = this.pose;

    if (armed) {
      if (this.isCooling(now)) {
        state = 'cooldown';
      } else {
        state = 'armed';
        const base = Math.max(this.poseSince, this.cooldownUntil);
        const discrete = DISCRETE[pose];
        const scroll = SCROLL[pose];
        if (discrete) {
          state = 'holding';
          pendingAction = discrete;
          holdProgress = (now - base) / c.actionHoldMs;
        } else if (scroll) {
          state = 'holding';
          pendingAction = scroll;
          const next = this.nextScroll ?? base + c.scrollFirstMs;
          const period = this.nextScroll === null ? c.scrollFirstMs : c.scrollRepeatMs;
          holdProgress = 1 - (next - now) / period;
        }
      }
    } else {
      state = this.present ? 'hand_seen' : 'no_hand';
      if (this.present && pose === 'Open_Palm' && !this.fired) {
        pendingAction = 'ARM';
        holdProgress = (now - this.poseSince) / c.armHoldMs;
      }
    }
    return {
      state,
      pose,
      holdProgress: Math.min(1, Math.max(0, holdProgress)),
      pendingAction,
      armedRemainingMs: this.isArmed() && !c.alwaysArmed ? Math.max(0, this.armedUntil - now) : 0,
      lastAction: this.lastAction,
      hint: this.hint,
    };
  }

  private isArmed(): boolean {
    return this.cfg.alwaysArmed || this.armedUntil > 0;
  }

  private isCooling(now: number): boolean {
    return now < this.cooldownUntil || this.needRelease;
  }

  private isHolding(now: number): boolean {
    return this.present && (this.pose in DISCRETE || this.pose in SCROLL) && !this.isCooling(now);
  }

  private lose(now: number): void {
    if (this.scrolled) this.cooldownUntil = Math.max(this.cooldownUntil, now + SCROLL_RELEASE_COOLDOWN_MS);
    this.scrolled = false;
    this.nextScroll = null;
    this.present = false;
    this.needRelease = false;
    this.fired = false;
    this.pose = 'None';
    this.poseSince = now;
    this.cand = 'None';
    this.candSince = now;
    this.anchor = null;
  }

}
