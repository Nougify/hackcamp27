# Jerry: Cook Mode (Workstream A) + app shell

All three of us start at the same time. Source of truth is `SPEC.md`; section numbers point into it.
Branch: `jerry/<feature>`. Only edit files you own. Ask in chat before touching anyone else's.

## Hour 0: foundation slice (parallel with Johnny and Hang)

- [ ] **First, within about 10 minutes:** `create-next-app` (TS, App Router, `src/`, Tailwind, ESLint) and pin every §4 dependency exactly. Push to `main`, since everyone else builds on this. While you do it, Johnny and Hang are setting up their accounts.
- [ ] Contracts `src/contracts/{domain,api,gesture,voice,index}.ts` + `fixtures/*`, copied verbatim from §6–§7. Push quickly. Until it lands, the others code against the spec text.
- [ ] `src/components/ui/**`, `app/layout.tsx`, `globals.css`, landing `page.tsx`, `(app)/layout.tsx` nav (Today, Pantry, Recipes, Settings), and empty "TODO (owner)" pages. Use a placeholder `requireUser` until Johnny's auth lands.
- [ ] `KeyboardGestureSource` mock + `speechSynthesis` `VoicePlayer` stub (0.10)
- [ ] `scripts/copy-assets.mjs` (MediaPipe WASM + model, zxing WASM)
- [ ] Resolve §17 items 8, 9, 12, 13, 14, 16

**You alone own `package.json`.** Johnny and Hang send you dependency requests (§18.5).

## Workstream A: Cook Mode (§18.3)

**Owns:** `src/features/{gesture,cook,voice}/**`, `src/app/(app)/cook/**`, `src/app/api/tts/**`, `public/mediapipe/**`, `public/models/**`
**Consumes (Hang's, use fixtures until they land):** `GET/PATCH /api/cook/sessions/:id`, `GET …/finish-preview`, `POST …/finish`
**Provides:** `CookingController`, `VoicePlayer`, MediaPipe `GestureSource`, `FinishDialog`, `/api/tts`

- [ ] 1. Cook view with reducer + keyboard (F11)
- [ ] 2. Timers: duration parsing, absolute-time model
- [ ] 3. Wake lock
- [ ] 4. Resume
- [ ] 5. `normalizeForSpeech`
- [ ] 6. `/api/tts` (ElevenLabs, §10.5)
- [ ] 7. `useVoice` with cache, prefetch, fallback (F13)
- [ ] 8. `GestureEngine` (pure) + tests (§11)
- [ ] 9. `MediaPipeGestureSource`, HUD, hands-free toggle (F12, §10.6)
- [ ] 10. `FinishDialog` against contracts (F14 UI)
- [ ] 11. Settings panel for gesture config
- [ ] 12. False-trigger test + threshold tuning

**Done:** F11–F13 ACs pass, F14 UI works against fixtures, §14.2 gesture/timer/voice tests pass.
