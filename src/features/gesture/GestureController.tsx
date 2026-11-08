"use client";

import { useEffect, useRef, useState } from "react";
import type { CookingController, GestureAction, GestureConfig, GestureHud } from "@/contracts";
import { Button } from "@/components/ui";
import { click } from "@/features/cook/alarm";
import { MediaPipeGestureSource } from "./MediaPipeGestureSource";

const DEBUG = process.env.NEXT_PUBLIC_GESTURE_DEBUG === "true";

const DONE: Record<GestureAction, string> = {
  ARM: "Ready",
  DISARM: "Hands-free paused",
  NEXT_STEP: "Next step",
  PREV_STEP: "Previous step",
  SCROLL_UP: "Scrolled up",
  SCROLL_DOWN: "Scrolled down",
  TIMER_TOGGLE: "Timer toggled",
  SPEAK_TOGGLE: "Read aloud toggled",
};
const HOLDING: Partial<Record<GestureAction, string>> = {
  TIMER_TOGGLE: "Hold fist…",
  SPEAK_TOGGLE: "Hold victory…",
  SCROLL_UP: "Scrolling up",
  SCROLL_DOWN: "Scrolling down",
  ARM: "Hold your palm…",
};
const ERRORS: Record<NonNullable<GestureHud["error"]>, string> = {
  NotAllowedError: "Camera blocked. Use the buttons or keyboard.",
  NotFoundError: "No camera found. Use the buttons or keyboard.",
  NotReadableError: "The camera is in use by another app. Use the buttons or keyboard.",
  InsecureContext: "Hands-free needs HTTPS. Use the buttons or keyboard.",
  ModelLoadFailed: "Hands-free couldn't load. Use the buttons or keyboard.",
};
const LEGEND = [
  ["✋", "Hold palm: start"],
  ["👈", "Swipe: next / back"],
  ["👍", "Thumb up/down: scroll"],
  ["✊", "Fist: timer"],
  ["✌️", "Victory: read aloud"],
];

function chip(h: GestureHud): string {
  if (h.error) return ERRORS[h.error];
  switch (h.state) {
    case "off":
    case "loading":
      return "Starting camera…";
    case "permission_needed":
      return "Waiting for camera permission…"; // denied has error=NotAllowedError (handled above)
    case "error":
      return ERRORS.ModelLoadFailed;
    case "no_hand":
      return "Show your palm to start";
    case "hand_seen":
      return h.pose === "Open_Palm" ? "Hold your palm…" : "Show your palm to start";
    case "armed":
      return h.armedRemainingMs > 0 ? `Ready · ${Math.ceil(h.armedRemainingMs / 1000)} s` : "Ready";
    case "holding":
      return (h.pendingAction && HOLDING[h.pendingAction]) ?? "Hold…";
    case "cooldown":
      return h.lastAction ? `${DONE[h.lastAction.action]} ✓` : "Ready";
  }
}

/** Hands-free mode: camera + MediaPipe → CookingController, with the HUD (SPEC §11.5–§11.6).
 *  Load with next/dynamic({ ssr: false }). Unmounting stops the camera. */
export default function GestureController({
  controller,
  config,
  showCamera,
  announce,
  onExit,
}: {
  controller: CookingController;
  config: GestureConfig;
  showCamera: boolean;
  announce: (text: string) => void;
  onExit: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<MediaPipeGestureSource | null>(null);
  const [hud, setHud] = useState<GestureHud | null>(null);
  const [flash, setFlash] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Latest props for the long-lived action callback.
  const latest = useRef({ controller, announce });
  useEffect(() => {
    latest.current = { controller, announce };
  });

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const src = new MediaPipeGestureSource(config);
    source.current = src;
    const offHud = src.onHud((h) => {
      setHud(h);
      if (DEBUG) drawLandmarks(canvas.current, src.landmarks);
    });
    const offAction = src.onAction((a) => {
      const { controller: c, announce: say } = latest.current;
      c.source = "gesture";
      if (a === "NEXT_STEP") c.nextStep();
      else if (a === "PREV_STEP") c.prevStep();
      else if (a === "SCROLL_UP") c.scroll("up");
      else if (a === "SCROLL_DOWN") c.scroll("down");
      else if (a === "TIMER_TOGGLE") c.toggleTimer();
      else if (a === "SPEAK_TOGGLE") c.toggleSpeak();
      c.source = undefined;
      // Step changes and timer start/pause are already announced by the cook view.
      if (a !== "NEXT_STEP" && a !== "PREV_STEP" && a !== "TIMER_TOGGLE") say(DONE[a]);
      if (a !== "SCROLL_UP" && a !== "SCROLL_DOWN") {
        click();
        setFlash(Date.now());
      }
    });
    void src.start(v);
    return () => {
      offHud();
      offAction();
      src.stop();
      source.current = null;
    };
    // config changes go through setConfig below; restart only on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    source.current?.setConfig(config);
  }, [config]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(0), 250);
    return () => clearTimeout(t);
  }, [flash]);

  const failed = !!hud?.error;
  const ring = 2 * Math.PI * 18;

  return (
    <>
      {/* Edge flash for fired actions: the cook is often looking at the pan, not the screen. */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-30 border-[6px] border-accent transition-opacity duration-200 ${flash ? "opacity-100" : "opacity-0"}`}
      />

      <aside
        aria-label="Hands-free status"
        className="fixed bottom-44 right-3 z-20 w-56 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-line bg-surface/95 p-3 text-sm shadow-xl backdrop-blur"
      >
        <div className={`relative overflow-hidden rounded-xl bg-black ${showCamera && !failed ? "" : "hidden"}`}>
          <video ref={video} className="aspect-[4/3] w-full -scale-x-100 object-cover" muted playsInline />
          {DEBUG && <canvas ref={canvas} width={320} height={240} className="absolute inset-0 h-full w-full" />}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <svg viewBox="0 0 40 40" className="size-10 shrink-0 -rotate-90" aria-hidden>
            <circle cx="20" cy="20" r="18" fill="none" stroke="var(--line)" strokeWidth="4" />
            <circle
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="4"
              strokeDasharray={ring}
              strokeDashoffset={ring * (1 - (hud?.holdProgress ?? 0))}
            />
          </svg>
          {/* Not a live region: it changes up to 10×/s. Fired actions are announced via `announce`. */}
          <p className="font-semibold leading-tight">
            {hud ? chip(hud) : "Starting camera…"}
          </p>
        </div>

        {hud?.hint === "move_closer" && <p className="mt-1 text-warn">Move closer</p>}
        {hud?.hint === "more_light" && <p className="mt-1 text-warn">Turn on a light</p>}
        {DEBUG && hud && <p className="mt-1 font-mono text-xs text-muted">{hud.fps} fps · {hud.pose}</p>}

        {failed ? (
          hud?.error === "NotAllowedError" && (
            <Button variant="secondary" className="mt-2 w-full" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          )
        ) : (
          <ul className="mt-2 grid gap-0.5 text-xs text-muted">
            {LEGEND.map(([icon, text]) => (
              <li key={text}>
                <span aria-hidden>{icon}</span> {text}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex items-center justify-between rounded-full bg-surface-2 py-1 pl-3 pr-1">
          <span className="text-xs font-semibold">{failed ? "Camera off" : "● Camera on"}</span>
          <Button variant="ghost" className="min-h-8 px-3 text-xs" onClick={onExit}>
            Turn off
          </Button>
        </div>
      </aside>
    </>
  );
}

function drawLandmarks(c: HTMLCanvasElement | null, lm: Array<{ x: number; y: number }> | null) {
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#7fc48f";
  for (const p of lm ?? []) ctx.fillRect((1 - p.x) * c.width - 2, p.y * c.height - 2, 4, 4); // mirrored like the video
}
