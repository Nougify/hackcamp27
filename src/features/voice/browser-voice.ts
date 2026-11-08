import type { SpeechEngine, VoicePlayer } from "@/contracts";

// Phase 0 stub (SPEC 0.10): speechSynthesis only. Replaced by useVoice (ElevenLabs + fallback).
export function createBrowserVoicePlayer(): VoicePlayer {
  const cbs = new Set<(speaking: boolean, engine: SpeechEngine | null) => void>();
  let speaking = false;
  let current: SpeechSynthesisUtterance | null = null;
  const set = (s: boolean) => {
    speaking = s;
    cbs.forEach((cb) => cb(s, s ? "browser" : null));
  };

  return {
    async unlock() {},
    async speak(text) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      current = u;
      // A cancelled utterance fires onerror later; only the current one may clear `speaking`.
      u.onend = u.onerror = () => u === current && set(false);
      speechSynthesis.speak(u);
      set(true);
      return "browser";
    },
    stop() {
      current = null;
      speechSynthesis.cancel();
      set(false);
    },
    prefetch() {},
    get speaking() {
      return speaking;
    },
    onChange(cb) {
      cbs.add(cb);
      return () => void cbs.delete(cb);
    },
  };
}
