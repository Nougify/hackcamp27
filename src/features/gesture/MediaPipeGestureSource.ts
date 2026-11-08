import type { GestureRecognizer } from "@mediapipe/tasks-vision";
import type { CannedGesture, GestureAction, GestureConfig, GestureHud, GestureSource } from "@/contracts";
import { GestureEngine, type EngineFrame } from "./engine";

type HudError = NonNullable<GestureHud["error"]>;
const ALLOW: CannedGesture[] = ["Open_Palm", "Closed_Fist", "Thumb_Up", "Thumb_Down", "Victory", "Pointing_Up", "ILoveYou"];
const HUD_INTERVAL_MS = 100; // ≤ 10 Hz (contract)

function idleHud(state: GestureHud["state"], error?: HudError): GestureHud {
  return { state, pose: "None", holdProgress: 0, pendingAction: null, armedRemainingMs: 0, lastAction: null, hint: null, fps: 0, error };
}

/** Main-thread MediaPipe loop (SPEC §11.5). Camera frames stay in the browser; WASM + model are self-hosted. */
export class MediaPipeGestureSource implements GestureSource {
  private engine: GestureEngine;
  private actionCbs = new Set<(a: GestureAction) => void>();
  private hudCbs = new Set<(h: GestureHud) => void>();
  private recognizer: GestureRecognizer | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private raf = 0;
  private aborted = false;
  private lastVideoTime = -1;
  private lastProcessed = 0;
  private lastHandAt = 0;
  private lastHudAt = 0;
  private frames: number[] = [];
  /** Latest landmarks, for the NEXT_PUBLIC_GESTURE_DEBUG overlay. */
  landmarks: Array<{ x: number; y: number }> | null = null;

  constructor(private config: GestureConfig) {
    this.engine = new GestureEngine(config);
  }

  setConfig(c: GestureConfig) {
    this.config = c;
    this.engine.setConfig(c);
  }

  async start(video: HTMLVideoElement): Promise<void> {
    this.aborted = false;
    this.video = video;
    this.emitHud(idleHud("loading"));

    if (!navigator.mediaDevices?.getUserMedia) return this.emitHud(idleHud("error", "InsecureContext"));

    // Ask for the camera and load the model in parallel; either can fail independently.
    const camera = navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false })
      .then((s) => ({ ok: true as const, s }))
      .catch((e: DOMException) => ({ ok: false as const, e }));

    const releaseCamera = () => void camera.then((c) => c.ok && c.s.getTracks().forEach((t) => t.stop()));
    try {
      this.recognizer = await this.createRecognizer();
    } catch {
      // Report first: the camera prompt may never settle.
      if (!this.aborted) this.emitHud(idleHud("error", "ModelLoadFailed"));
      releaseCamera();
      return;
    }
    if (this.aborted) {
      // Unmounted while loading: free WASM/GPU now, not after an unanswered prompt.
      this.recognizer.close();
      this.recognizer = null;
      releaseCamera();
      return;
    }

    // An ignored permission prompt may never settle (SPEC §11.5): say we're waiting.
    // permission_needed with no error = waiting; with NotAllowedError = denied.
    let settled = false;
    void camera.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    if (!settled && !this.aborted) this.emitHud(idleHud("permission_needed"));

    const cam = await camera;
    if (this.aborted) {
      if (cam.ok) cam.s.getTracks().forEach((t) => t.stop());
      this.recognizer?.close();
      this.recognizer = null;
      return;
    }
    if (!cam.ok) {
      const name = cam.e.name === "NotFoundError" || cam.e.name === "NotReadableError" ? cam.e.name : "NotAllowedError";
      return this.emitHud(idleHud(name === "NotAllowedError" ? "permission_needed" : "error", name));
    }

    this.stream = cam.s;
    video.srcObject = cam.s;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    if (this.aborted) return this.stop();

    this.engine.reset();
    this.lastHandAt = performance.now();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.emitHud(idleHud("no_hand"));
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.aborted = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.recognizer?.close();
    this.recognizer = null;
    this.landmarks = null;
    this.emitHud(idleHud("off"));
  }

  onAction(cb: (a: GestureAction) => void) {
    this.actionCbs.add(cb);
    return () => void this.actionCbs.delete(cb);
  }

  onHud(cb: (h: GestureHud) => void) {
    this.hudCbs.add(cb);
    return () => void this.hudCbs.delete(cb);
  }

  private async createRecognizer(): Promise<GestureRecognizer> {
    const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const make = (delegate: "GPU" | "CPU") =>
      GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/gesture_recognizer.task", delegate },
        runningMode: "VIDEO",
        numHands: 1,
        cannedGesturesClassifierOptions: { scoreThreshold: this.config.classifierScoreThreshold, categoryAllowlist: ALLOW },
      });
    try {
      return await make(this.config.delegate);
    } catch (e) {
      if (this.config.delegate === "CPU") throw e;
      return make("CPU"); // GPU unavailable (or blocklisted): fall back
    }
  }

  private onVisibility = () => {
    cancelAnimationFrame(this.raf);
    if (document.visibilityState === "visible" && this.recognizer && !this.aborted) {
      this.engine.reset(); // never resume mid-hold after a pause
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private loop = () => {
    if (this.aborted || !this.recognizer || !this.video) return;
    this.raf = requestAnimationFrame(this.loop);

    const now = performance.now();
    const idle = now - this.lastHandAt > this.config.idleAfterMs;
    const fps = idle ? this.config.idleFps : this.config.targetFps;
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime || now - this.lastProcessed < 1000 / fps) return;
    this.lastVideoTime = v.currentTime;
    this.lastProcessed = now;

    let frame: EngineFrame = { hand: null };
    try {
      const r = this.recognizer.recognizeForVideo(v, now);
      const lm = r.landmarks[0];
      const g = r.gestures[0]?.[0];
      const aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : undefined;
      if (lm) frame = { hand: { landmarks: lm, gesture: (g?.categoryName || "None") as CannedGesture, score: g?.score ?? 0 }, aspect };
      this.landmarks = lm ?? null;
    } catch {
      return; // a single bad frame is not fatal
    }
    if (frame.hand) this.lastHandAt = now;

    this.frames.push(now);
    while (this.frames.length && this.frames[0] < now - 1000) this.frames.shift();

    for (const a of this.engine.update(frame, now)) this.actionCbs.forEach((cb) => cb(a));
    if (now - this.lastHudAt >= HUD_INTERVAL_MS) {
      this.lastHudAt = now;
      this.emitHud({ ...this.engine.hud(now), fps: this.frames.length });
    }
  };

  private emitHud(h: GestureHud) {
    this.hudCbs.forEach((cb) => cb(h));
  }
}
