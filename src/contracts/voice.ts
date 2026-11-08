export type SpeechEngine = 'elevenlabs' | 'browser';
export interface VoicePlayer {
  unlock(): Promise<void>;                          // call inside the "Start cooking" tap
  speak(text: string, opts?: { cacheKey?: string }): Promise<SpeechEngine>;
  stop(): void;
  prefetch(text: string): void;                     // warm cache for next step
  readonly speaking: boolean;
  onChange(cb: (speaking: boolean, engine: SpeechEngine | null) => void): () => void;
}
