import type { SpeechEngine, VoicePlayer } from "@/contracts";

// Phase 0 stub (SPEC 0.10): speechSynthesis only. Replaced by useVoice (ElevenLabs + fallback).
export function createBrowserVoicePlayer(): VoicePlayer {
  const cbs = new Set<(speaking: boolean, engine: SpeechEngine | null) => void>();
  let speaking = false;
  const set = (s: boolean) => {
    speaking = s;
    cbs.forEach((cb) => cb(s, s ? "browser" : null));
  };

  return {
    async unlock() {},
    async speak(text) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.onend = u.onerror = () => set(false);
      speechSynthesis.speak(u);
      set(true);
      return "browser";
    },
    stop() {
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
