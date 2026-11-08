"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const INACTIVITY_MS = 30 * 60_000;

/** Screen wake lock (SPEC F11): acquire inside a tap, re-acquire on return to the tab,
 *  release on finish/exit or after 30 min without interaction. */
export function useWakeLock() {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const sentinel = useRef<WakeLockSentinel | null>(null);
  const wanted = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [held, setHeld] = useState(false);

  const acquire = useCallback(async () => {
    if (!supported || document.visibilityState !== "visible") return;
    try {
      const s = await navigator.wakeLock.request("screen");
      sentinel.current = s;
      setHeld(true);
      s.addEventListener("release", () => setHeld(false));
    } catch {
      setHeld(false); // power-save mode or permission policy; the indicator just shows off
    }
  }, [supported]);

  const release = useCallback(() => {
    wanted.current = false;
    clearTimeout(idleTimer.current);
    sentinel.current?.release().catch(() => {});
    sentinel.current = null;
  }, []);

  /** Call on any user interaction to restart the 30-minute inactivity window. */
  const poke = useCallback(() => {
    if (!wanted.current) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      sentinel.current?.release().catch(() => {});
      sentinel.current = null;
    }, INACTIVITY_MS);
    if (!sentinel.current) void acquire();
  }, [acquire]);

  const request = useCallback(async () => {
    wanted.current = true;
    await acquire();
    poke();
  }, [acquire, poke]);

  useEffect(() => {
    const onVis = () => {
      if (wanted.current && document.visibilityState === "visible" && (!sentinel.current || sentinel.current.released)) void acquire();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      release();
    };
  }, [acquire, release]);

  return { supported, held, request, release, poke };
}
