"use client";

import { useEffect, useState } from "react";
import type { SpeechEngine, VoicePlayer } from "@/contracts";
import { normalizeForSpeech } from "./normalize";

const FIRST_BYTE_MS = 1500;

/** 0.1 s of 8-bit 8 kHz silence as a WAV blob URL; played in the "Start cooking" tap (autoplay policy). */
function silentWavUrl(): string {
  const n = 800;
  const b = new DataView(new ArrayBuffer(44 + n));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => b.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); b.setUint32(4, 36 + n, true); str(8, "WAVEfmt ");
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 8000, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true);
  str(36, "data"); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b.buffer], { type: "audio/wav" }));
}

/** ElevenLabs via /api/tts with an in-memory cache, falling back to speechSynthesis (SPEC F13). */
export function createVoicePlayer(): VoicePlayer & { dispose(): void } {
  const audio = new Audio();
  // ponytail: keyed by normalized text (voice/model are fixed server-side per deploy); hash if keys get large.
  const cache = new Map<string, Promise<string | null>>();
  const cbs = new Set<(speaking: boolean, engine: SpeechEngine | null) => void>();
  let speaking = false;
  let token = 0; // bumps on every speak/stop so stale async work can't start playback
  let elevenlabsOff = false; // 503 = no key configured; stop asking

  const emit = (s: boolean, engine: SpeechEngine | null) => {
    speaking = s;
    cbs.forEach((cb) => cb(s, engine));
  };

  function fetchAudio(text: string): Promise<string | null> {
    if (elevenlabsOff) return Promise.resolve(null);
    let p = cache.get(text);
    if (p) return p;
    p = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FIRST_BYTE_MS);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 503) elevenlabsOff = true;
        if (!res.ok) return null;
        return URL.createObjectURL(await res.blob());
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    })();
    cache.set(text, p);
    void p.then((url) => url ?? cache.delete(text)); // don't cache failures
    return p;
  }

  function speakBrowser(text: string, my: number): SpeechEngine {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = u.onerror = () => my === token && emit(false, null);
    speechSynthesis.speak(u);
    emit(true, "browser");
    return "browser";
  }

  const player: VoicePlayer & { dispose(): void } = {
    async unlock() {
      // Prime speechSynthesis too: iOS only allows it after it has spoken once inside a gesture.
      speechSynthesis.speak(new SpeechSynthesisUtterance(""));
      const url = silentWavUrl();
      audio.src = url;
      await audio.play().catch(() => {});
      URL.revokeObjectURL(url);
    },

    async speak(raw) {
      player.stop();
      const my = ++token;
      const text = normalizeForSpeech(raw);
      emit(true, null); // "speaking" while loading, so a second toggle cancels instead of restarting
      const url = await fetchAudio(text);
      if (my !== token) return url ? "elevenlabs" : "browser"; // stopped while loading (stop() already emitted)
      if (!url) return speakBrowser(text, my);
      audio.src = url;
      audio.onended = audio.onerror = () => my === token && emit(false, null);
      try {
        await audio.play();
        emit(true, "elevenlabs");
        return "elevenlabs";
      } catch {
        return speakBrowser(text, my);
      }
    },

    stop() {
      token++;
      audio.pause();
      speechSynthesis.cancel();
      if (speaking) emit(false, null);
    },

    prefetch(raw) {
      void fetchAudio(normalizeForSpeech(raw));
    },

    get speaking() {
      return speaking;
    },

    onChange(cb) {
      cbs.add(cb);
      return () => void cbs.delete(cb);
    },

    dispose() {
      player.stop();
      for (const p of cache.values()) void p.then((url) => url && URL.revokeObjectURL(url));
      cache.clear();
    },
  };
  return player;
}

/** One VoicePlayer per mounted cook view, plus which engine last spoke (for the "Voice:" label). */
export function useVoice() {
  const [player] = useState(() => (typeof window === "undefined" ? null : createVoicePlayer()));
  const [engine, setEngine] = useState<SpeechEngine | null>(null);

  useEffect(() => {
    if (!player) return;
    const off = player.onChange((_, e) => e && setEngine(e));
    return () => {
      off();
      player.dispose();
    };
  }, [player]);

  return { player, engine };
}
