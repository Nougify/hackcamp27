export type GestureAction =
  | 'ARM'
  | 'DISARM'
  | 'NEXT_STEP'
  | 'PREV_STEP'
  | 'SCROLL_UP'
  | 'SCROLL_DOWN'
  | 'TIMER_TOGGLE'
  | 'SPEAK_TOGGLE';

export type CannedGesture =
  | 'None'
  | 'Closed_Fist'
  | 'Open_Palm'
  | 'Pointing_Up'
  | 'Thumb_Down'
  | 'Thumb_Up'
  | 'Victory'
  | 'ILoveYou';

export type GestureEngineState =
  | 'off'
  | 'loading'
  | 'permission_needed'
  | 'error'
  | 'no_hand'
  | 'hand_seen'
  | 'armed'
  | 'holding'
  | 'cooldown';

export interface GestureHud {
  state: GestureEngineState;
  pose: CannedGesture;
  holdProgress: number; // 0–1 for the radial ring
  pendingAction: GestureAction | null;
  armedRemainingMs: number;
  lastAction: { action: GestureAction; at: number } | null;
  hint: null | 'move_closer' | 'more_light' | 'one_hand_only';
  fps: number;
  error?: 'NotAllowedError' | 'NotFoundError' | 'NotReadableError' | 'InsecureContext' | 'ModelLoadFailed';
}

export interface GestureConfig {
  minScore: number;
  fistMinScore: number;
  classifierScoreThreshold: number;
  armHoldMs: number;
  actionHoldMs: number;
  armWindowMs: number;
  alwaysArmed: boolean;
  cooldownMs: number;
  releaseMs: number;
  scrollFirstMs: number;
  scrollRepeatMs: number;
  scrollFraction: number;
  swipeWindowMs: number;
  swipeMinDx: number;
  swipeDxToDyRatio: number;
  swipeMinVelocity: number;
  swipeNextDirection: 'left' | 'right';
  minHandHeightFrac: number;
  targetFps: number;
  idleFps: number;
  idleAfterMs: number;
  delegate: 'GPU' | 'CPU';
}

/** Anything that produces gesture actions: MediaPipe, keyboard mock, test harness. */
export interface GestureSource {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  onAction(cb: (a: GestureAction) => void): () => void;
  onHud(cb: (h: GestureHud) => void): () => void; // throttled to ≤10 Hz
}

/** The single integration point: every input channel calls these. Owned by Cook Mode. */
export interface CookingController {
  nextStep(): void;
  prevStep(): void;
  scroll(direction: 'up' | 'down'): void;
  toggleTimer(): void; // current step's timer
  toggleSpeak(): void; // read current step / stop
  source?: 'gesture' | 'keyboard' | 'touch' | 'voice';
}
