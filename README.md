# Mise

A hands-free cooking companion: scan pantry items, find recipes that match what you have and your diet, then cook with gesture/voice control. Built with Next.js (App Router), Auth0, Postgres/Tigerdata, Gemini, MediaPipe, and ElevenLabs TTS.

Full product spec, data model, and API contracts live in [`SPEC.md`](./SPEC.md).

## Prerequisites

- Node.js >= 22 (`node -v`)
- npm
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud --version`), used to sign in to Vertex AI for Gemini
- Access to the team's Google Cloud project: ask the project owner to grant your Google account the **Vertex AI User** role (`roles/aiplatform.user`)

## Setup

```bash
npm install
```

This also runs `scripts/copy-assets.mjs` (`postinstall`), which copies the MediaPipe and zxing WASM binaries into `public/` so the browser loads them locally instead of from a CDN.

### Environment variables

```bash
cp .env.example .env.local
```

Fill in the values (ask a teammate for the shared Auth0, database and barcode keys). See `SPEC.md` §8 for the full list.

### Gemini (Vertex AI)

Gemini runs on Vertex AI with Application Default Credentials (ADC), so there is no Gemini API key. Each developer signs in with their own Google account:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project <PROJECT_ID>
```

Then set `GOOGLE_CLOUD_PROJECT=<PROJECT_ID>` in `.env.local` (`GOOGLE_CLOUD_LOCATION` defaults to `global`). Check it works with:

```bash
node --env-file=.env.local scripts/gemini-smoke.mjs
```

### Database

```bash
npm run migrate
```

## Running locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- Cook mode can run against fixtures by setting `NEXT_PUBLIC_COOK_FIXTURES=true`.
- `/api/tts` uses ElevenLabs when `ELEVENLABS_API_KEY` is set; without it, voice falls back to the browser's built-in speech.

## Deployment

Production runs with `docker compose up -d --build` on the VPS. The server can't sign in through a browser, so it uses a service-account key:

1. Create a service account with the **Vertex AI User** role and download its key as `gcp-sa.json`.
2. Copy it next to `docker-compose.yml` on the server (`chmod 600`). It is gitignored; never commit or share it.
3. Put `GOOGLE_CLOUD_PROJECT` in `.env.production`, and set `GOOGLE_CLOUD_LOCATION=global` (or leave it out). A regional value like `us-central1` makes Gemini calls fail with "model not found". `docker-compose.yml` mounts the key and sets `GOOGLE_APPLICATION_CREDENTIALS`.

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
