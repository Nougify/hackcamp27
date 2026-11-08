import type { CannedGesture, GestureAction, GestureConfig, GestureHud } from '@/contracts';

/** Minimal GestureRecognizerResult-like input. Landmarks are normalized, unmirrored camera coords. */
export type EngineFrame = {
  hand: null | {
    landmarks: Array<{ x: number; y: number }>;
    gesture: CannedGesture;
    score: number;
    /** Hand-detection confidence (MediaPipe handedness score). The gesture `score` is ~0 for a
     *  sideways point because that pose isn't a classifier category, so points are gated on this. */
    handScore?: number;
  };
  /** Camera frame width / height (landmarks are normalized per axis). Default 4/3. */
  aspect?: number;
};

type Snapshot = Omit<GestureHud, 'fps' | 'error'>;
/** MediaPipe has no sideways-point gesture, so the engine adds two poses detected from landmarks. */
type Pose = CannedGesture | 'Point_Left' | 'Point_Right';

const DISCRETE: Partial<Record<Pose, GestureAction>> = {
  Closed_Fist: 'TIMER_TOGGLE',
  Victory: 'SPEAK_TOGGLE',
  Point_Right: 'NEXT_STEP', // toward the screen's right, as the user sees themselves mirrored
  Point_Left: 'PREV_STEP',
};
const SCROLL: Partial<Record<Pose, GestureAction>> = {
  Thumb_Up: 'SCROLL_UP',
  Thumb_Down: 'SCROLL_DOWN',
};
const EDGE = 0.01;
const MORE_LIGHT_MS = 3000;
const SCROLL_RELEASE_COOLDOWN_MS = 300;
// A new pose must persist this long before it counts, so one jittery frame can't break a hold (≈2 frames at 15 fps).
const POSE_SETTLE_MS = 150;
const POINT_MAX_DRIFT = 0.05; // index-tip movement (fraction of frame) allowed during a point hold

export class GestureEngine {
  private cfg: GestureConfig;
  private present = false;       // a valid hand was seen and not yet lost >= releaseMs
  private lastSeen = 0;
  private pose: Pose = 'None';
  private poseSince = 0;
  private cand: Pose = 'None'; // raw pose waiting to settle
  private candSince = 0;
  private pointWhy = '';
  private pointAnchor: Pt | null = null; // index tip where the current point hold started
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

  /** Internal pose, including Point_Left/Point_Right (the HUD contract only has canned names). For debug. */
  get debugPose(): string {
    return this.pointWhy && this.pointWhy !== 'ok' ? `${this.pose} (point: ${this.pointWhy})` : this.pose;
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
    this.pointAnchor = null;
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
    // "Turn on a light" follows hand-detection confidence; a sideways point has a ~0 gesture score by design.
    const lowLight = (h.handScore ?? h.score) < c.minScore;
    this.lowSince = lowLight ? (this.lowSince ?? now) : null;
    if (this.lowSince !== null && now - this.lowSince >= MORE_LIGHT_MS) hint = 'more_light';
    this.hint = hint;

    // A sideways point wins over the classifier label (it may call it a fist or None), but only on
    // confident frames. Once pointing, a looser angle keeps landmark noise from breaking the hold.
    const isPoint = (p: Pose) => p === 'Point_Left' || p === 'Point_Right';
    const check = pointCheck(h.landmarks, frame.aspect, isPoint(this.pose) || isPoint(this.cand));
    const point = (h.handScore ?? h.score) < c.minScore ? null : check.dir;
    this.pointWhy = point ? 'ok' : check.dir ? 'low hand confidence' : check.why;
    const raw: Pose =
      point ?? (low || (h.gesture === 'Closed_Fist' && h.score < c.fistMinScore) ? 'None' : h.gesture);
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
      this.pose = this.cand;
      this.poseSince = this.candSince; // hold timing counts from when the pose first appeared
    }
    const pose = this.pose;
    // Debouncing only protects the latch; actions need the pose to be showing right now.
    const steady = raw === pose;

    // A point must be held still: a moving index finger (e.g. on a knife spine while chopping) restarts the hold.
    if (isPoint(pose) && steady) {
      const tip = h.landmarks[8];
      if (!this.pointAnchor) {
        this.pointAnchor = tip;
      } else if (!this.fired && dist(tip, this.pointAnchor) > POINT_MAX_DRIFT) {
        this.pointAnchor = tip;
        this.poseSince = now; // moved: start the hold again
      }
    } else if (!isPoint(pose)) {
      this.pointAnchor = null;
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
      pose: pose === 'Point_Left' || pose === 'Point_Right' ? 'Pointing_Up' : pose, // contract only knows canned names
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
    this.pointAnchor = null;
  }

}

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Index finger straight and sideways, other fingers curled → which way it points on screen (mirrored view). */
export type PointCheck = { dir: 'Point_Left' | 'Point_Right' | null; why: string };

/** Index finger extended and roughly sideways, other fingers curled → which way it points on screen (mirrored view).
 *  `why` explains a rejection, for the debug overlay. Distances are compared in pixels, not normalized units. */
export function pointCheck(lm: Pt[], aspect = 4 / 3, sticky = false): PointCheck {
  const no = (why: string): PointCheck => ({ dir: null, why });
  if (lm.length < 21) return no('no landmarks');
  const px = (p: Pt) => ({ x: p.x * aspect, y: p.y });
  const d = (a: number, b: number) => dist(px(lm[a]), px(lm[b]));
  const palm = d(0, 9);
  if (palm < 1e-3) return no('no hand');
  // Index extended: tip away from its knuckle, and farther from the wrist than its middle joint.
  if (d(5, 8) < 0.45 * palm || d(0, 8) < d(0, 6)) return no('index not straight');
  // Middle, ring and pinky curled: each tip no farther from the wrist than its middle joint (+10% slack).
  for (const [p, t] of [[10, 12], [14, 16], [18, 20]]) if (d(0, t) > 1.1 * d(0, p)) return no('other fingers open');
  // Roughly sideways: within ~40° of horizontal (~50° once already pointing).
  const dx = (lm[8].x - lm[5].x) * aspect;
  const dy = lm[8].y - lm[5].y;
  if (Math.abs(dx) < (sticky ? 0.85 : 1.2) * Math.abs(dy)) return no('not sideways');
  // Raw camera x is mirrored on screen: a tip further LEFT in the raw image points to the screen's RIGHT.
  return { dir: dx < 0 ? 'Point_Right' : 'Point_Left', why: 'ok' };
}

export const pointDirection = (lm: Pt[], aspect?: number, sticky?: boolean) => pointCheck(lm, aspect, sticky).dir;
