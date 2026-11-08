"use client";

let ctx: AudioContext | null = null;

/** Create/resume the AudioContext inside a user gesture ("Start cooking") so later beeps can play. */
export function unlockAudio() {
  ctx ??= new AudioContext();
  void ctx.resume();
}

function beep(at: number, freq: number, dur: number, gain = 0.3) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur);
}

/** Timer done: beeps + vibration + a notification if the user granted permission (SPEC F11). */
export function ringAlarm(label: string) {
  if (ctx) for (let i = 0; i < 3; i++) beep(ctx.currentTime + i * 0.35, 880, 0.25);
  navigator.vibrate?.([300, 150, 300, 150, 300]);
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification("Timer done", { body: label, tag: label });
    } catch {
      // Android Chrome only allows notifications from a service worker; beep + vibrate still ran.
    }
  }
}

/** Soft click for fired hands-free actions (SPEC §11.6). */
export function click() {
  if (ctx) beep(ctx.currentTime, 1200, 0.04, 0.08);
}

/** Ask once, from a tap (first timer start). Never blocks the timer. */
export function askNotificationPermission() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
}
