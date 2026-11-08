import { describe, it, expect } from 'vitest';
import type { CannedGesture, GestureAction } from '@/contracts';
import { DEFAULT_GESTURE_CONFIG } from './config';
import { GestureEngine, type EngineFrame } from './engine';

const FRAME_MS = 1000 / 15;

type Seg = {
  ms: number;
  pose?: CannedGesture;
  score?: number;
  /** false = no hand in frame */
  hand?: boolean;
  /** palm centre in MIRRORED coords (what the user sees); defaults to previous position */
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  /** hand bbox height, fraction of frame */
  size?: number;
};


function frame(pose: CannedGesture, score: number, mx: number, y: number, size: number): EngineFrame {
  const x = 1 - mx; // engine input is unmirrored
  const landmarks = Array.from({ length: 21 }, () => ({ x, y }));
  landmarks[12] = { x, y: y - size / 2 };
  landmarks[4] = { x, y: y + size / 2 };
  return { hand: { landmarks, gesture: pose, score } };
}

/** Feeds frames at 15 fps. A segment of `ms` covers frames at 0..ms inclusive (so 600 ms reaches t+600). */
class Rig {
  frameIdx = 0;
  mx = 0.5;
  y = 0.5;
  actions: Array<{ a: GestureAction; t: number }> = [];
  constructor(readonly engine: GestureEngine) {}

  get now() {
    return Math.round(this.frameIdx * FRAME_MS);
  }

  run(...segs: Seg[]) {
    for (const s of segs) {
      const n = Math.floor(s.ms / FRAME_MS + 1e-9) + 1;
      const x0 = s.x ?? this.mx;
      const y0 = s.y ?? this.y;
      const x1 = s.toX ?? x0;
      const y1 = s.toY ?? y0;
      for (let i = 0; i < n; i++) {
        const k = n > 1 ? i / (n - 1) : 1;
        this.mx = x0 + (x1 - x0) * k;
        this.y = y0 + (y1 - y0) * k;
        const t = this.now;
        const f: EngineFrame =
          s.hand === false
            ? { hand: null }
            : frame(s.pose ?? 'None', s.score ?? 0.95, this.mx, this.y, s.size ?? 0.3);
        for (const a of this.engine.update(f, t)) this.actions.push({ a, t });
        this.frameIdx++;
      }
    }
    return this;
  }

  of(a: GestureAction) {
    return this.actions.filter((x) => x.a === a);
  }
  names() {
    return this.actions.map((x) => x.a);
  }
}

// Most tests exercise the palm-to-arm flow, so they opt out of the always-armed default.
const mk = (over: Partial<typeof DEFAULT_GESTURE_CONFIG> = {}) =>
  new Rig(new GestureEngine({ ...DEFAULT_GESTURE_CONFIG, alwaysArmed: false, ...over }));
const armed = (over: Partial<typeof DEFAULT_GESTURE_CONFIG> = {}) =>
  mk(over).run({ pose: 'Open_Palm', ms: 600 });

describe('arming', () => {
  it('palm held 600 ms emits exactly one ARM, even if held longer', () => {
    const r = mk().run({ pose: 'Open_Palm', ms: 600 });
    expect(r.names()).toEqual(['ARM']);
    r.run({ pose: 'Open_Palm', ms: 2000 });
    expect(r.names()).toEqual(['ARM']);
    expect(r.engine.hud(r.now).state).toBe('armed');
  });

  it('palm shorter than 600 ms does not arm; hud shows progress', () => {
    const r = mk().run({ pose: 'Open_Palm', ms: 400 });
    expect(r.actions).toEqual([]);
    const h = r.engine.hud(r.now - FRAME_MS);
    expect(h.state).toBe('hand_seen');
    expect(h.pendingAction).toBe('ARM');
    expect(h.holdProgress).toBeGreaterThan(0.5);
  });

  it('low-score palm does not arm', () => {
    const r = mk().run({ pose: 'Open_Palm', ms: 2000, score: 0.65 });
    expect(r.actions).toEqual([]);
  });

  it('expires after 5 s idle with one DISARM, and a still-held palm does not re-arm', () => {
    const r = armed().run({ pose: 'Open_Palm', ms: 5400 });
    expect(r.names()).toEqual(['ARM', 'DISARM']);
    const d = r.of('DISARM')[0].t;
    expect(d).toBeGreaterThan(5600);
    expect(d).toBeLessThan(5700);
    expect(r.engine.hud(r.now).state).toBe('hand_seen');
  });

  it('expiry with no hand goes to no_hand', () => {
    const r = armed().run({ hand: false, ms: 5400 });
    expect(r.names()).toEqual(['ARM', 'DISARM']);
    expect(r.engine.hud(r.now).state).toBe('no_hand');
  });

  it('a successful action extends the window by 5 s from the action time', () => {
    const r = armed().run({ pose: 'Open_Palm', ms: 4000 }, { pose: 'Closed_Fist', ms: 800 });
    const fire = r.of('TIMER_TOGGLE')[0].t;
    r.run({ pose: 'Open_Palm', ms: 4800 });
    expect(r.of('DISARM')).toHaveLength(0); // original window (5600) long gone
    r.run({ pose: 'Open_Palm', ms: 500 });
    const d = r.of('DISARM')[0].t;
    expect(d).toBeGreaterThan(fire + 5000);
    expect(d).toBeLessThan(fire + 5100);
  });

  it('alwaysArmed: fist fires without a palm and ARM/DISARM are never emitted', () => {
    const r = mk({ alwaysArmed: true }).run({ pose: 'Closed_Fist', ms: 800 }, { pose: 'None', ms: 8000 });
    expect(r.names()).toEqual(['TIMER_TOGGLE']);
  });
});

describe('discrete pose actions', () => {
  it('fist 800 ms -> exactly one TIMER_TOGGLE; 3 s more still one', () => {
    const r = armed().run({ pose: 'Closed_Fist', ms: 800 });
    expect(r.of('TIMER_TOGGLE')).toHaveLength(1);
    r.run({ pose: 'Closed_Fist', ms: 3000 });
    expect(r.of('TIMER_TOGGLE')).toHaveLength(1);
  });

  it('fist shorter than 800 ms does nothing', () => {
    const r = armed().run({ pose: 'Closed_Fist', ms: 700 }, { pose: 'Open_Palm', ms: 500 });
    expect(r.names()).toEqual(['ARM']);
  });

  it('release then fist again toggles a second time', () => {
    const r = armed().run(
      { pose: 'Closed_Fist', ms: 800 },
      { pose: 'Closed_Fist', ms: 3000 },
      { pose: 'Open_Palm', ms: 300 },
      { pose: 'Closed_Fist', ms: 800 },
    );
    expect(r.of('TIMER_TOGGLE')).toHaveLength(2);
  });

  it('a quick release does not beat the 1200 ms global cooldown', () => {
    const r = armed().run({ pose: 'Closed_Fist', ms: 800 });
    const first = r.of('TIMER_TOGGLE')[0].t;
    r.run({ pose: 'Open_Palm', ms: 200 }, { pose: 'Closed_Fist', ms: 3000 });
    const second = r.of('TIMER_TOGGLE')[1].t;
    expect(second).toBeGreaterThanOrEqual(first + 1200 + 800);
  });

  it('one jittery frame mid-hold does not count as a release (no double toggle)', () => {
    const r = armed().run(
      { pose: 'Closed_Fist', ms: 900 },
      { pose: 'None', ms: 0 }, // single misclassified frame
      { pose: 'Closed_Fist', ms: 3000 },
    );
    expect(r.of('TIMER_TOGGLE')).toHaveLength(1);
  });

  it('fist with score 0.75 (below fistMinScore) does nothing', () => {
    const r = armed().run({ pose: 'Closed_Fist', ms: 3000, score: 0.75 });
    expect(r.names()).toEqual(['ARM']);
  });

  it('victory 800 ms -> one SPEAK_TOGGLE, once per hold', () => {
    const r = armed().run({ pose: 'Victory', ms: 800 }, { pose: 'Victory', ms: 2000 });
    expect(r.of('SPEAK_TOGGLE')).toHaveLength(1);
  });

  it('hud reports holding progress and cooldown', () => {
    const r = armed().run({ pose: 'Closed_Fist', ms: 400 });
    let h = r.engine.hud(r.now - FRAME_MS);
    expect(h.state).toBe('holding');
    expect(h.pendingAction).toBe('TIMER_TOGGLE');
    expect(h.holdProgress).toBeGreaterThan(0.4);
    expect(h.holdProgress).toBeLessThan(0.7);
    r.run({ pose: 'Closed_Fist', ms: 500 });
    h = r.engine.hud(r.now - FRAME_MS);
    expect(h.state).toBe('cooldown');
    expect(h.lastAction?.action).toBe('TIMER_TOGGLE');
  });

  it('hand lost < 300 ms does not break a hold; >= 300 ms does', () => {
    const ok = armed().run(
      { pose: 'Closed_Fist', ms: 400 },
      { hand: false, ms: 200 },
      { pose: 'Closed_Fist', ms: 400 },
    );
    expect(ok.of('TIMER_TOGGLE')).toHaveLength(1);
    const broken = armed().run(
      { pose: 'Closed_Fist', ms: 400 },
      { hand: false, ms: 400 },
      { pose: 'Closed_Fist', ms: 400 },
    );
    expect(broken.of('TIMER_TOGGLE')).toHaveLength(0);
  });
});

describe('scroll', () => {
  it.each([
    ['Thumb_Up', 'SCROLL_UP'],
    ['Thumb_Down', 'SCROLL_DOWN'],
  ] as const)('%s held 2.1 s ticks at ~600, ~1300, ~2000 ms', (pose, action) => {
    const r = armed();
    const t0 = r.now;
    r.run({ pose, ms: 2100 });
    const ticks = r.of(action).map((x) => x.t - t0);
    expect(ticks).toHaveLength(3);
    [600, 1300, 2000].forEach((want, i) => expect(Math.abs(ticks[i] - want)).toBeLessThan(70));
    expect(r.names().filter((a) => a !== action)).toEqual(['ARM']);
  });

  it('scroll ticks extend the armed window; release after scrolling adds a 300 ms cooldown', () => {
    const r = armed().run({ pose: 'Thumb_Up', ms: 700 });
    expect(r.of('SCROLL_UP')).toHaveLength(1);
    r.run({ pose: 'Open_Palm', ms: 200 });
    expect(r.engine.hud(r.now - FRAME_MS).state).toBe('cooldown');
    r.run({ pose: 'Open_Palm', ms: 400 });
    expect(r.engine.hud(r.now - FRAME_MS).state).toBe('armed');
  });

  it('does not scroll while unarmed', () => {
    const r = mk().run({ pose: 'Thumb_Up', ms: 3000 });
    expect(r.actions).toEqual([]);
  });
});

describe('next / previous step (built-in Pointing_Up / ILoveYou)', () => {
  it('Pointing_Up held 800 ms → exactly one NEXT_STEP, even if held longer', () => {
    const r = armed().run({ pose: 'Pointing_Up', ms: 800 });
    expect(r.of('NEXT_STEP')).toHaveLength(1);
    r.run({ pose: 'Pointing_Up', ms: 3000 });
    expect(r.of('NEXT_STEP')).toHaveLength(1);
  });

  it('ILoveYou held 800 ms → PREV_STEP', () => {
    const r = armed().run({ pose: 'ILoveYou', ms: 800 });
    expect(r.names()).toEqual(['ARM', 'PREV_STEP']);
  });

  it('a short point does nothing', () => {
    const r = armed().run({ pose: 'Pointing_Up', ms: 600 }, { pose: 'Open_Palm', ms: 500 });
    expect(r.names()).toEqual(['ARM']);
  });

  it('release, then point again → second step after the cooldown', () => {
    const r = armed().run({ pose: 'Pointing_Up', ms: 800 }, { pose: 'Open_Palm', ms: 300 }, { pose: 'Pointing_Up', ms: 1800 });
    const [a, b] = r.of('NEXT_STEP');
    expect(b.t - a.t).toBeGreaterThanOrEqual(1200);
  });

  it('a low-confidence point never fires', () => {
    const r = armed().run({ pose: 'Pointing_Up', ms: 3000, score: 0.5 });
    expect(r.names()).toEqual(['ARM']);
  });


  it('a moving point (finger on a knife spine while chopping) never fires', () => {
    const r = armed();
    for (let i = 0; i < 10; i++) r.run({ pose: 'Pointing_Up', ms: 300, x: 0.4, toX: 0.6 }, { pose: 'Pointing_Up', ms: 300, x: 0.6, toX: 0.4 });
    expect(r.of('NEXT_STEP')).toHaveLength(0);
  });

  it('a still point fires even after earlier movement', () => {
    const r = armed().run({ pose: 'Pointing_Up', ms: 300, x: 0.4, toX: 0.6 }, { pose: 'Pointing_Up', ms: 800, x: 0.6 });
    expect(r.of('NEXT_STEP')).toHaveLength(1);
  });

  it('brief Pointing_Up / ILoveYou frames on the way into a fist do not fire', () => {
    const r = armed().run({ pose: 'Pointing_Up', ms: 200 }, { pose: 'ILoveYou', ms: 200 }, { pose: 'Closed_Fist', ms: 800 });
    expect(r.names()).toEqual(['ARM', 'TIMER_TOGGLE']);
  });

  it('does nothing while unarmed', () => {
    const r = mk().run({ pose: 'Pointing_Up', ms: 3000 }, { pose: 'ILoveYou', ms: 3000 });
    expect(r.actions).toEqual([]);
  });

  it('switching straight from Pointing_Up to ILoveYou fires PREV_STEP 800 ms after ILoveYou starts', () => {
    const r = armed().run({ pose: 'Pointing_Up', ms: 500, x: 0.3 }, { pose: 'ILoveYou', ms: 0, x: 0.7 });
    const start = r.now - FRAME_MS; // first ILoveYou frame
    r.run({ pose: 'ILoveYou', ms: 1000, x: 0.7 });
    const [prev] = r.of('PREV_STEP');
    expect(prev.t - start).toBeLessThanOrEqual(800 + FRAME_MS);
  });

  it('works without arming by default (always armed)', () => {
    const r = new Rig(new GestureEngine(DEFAULT_GESTURE_CONFIG)).run({ pose: 'Pointing_Up', ms: 800 });
    expect(r.names()).toEqual(['NEXT_STEP']);
  });
});

describe('safety / unarmed', () => {
  it('30 s of stirring, fists, thumbs and brief palms while unarmed fires 0 actions', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const poses: CannedGesture[] = ['Closed_Fist', 'None', 'Pointing_Up', 'Thumb_Up', 'Victory', 'Thumb_Down'];
    const r = mk();
    let t = 0;
    let prevPalm = false;
    while (t < 30000) {
      const palm: boolean = !prevPalm && rnd() < 0.2;
      const ms = palm ? 400 : 150 + Math.floor(rnd() * 400);
      r.run({
        pose: palm ? 'Open_Palm' : poses[Math.floor(rnd() * poses.length)],
        ms,
        x: 0.2 + rnd() * 0.6,
        toX: 0.2 + rnd() * 0.6,
        y: 0.3 + rnd() * 0.4,
        toY: 0.3 + rnd() * 0.4,
      });
      prevPalm = palm;
      t = r.now;
    }
    expect(r.actions).toEqual([]);
  });
});

describe('hand validity and hints', () => {
  it('too-small hand stays no_hand with move_closer and fires nothing', () => {
    const r = mk().run({ pose: 'Open_Palm', ms: 2000, size: 0.05 });
    expect(r.actions).toEqual([]);
    const h = r.engine.hud(r.now);
    expect(h.state).toBe('no_hand');
    expect(h.hint).toBe('move_closer');
  });

  it('hand touching the frame edge is not seen', () => {
    const r = mk().run({ pose: 'Open_Palm', ms: 2000, x: 0.995 });
    expect(r.actions).toEqual([]);
    expect(r.engine.hud(r.now).state).toBe('no_hand');
  });

  it('hand seen once large enough; hint clears', () => {
    const r = mk().run({ pose: 'Open_Palm', ms: 200, size: 0.05 }, { pose: 'Open_Palm', ms: 200 });
    const h = r.engine.hud(r.now);
    expect(h.state).toBe('hand_seen');
    expect(h.hint).toBeNull();
  });

  it('no hand >= 300 ms returns hand_seen -> no_hand', () => {
    const r = mk().run({ pose: 'None', ms: 300 }, { hand: false, ms: 500 });
    expect(r.engine.hud(r.now).state).toBe('no_hand');
  });

  it('low score for 3 s gives more_light', () => {
    const r = mk().run({ pose: 'Open_Palm', ms: 2000, score: 0.5 });
    expect(r.engine.hud(r.now).hint).toBeNull();
    r.run({ pose: 'Open_Palm', ms: 1200, score: 0.5 });
    expect(r.engine.hud(r.now).hint).toBe('more_light');
    r.run({ pose: 'Open_Palm', ms: 100, score: 0.9 });
    expect(r.engine.hud(r.now).hint).toBeNull();
  });

  it('reset() clears arming', () => {
    const r = armed();
    r.engine.reset();
    expect(r.engine.hud(r.now).state).toBe('no_hand');
  });
});
