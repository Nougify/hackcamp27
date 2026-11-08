import type { GestureConfig } from '@/contracts';

// swipe* fields are unused: built-in Pointing_Up / ILoveYou replaced swipes (Jerry, 2026-11-07). The frozen contract still has them.
export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  minScore: 0.7, fistMinScore: 0.8, classifierScoreThreshold: 0.6,
  armHoldMs: 600, actionHoldMs: 800, armWindowMs: 5000, alwaysArmed: true, // default on (Jerry); the palm-to-arm step is opt-in via Settings
  cooldownMs: 1200, releaseMs: 300,
  scrollFirstMs: 600, scrollRepeatMs: 700, scrollFraction: 0.4,
  swipeWindowMs: 400, swipeMinDx: 0.25, swipeDxToDyRatio: 2, swipeMinVelocity: 1.0,
  swipeNextDirection: 'left',
  minHandHeightFrac: 0.08, targetFps: 15, idleFps: 5, idleAfterMs: 10_000,
  delegate: 'GPU',
};
