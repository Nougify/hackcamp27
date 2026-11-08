"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CookingController, CookSessionView, VoicePlayer } from "@/contracts";
import { Badge, Button, buttonClass } from "@/components/ui";
import { createBrowserVoicePlayer } from "@/features/voice";
import { askNotificationPermission, ringAlarm, unlockAudio } from "./alarm";
import { getSession, patchSession } from "./api";
import { initCookState, makeCookReducer } from "./reducer";
import { clearCook, loadCook, saveCook, type SavedCook } from "./resume";
import { formatMs, parseDurationSeconds, timerMs } from "./timers";
import { useWakeLock } from "./wake-lock";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; view: CookSessionView };

export function CookView({ sessionId }: { sessionId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getSession(sessionId)
      .then((view) => !cancelled && setLoad({ status: "ready", view }))
      .catch((e: Error) => !cancelled && setLoad({ status: "error", message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (load.status === "loading") return <Shell><p className="text-2xl text-muted">Loading recipe…</p></Shell>;
  if (load.status === "error")
    return (
      <Shell>
        <p className="text-2xl">We couldn&apos;t load this cooking session.</p>
        <p className="mt-2 text-muted">{load.message}</p>
        <Link href="/recipes" className={buttonClass("secondary", "lg", "mt-6")}>Back to recipes</Link>
      </Shell>
    );
  if (load.view.session.status !== "in_progress")
    return (
      <Shell>
        <p className="text-2xl">This cooking session is already {load.view.session.status}.</p>
        <Link href="/today" className={buttonClass("primary", "lg", "mt-6")}>Go to Today</Link>
      </Shell>
    );
  return <Cooking view={load.view} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="theme-cook flex min-h-dvh flex-1 flex-col items-start justify-center px-6 py-10">{children}</main>;
}

function Cooking({ view }: { view: CookSessionView }) {
  const { session, steps, recipe } = view;
  const router = useRouter();
  const reducer = useMemo(() => makeCookReducer(steps), [steps]);
  const [state, dispatch] = useReducer(reducer, session.currentStep, initCookState);
  const [started, setStarted] = useState(false);
  // Offer resume from localStorage (< 12 h), else from the server's currentStep.
  const [saved] = useState<SavedCook | null>(() => {
    const local = loadCook(session.id);
    if (local && (local.stepIndex > 0 || local.timers.length)) return local;
    return session.currentStep > 0 ? { sessionId: session.id, stepIndex: session.currentStep, timers: [], updatedAt: 0 } : null;
  });
  // aria-live region written directly, so announcements don't cause re-renders.
  const live = useRef<HTMLDivElement>(null);
  const say = (text: string) => {
    if (live.current) live.current.textContent = text;
  };
  const [now, setNow] = useState(() => Date.now());
  const wake = useWakeLock();
  const { poke } = wake;
  const voice = useRef<VoicePlayer | null>(null);

  const step = steps[state.stepIndex];
  const total = steps.length;
  const stepTimer = state.timers.find((t) => t.stepIndex === state.stepIndex);
  const stepIngredients = view.ingredients.filter((i) => i.usedInSteps.includes(state.stepIndex));

  useEffect(() => {
    voice.current = createBrowserVoicePlayer();
    const off = voice.current.onChange((speaking) => dispatch({ type: "speaking", speaking }));
    return () => {
      off();
      voice.current?.stop();
    };
  }, []);

  // Persist on every change; debounce the server PATCH to 2 s (SPEC F11).
  useEffect(() => {
    if (!started) return;
    saveCook({ sessionId: session.id, stepIndex: state.stepIndex, timers: state.timers, updatedAt: Date.now() });
  }, [started, session.id, state.stepIndex, state.timers]);

  const sentStep = useRef(session.currentStep);
  const stepRef = useRef(state.stepIndex);
  useEffect(() => {
    stepRef.current = state.stepIndex;
  }, [state.stepIndex]);
  const sendStep = useCallback(
    (keepalive = false) => {
      const step = stepRef.current;
      if (step === sentStep.current) return;
      sentStep.current = step;
      patchSession(session.id, { currentStep: step }, keepalive).catch(() => {});
    },
    [session.id],
  );
  useEffect(() => {
    if (!started) return;
    const t = setTimeout(() => sendStep(), 2000);
    return () => clearTimeout(t);
  }, [started, state.stepIndex, sendStep]);
  // Flush a pending step on exit/unmount/tab close instead of dropping it.
  useEffect(() => {
    const flush = () => sendStep(true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [sendStep]);

  // Tick while any timer runs; check immediately when the tab comes back (hidden tabs are throttled).
  const running = state.timers.some((t) => t.status === "running");
  useEffect(() => {
    const tick = () => {
      const n = Date.now();
      setNow(n);
      dispatch({ type: "tick", now: n });
    };
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    const id = running ? setInterval(tick, 500) : undefined;
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running]);

  useEffect(() => {
    for (const t of state.fired) {
      ringAlarm(t.label);
      say(`Timer done: ${t.label}`);
    }
  }, [state.fired]);

  // Step change stops speech and is announced (F11 AC1).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    voice.current?.stop();
    say(`Step ${state.stepIndex + 1} of ${total}`);
    window.scrollTo({ top: 0 });
  }, [state.stepIndex, total]);

  const controller: CookingController = useMemo(
    () => ({
      nextStep: () => {
        poke();
        dispatch({ type: "next" });
      },
      prevStep: () => {
        poke();
        dispatch({ type: "prev" });
      },
      scroll: (direction) => {
        poke();
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollBy({ top: (direction === "down" ? 0.4 : -0.4) * innerHeight, behavior: reduce ? "auto" : "smooth" });
      },
      toggleTimer: () => {
        poke();
        askNotificationPermission();
        const n = Date.now();
        setNow(n); // the tick interval only starts on the next render
        dispatch({ type: "toggleTimer", now: n });
      },
      toggleSpeak: () => {
        poke();
        const v = voice.current;
        if (!v) return;
        if (v.speaking) v.stop();
        else void v.speak(step.text, { cacheKey: `${session.id}:${step.index}` });
      },
    }),
    [poke, step, session.id],
  );

  // Announce timer start/pause for the current step.
  const prevTimerStatus = useRef(stepTimer?.status);
  useEffect(() => {
    const s = stepTimer?.status;
    if (s && s !== prevTimerStatus.current && (s === "running" || s === "paused")) {
      say(s === "running" ? "Timer started" : "Timer paused");
    }
    prevTimerStatus.current = s;
  }, [stepTimer?.status]);

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof Element && e.target.closest("input, textarea, select, dialog"))) return;
      const map: Record<string, () => void> = {
        ArrowRight: controller.nextStep,
        ArrowLeft: controller.prevStep,
        ArrowUp: () => controller.scroll("up"),
        PageUp: () => controller.scroll("up"),
        ArrowDown: () => controller.scroll("down"),
        PageDown: () => controller.scroll("down"),
        t: controller.toggleTimer,
        T: controller.toggleTimer,
        " ": controller.toggleTimer,
        r: controller.toggleSpeak,
        R: controller.toggleSpeak,
      };
      const fn = map[e.key];
      if (!fn || e.repeat) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, controller]);

  // The "Start cooking" tap: unlock audio + voice and take the wake lock inside the user gesture.
  const start = (resume: SavedCook | null) => {
    unlockAudio();
    void voice.current?.unlock();
    void wake.request();
    if (resume) dispatch({ type: "restore", stepIndex: resume.stepIndex, timers: resume.timers });
    else {
      clearCook(session.id);
      dispatch({ type: "restore", stepIndex: 0, timers: [] });
    }
    setStarted(true);
  };

  const exit = () => {
    voice.current?.stop();
    wake.release();
    router.push("/recipes");
  };

  if (!started) {
    return (
      <Shell>
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">Cook mode</p>
        <h1 className="mt-2 font-display text-4xl font-semibold lg:text-5xl">{recipe.title}</h1>
        <Attribution view={view} />
        <p className="mt-6 max-w-xl text-lg text-muted">
          {total} steps. The screen stays on while you cook. Use the big buttons, the arrow keys, or turn on hands-free.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          {saved ? (
            <>
              <Button size="lg" onClick={() => start(saved)}>Resume at step {saved.stepIndex + 1}</Button>
              <Button size="lg" variant="secondary" onClick={() => start(null)}>Start over</Button>
            </>
          ) : (
            <Button size="lg" onClick={() => start(null)}>Start cooking</Button>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <main className="theme-cook flex min-h-dvh flex-1 flex-col" onPointerDown={wake.poke}>
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-semibold">{recipe.title}</p>
            <p className="text-sm text-muted">
              Step {state.stepIndex + 1} of {total}
              {recipe.isAdapted && <Badge tone="ai" className="ml-2">AI-adapted</Badge>}
            </p>
          </div>
          {wake.supported && wake.held && <Badge tone="accent">Screen stays on</Badge>}
          <Button variant="ghost" onClick={exit}>Exit</Button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full bg-accent transition-[width]" style={{ width: `${((state.stepIndex + 1) / total) * 100}%` }} />
        </div>
      </header>

      <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        <p className="text-[32px] font-medium leading-snug lg:text-[40px]">{step.text}</p>

        {stepIngredients.length > 0 && (
          <ul className="mt-8 space-y-2 text-xl">
            {stepIngredients.map((ing) => (
              <li key={ing.text} className="flex flex-wrap items-baseline gap-x-3">
                {ing.scaledQtyDisplay && <span className="font-semibold text-accent">{ing.scaledQtyDisplay}</span>}
                <span>{ing.text}</span>
                {ing.changed && <Badge tone="ai">AI-adapted</Badge>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10">
          <Attribution view={view} />
        </div>
      </section>

      <footer className="sticky bottom-0 border-t border-line bg-bg/95 backdrop-blur">
        {state.timers.length > 0 && (
          <ul className="flex gap-2 overflow-x-auto px-4 pt-3" aria-label="Timers">
            {state.timers.map((t) => (
              <li key={t.id}>
                <span
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-mono text-lg ${
                    t.status === "done" ? "border-warn bg-warn-soft text-warn" : "border-line bg-surface"
                  }`}
                >
                  <span className="font-sans text-sm text-muted">{t.label}</span>
                  {formatMs(timerMs(t, now))}
                  <span className="font-sans text-sm">{t.status === "done" ? "Done" : t.status === "paused" ? "Paused" : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-4 gap-2 p-3">
          <Button size="lg" variant="secondary" className="min-h-18" onClick={controller.prevStep} disabled={state.stepIndex === 0}>
            ← Prev
          </Button>
          <Button size="lg" variant="secondary" className="min-h-18" onClick={controller.toggleTimer}>
            {stepTimer?.status === "running" ? "Pause" : stepTimer?.kind === "stopwatch" || (!stepTimer && !(step.timerSeconds ?? parseDurationSeconds(step.text))) ? "Stopwatch" : "Timer"}
          </Button>
          <Button size="lg" variant="secondary" className="min-h-18" onClick={controller.toggleSpeak}>
            {state.speaking ? "Stop" : "Read"}
          </Button>
          <Button size="lg" className="min-h-18" onClick={controller.nextStep} disabled={state.stepIndex === total - 1}>
            Next →
          </Button>
        </div>
      </footer>

      <div ref={live} aria-live="polite" className="sr-only" />
    </main>
  );
}

function Attribution({ view }: { view: CookSessionView }) {
  const { source } = view.recipe;
  return (
    <p className="mt-3 text-sm text-muted">
      From {source.siteName}
      {source.author && ` by ${source.author}`} ·{" "}
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">View original</a>
    </p>
  );
}
