import type { CannedGesture, GestureAction, GestureConfig, GestureHud } from '@/contracts';

/** Minimal GestureRecognizerResult-like input. Landmarks are normalized, unmirrored camera coords. */
export type EngineFrame = {
  hand: null | {
    landmarks: Array<{ x: number; y: number }>;
    gesture: CannedGesture;
    score: number;
  };
};

type Snapshot = Omit<GestureHud, 'fps' | 'error'>;

const PALM = [0, 5, 9, 13, 17];
const DISCRETE: Partial<Record<CannedGesture, GestureAction>> = {
  Closed_Fist: 'TIMER_TOGGLE',
  Victory: 'SPEAK_TOGGLE',
};
const SCROLL: Partial<Record<CannedGesture, GestureAction>> = {
  Thumb_Up: 'SCROLL_UP',
  Thumb_Down: 'SCROLL_DOWN',
};
const EDGE = 0.01;
const MORE_LIGHT_MS = 3000;
const SCROLL_RELEASE_COOLDOWN_MS = 300;
const EMA_ALPHA = 0.5;

export class GestureEngine {
  private cfg: GestureConfig;
  private present = false;       // a valid hand was seen and not yet lost >= releaseMs
  private lastSeen = 0;
  private pose: CannedGesture = 'None';
  private poseSince = 0;
  private fired = false;         // one-shot latch per continuous pose hold (ARM or discrete action)
  private needRelease = false;   // discrete pose action fired; pose must change before re-arming
  private cooldownUntil = 0;
  private armedUntil = 0;        // 0 = not armed
  private nextScroll: number | null = null;
  private scrolled = false;
  private lastAction: Snapshot['lastAction'] = null;
  private hint: Snapshot['hint'] = null;
  private lowSince: number | null = null;
  private ema: { x: number; y: number } | null = null;
  private buf: Array<{ t: number; x: number; y: number; fist: boolean }> = [];

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
    this.fired = false;
    this.needRelease = false;
    this.cooldownUntil = 0;
    this.armedUntil = 0;
    this.nextScroll = null;
    this.scrolled = false;
    this.lastAction = null;
    this.hint = null;
    this.lowSince = null;
    this.ema = null;
    this.buf = [];
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

    const pose: CannedGesture =
      low || (h.gesture === 'Closed_Fist' && h.score < c.fistMinScore) ? 'None' : h.gesture;
    if (pose !== this.pose) {
      if (this.scrolled) this.cooldownUntil = Math.max(this.cooldownUntil, now + SCROLL_RELEASE_COOLDOWN_MS);
      this.scrolled = false;
      this.nextScroll = null;
      this.needRelease = false;
      this.fired = false;
      this.pose = pose;
      this.poseSince = now;
    }

    // Palm centre, mirrored so directions match what the user sees, then EMA-smoothed.
    const sx = PALM.reduce((s, i) => s + h.landmarks[i].x, 0) / PALM.length;
    const sy = PALM.reduce((s, i) => s + h.landmarks[i].y, 0) / PALM.length;
    const mx = 1 - sx;
    this.ema = this.ema
      ? { x: EMA_ALPHA * mx + (1 - EMA_ALPHA) * this.ema.x, y: EMA_ALPHA * sy + (1 - EMA_ALPHA) * this.ema.y }
      : { x: mx, y: sy };

    if (!this.isArmed()) {
      this.buf.length = 0;
      if (pose === 'Open_Palm' && !this.fired && now - this.poseSince >= c.armHoldMs) {
        this.fired = true; // latch: palm held through a later expiry does not instantly re-arm
        this.armedUntil = now + c.armWindowMs;
        emit('ARM');
      }
      return out;
    }
    if (this.isCooling(now)) {
      this.buf.length = 0;
      return out;
    }

    // Hold timing starts when the cooldown ends, not when the pose began.
    const base = Math.max(this.poseSince, this.cooldownUntil);
    const discrete = DISCRETE[pose];
    const scroll = SCROLL[pose];
    let acted = false;
    if (discrete && !this.fired && now - base >= c.actionHoldMs) {
      this.fired = true;
      this.needRelease = true;
      this.cooldownUntil = now + c.cooldownMs;
      this.armedUntil = now + c.armWindowMs;
      this.buf.length = 0;
      emit(discrete);
      acted = true;
    } else if (scroll) {
      this.nextScroll ??= base + c.scrollFirstMs;
      if (now >= this.nextScroll) {
        this.nextScroll += c.scrollRepeatMs;
        if (this.nextScroll <= now) this.nextScroll = now + c.scrollRepeatMs;
        this.scrolled = true;
        this.armedUntil = now + c.armWindowMs;
        emit(scroll);
        acted = true;
      }
    }
    if (!acted) {
      const a = this.detectSwipe(now, pose === 'Closed_Fist');
      if (a) {
        this.cooldownUntil = now + c.cooldownMs;
        this.armedUntil = now + c.armWindowMs;
        emit(a);
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
    this.buf = [];
    this.ema = null;
  }

  private detectSwipe(now: number, fist: boolean): GestureAction | null {
    const c = this.cfg;
    const b = this.buf;
    b.push({ t: now, x: this.ema!.x, y: this.ema!.y, fist });
    while (b[0].t < now - c.swipeWindowMs) b.shift();
    if (b.length < 2) return null;
    const first = b[0];
    const last = b[b.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    if (Math.abs(dx) < c.swipeMinDx || Math.abs(dx) < c.swipeDxToDyRatio * Math.abs(dy)) return null;
    if (b.filter((p) => p.fist).length * 2 > b.length) return null;
    let peak = 0;
    for (let i = 1; i < b.length; i++) {
      const dt = b[i].t - b[i - 1].t;
      if (dt > 0) peak = Math.max(peak, (Math.sign(dx) * (b[i].x - b[i - 1].x) * 1000) / dt);
    }
    if (peak < c.swipeMinVelocity) return null;
    b.length = 0;
    return dx < 0 === (c.swipeNextDirection === 'left') ? 'NEXT_STEP' : 'PREV_STEP';
  }
}
