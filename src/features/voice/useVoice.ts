"use client";

import { useEffect, useState } from "react";
import type { SpeechEngine, VoicePlayer } from "@/contracts";
import { normalizeForSpeech } from "./normalize";

const FIRST_BYTE_MS = 1500;
// 0.1 s of silence; played inside the "Start cooking" tap to satisfy autoplay policy.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** ElevenLabs via /api/tts with an in-memory cache, falling back to speechSynthesis (SPEC F13). */
export function createVoicePlayer(): VoicePlayer {
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

  const player: VoicePlayer = {
    async unlock() {
      audio.src = SILENT_WAV;
      await audio.play().catch(() => {});
    },

    async speak(raw) {
      player.stop();
      const my = ++token;
      const text = normalizeForSpeech(raw);
      const url = await fetchAudio(text);
      if (my !== token) return url ? "elevenlabs" : "browser"; // stopped while loading
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
  };
  return player;
}

/** One VoicePlayer per mounted cook view, plus which engine last spoke (for the "Voice:" label). */
export function useVoice() {
  const [player] = useState(() => (typeof window === "undefined" ? null : createVoicePlayer()));
  const [engine, setEngine] = useState<SpeechEngine | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!player) return;
    const off = player.onChange((s, e) => {
      setSpeaking(s);
      if (e) setEngine(e);
    });
    return () => {
      off();
      player.stop();
    };
  }, [player]);

  return { player, engine, speaking };
}
