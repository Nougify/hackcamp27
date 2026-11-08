# Mise

A hands-free cooking companion: scan pantry items, find recipes that match what you have and your diet, then cook with gesture/voice control. Built with Next.js (App Router), Auth0, Postgres/Tigerdata, Gemini, MediaPipe, and ElevenLabs TTS.

Full product spec, data model, and API contracts live in [`SPEC.md`](./SPEC.md).

## Prerequisites

- Node.js >= 22 (`node -v`)
- npm

## Setup

```bash
npm install
```

This also runs `scripts/copy-assets.mjs` (`postinstall`), which copies the MediaPipe and zxing WASM binaries into `public/` so the browser loads them locally instead of from a CDN.

## Running locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app currently runs against stub data where backend work is still in progress:
- `src/lib/current-user.ts` returns a placeholder user until Auth0 wiring lands.
- Cook mode can run against fixtures by setting `NEXT_PUBLIC_COOK_FIXTURES=true`.
- `/api/tts` needs `ELEVENLABS_API_KEY` set to return real audio; without it, voice features won't produce speech.

There is no `.env.example` yet — add required secrets (Auth0, database, Gemini, ElevenLabs) to a local `.env` as the corresponding workstreams land. See `SPEC.md` §8 for the full environment variable list.

## Other scripts

```bash
npm run lint       # eslint
npm run typecheck   # next typegen + tsc --noEmit
npm run test        # vitest
npm run build        # production build
npm run start         # serve production build
```

## Project structure

- `src/app` — routes (App Router): landing page, `(app)` shell (Today, Pantry, Recipes, Cook, Settings, Onboarding), API routes.
- `src/features` — client-side feature logic: `cook`, `gesture`, `voice`.
- `src/contracts` — shared domain/API types and fixtures used across workstreams before real endpoints land.
- `src/components/ui` — shared UI primitives.
- `src/lib` — server-only helpers (auth, db, etc. as they're added).
- `public/models`, `public/mediapipe`, `public/zxing` — gesture/vision model and WASM assets.

## Team workflow

This repo uses [Entire](./CLAUDE.md) for branch/trail-based review on top of Claude Code. See `CLAUDE.md` for the exact workflow, and `hang.md` / `jerry.md` / `johnny.md` for each workstream's task breakdown.
