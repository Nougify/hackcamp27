# Mise: build spec for a hands-free pantry-to-plate cooking app

This SPEC.md specifies **Mise** (working name; rename freely), a Next.js web app built at HackCamp 2026 (nwPlus, UBC Vancouver, Nov 7–8, 2026). Users sign in with **Auth0**, add groceries by barcode, keep a per-user pantry with quantities and expiry dates in **Tiger Data** (TimescaleDB/Postgres), and get **real recipes found online by Gemini**, ranked toward whatever expires soonest. The original recipe is always shown first with attribution; an "AI-adapted" variant appears only when an ingredient is missing. Users cook hands-free with **MediaPipe** webcam gestures (scroll, next/previous step, timer, read aloud), with steps read aloud by **ElevenLabs** and `speechSynthesis` as the fallback. Finishing a recipe deducts what was used from the pantry and logs calories and protein in one database transaction. The app is served over HTTPS from a **Vultr** VPS, which the camera requires. The spec is written so three Claude Code accounts can build it in parallel through **Entire**. A Phase 0 foundation freezes the contracts in `src/contracts/`, the SQL schema and the stubs. After that, three workstreams (Cook Mode, Pantry & Nutrition, Recipes & Cooking Backend) each own separate directories, and an integration phase merges them. Researched facts are cited inline. Anything not confirmed against a primary source in research is marked **[VERIFY]**, and the open items are collected in §17. Treat those as the first things to check, not as settled.

---

## 0. How to use this document

- **Who reads this:** three Claude Code agents (one per teammate account) plus the humans steering them. Each agent reads §1–§8 (shared ground truth), its own workstream in §18, and the relevant feature sections in §9.
- **Source of truth order:** `src/contracts/**` (code) > this SPEC > comments. If the SPEC and the contracts disagree after Phase 0, the contracts win. Raise the mismatch with a human; don't silently diverge.
- **Markers:** **[VERIFY]** = not confirmed against a primary source during research; check before relying on it. **P0** = required for the demo, **P1** = should have, **P2** = stretch.
- Anthropic's guidance for specs like this: "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step." Keep CLAUDE.md short ([Claude Code best practices](https://code.claude.com/docs/en/best-practices.md)). This spec follows both.

---

## 1. Overview, goals and non-goals

### 1.1 Problem and pitch

Home cooks waste food they forgot they had, and following a recipe on a phone or laptop with wet, floury hands is awkward. Screens dim and you lose your place. Mise closes the loop: **scan groceries → know what expires → cook a real recipe that uses it → touch nothing while cooking → pantry and nutrition update themselves.** HackCamp's challenge is to "identify a problem facing a community and build a solution that makes a meaningful difference". Judging covers Problem & User Research, Innovation, Technical Implementation, Design & UX, and Presentation ([HackCamp 2026 Devpost](https://hackcamp-2026.devpost.com/)).

### 1.2 Goals (all confirmed by the team)

| # | Goal | Priority |
|---|---|---|
| G1 | Web app: Next.js App Router + TypeScript, deployed on Vultr over HTTPS | P0 |
| G2 | Auth0 login. Every pantry item, recipe, session and meal belongs to one user | P0 |
| G3 | Tiger Data (TimescaleDB/Postgres) as the only database | P0 |
| G4 | Add groceries by barcode, scanned with the camera or typed. Lookup chain: **dataandapis.com → Open Food Facts → Gemini reads a product/label photo → manual form** | P0 |
| G5 | Expiry date from a photo of the printed date (Gemini reads it, user confirms) or typed in | P0 |
| G6 | Pantry tracks quantities and expiry dates, and deducts ingredients after cooking | P0 |
| G7 | Gemini finds **real recipes online**, shown **original-first with source attribution**, ranked to prefer items closest to expiry | P0 |
| G8 | Only when an ingredient is missing, AI may propose an adaptation, clearly marked **"AI-adapted"** and kept separate from the original | P0 |
| G9 | MediaPipe hand gestures: scroll up/down, next/previous step, start/pause step timer, read step aloud | P0 |
| G10 | Read aloud with ElevenLabs, falling back to browser `speechSynthesis` | P0 |
| G11 | Nutrition per pantry item and per recipe serving. Strict, code-enforced diet/allergy filters. Daily calorie and protein tracking | P0 |
| G12 | Meals logged through a "Finish cooking" prompt (servings eaten) and through manual logging | P0 |
| G13 | Built by 3 Claude Code accounts collaborating through Entire (Sessions, Graph, Brain, Trails) | P0 |

### 1.3 Non-goals (explicitly out of scope)

- Native mobile apps. PWA install/offline mode is also out (the site should still work in mobile browsers).
- Writing recipes from scratch with AI. The AI only *finds* recipes and *adapts* them when ingredients are missing.
- Medical or dietetic advice, or certified allergen guarantees. The app filters strictly but tells users to check labels.
- Shopping lists, grocery ordering, price tracking, meal planning calendars.
- Sharing pantries between users or households, and any social features.
- Contributing products back to Open Food Facts, which would need an OFF account for writes ([OFF API intro](https://openfoodfacts.github.io/openfoodfacts-server/api/)).
- Voice *commands* (speech recognition) are P2 only. The P0 hands-free channel is gestures plus read-aloud.
- Moving gesture inference to a Web Worker (P2; see §11.7).
- Hosted vector search or "similar recipes" (P2).

### 1.4 Glossary

- **Original recipe:** the recipe exactly as parsed from the publisher's page (schema.org `Recipe`), with attribution. Never modified.
- **AI-adapted recipe:** a separate object that references an original and lists explicit substitutions for missing ingredients.
- **Base units:** grams (mass), millilitres (volume), `count` (pieces). Every stored quantity uses one of them.
- **GTIN:** the canonical 13-digit (or 14-digit) barcode key. UPC-A is left-padded with `0`.
- **FEFO:** first-expired-first-out, the rule for choosing which pantry row to deduct from.
- **Armed:** the gesture state in which commands are accepted. Users arm it by holding an open palm.

---

## 2. User flows

Each flow lists its happy path, then its branches. Feature IDs (F#) refer to §9.

### UF1: Sign in and onboarding (F1)
1. A visitor lands on `/`. The marketing hero has a "Sign in" button that links to `/auth/login` (Auth0 Universal Login).
2. After callback, the first authenticated request upserts a `users` row keyed by Auth0 `sub`.
3. If `onboarded_at` is null, redirect to `/onboarding`. There the user sets diets (vegetarian, vegan, gluten-free, dairy-free, high-protein), allergens, daily kcal and protein goals (optional), and time zone (default `America/Vancouver`).
4. The user lands on `/today`.

### UF2: Add a grocery by barcode (F2, F4, F5)
1. `/pantry/add` opens the camera scanner, with the **"Type barcode" input always visible**.
2. A code is accepted after 2 identical consecutive reads and a valid check digit. The client calls `POST /api/products/lookup`.
3. **Found** (cache, dataandapis or OFF): show a confirmation card with name, brand, image, nutrition per 100 g, package size, and source attribution ("Data: Open Food Facts, ODbL").
4. The user sets quantity (pre-filled from package size when known) and unit, then sets expiry: **"Photo of date"** (UF4) or **"Enter date"** or "No date".
5. Save. The item appears in `/pantry`, sorted by soonest expiry.
- **Branch, not found:** "We couldn't find this product." → **"Take photo of product & nutrition label"** (UF3) → if that fails or is declined → **manual form**. The manual form is reachable from every step.
- **Branch, provider down** (401/402/429/5xx/timeout): treated as a miss for the user, logged server-side. The flow continues to OFF, then to the photo step.

### UF3: Product from a label photo (F3)
1. The user captures 1–3 photos (front, nutrition panel, optional side). The client downscales them to about 1600 px on the long edge, JPEG q≈0.85.
2. `POST /api/vision/label` → Gemini returns a draft and the server runs sanity checks.
3. The manual form opens **pre-filled**. Flagged fields are highlighted. The user must press **Confirm** before anything is saved (`userVerified=true`).

### UF4: Expiry date from a photo (F4)
1. The user takes a close photo of the printed date.
2. `POST /api/vision/expiry` → the server assembles a date from Gemini's components and cross-checks it with a CFIA regex.
3. A date picker opens pre-filled, with the raw text shown ("Read: `BB/MA 2026 NO 15`"). If the order is ambiguous, the user picks from the candidates. **The user must confirm.** "Packaged on" dates are never accepted as expiry; instead the UI says "This looks like a packaged-on date".

### UF5: Find recipes (F6, F7, F10)
1. `/recipes` shows chips for expiring-soon items (≤ 3 days, pre-selected) and a "Find recipes" button. The user's diet/allergy filters appear as locked chips with a link to Settings.
2. `POST /api/recipes/search` streams progress ("Searching the web… / Reading 8 recipe pages… / Checking your allergies…"), then candidate cards arrive one by one.
3. Each card shows the title, the **source site and author**, coverage ("You have 7 of 9 ingredients"), the expiring items it uses (badge "uses spinach, expires in 2 days"), missing-ingredient count, ≈kcal and protein per serving, and total time.
4. Candidates that break a diet or allergy filter never appear. A collapsed "N recipes hidden by your filters" note lists them by reason (no recipe content shown).

### UF6: Recipe detail, original first, optional adaptation (F8, F9, F10)
1. `/recipes/[recipeId]` shows the **Original** card first: title, "From {siteName} by {author}", a "View original" link, ingredients exactly as published (each marked have / missing / staple), steps, and nutrition (our estimate with coverage, plus "Publisher's nutrition" if the page provided it).
2. If the recipe has missing ingredients, a secondary button reads **"Suggest an AI adaptation using my pantry"**. Pressing it calls `POST /api/recipes/[id]/adapt`. The result appears in a **separate card with an "AI-adapted" badge** on a different background. It lists substitutions ("Missing: buttermilk → Using: Greek yogurt + lemon (from your pantry)"), changed steps, warnings, and re-estimated nutrition.
3. "Cook original" and "Cook AI-adapted" (when present) are separate buttons, each with a servings stepper.

### UF7: Cook hands-free (F11, F12, F13)
1. "Cook" → `POST /api/cook/sessions` → `/cook/[sessionId]`. The **"Start cooking" tap** unlocks audio and requests a screen wake lock.
2. One step per screen, in large type. The step's ingredients and quantities are listed and timer chips are docked at the bottom.
3. A **"Hands-free" toggle** loads MediaPipe lazily, asks for camera permission, and shows the HUD with a gesture legend. Open palm (hold) arms the system. Then swipe = next/previous, thumb up/down (hold) = scroll, fist (hold) = timer start/pause, victory sign (hold) = read step aloud / stop.
4. Each control also has big tap targets and keyboard shortcuts.
5. Refreshing or reopening the page offers "Resume at step 5?". Timers continue correctly because they are stored as absolute end times.

### UF8: Finish cooking (F14)
1. On the last step (or any time from the menu) → **"Finish cooking"** dialog.
2. The dialog shows **Servings cooked** (default = planned), **Servings you ate** (default 1; 0 allowed), and a **deduction preview** with one line per matched pantry item ("Spinach: 150 g of 200 g → 50 g left"). Lines are editable and can be unchecked. Lines the app couldn't convert are flagged "Adjust manually". The nutrition for the servings eaten is editable.
3. Confirm → one transaction deducts the pantry, writes pantry events, inserts the meal log and closes the session → navigate to `/today` with a toast ("Logged 1 serving · 540 kcal · 32 g protein").

### UF9: Daily tracking and manual logging (F15)
1. `/today` shows kcal and protein rings against the goals, today's meals list, a 7-day bar chart, and "Expiring soon" pantry items.
2. **"Log food"** offers three tabs: *From pantry* (pick item + amount; "Also remove from pantry" checkbox, default on), *Scan* (barcode → product → amount), *Quick add* (label + kcal + protein).
3. The user can delete a meal from today's list.

---

## 3. Architecture

### 3.1 System diagram

```
                         ┌──────────────────────── Browser (HTTPS secure context) ─────────────────────────┐
                         │  Next.js client components                                                        │
                         │  ┌──────────────┐  ┌───────────────────┐  ┌──────────────┐  ┌──────────────────┐ │
                         │  │ Scanner       │  │ Cook mode UI      │  │ Voice player │  │ Today / Pantry / │ │
                         │  │ BarcodeDetector│  │ steps, timers,    │  │ <audio> +    │  │ Recipes pages    │ │
                         │  │ (native or    │  │ wake lock, resume │  │ speechSynth  │  │                  │ │
                         │  │ zxing-wasm)   │  │ (localStorage)    │  │ fallback     │  │                  │ │
                         │  └──────┬───────┘  └───────┬───────────┘  └──────┬───────┘  └────────┬─────────┘ │
                         │         │      ┌───────────┴────────────┐        │                   │           │
                         │         │      │ GestureController      │        │                   │           │
                         │         │      │ MediaPipe tasks-vision │  camera frames NEVER leave the device  │
                         │         │      │ (WASM, self-hosted)    │        │                   │           │
                         │         │      └────────────────────────┘        │                   │           │
                         └─────────┼────────────────────┼───────────────────┼───────────────────┼───────────┘
                                   │ fetch (JSON / multipart / NDJSON / audio)                    │
┌──────────────────────────────────▼────────────────────▼───────────────────▼───────────────────▼───────────┐
│ Vultr VPS (Ubuntu, Docker)                                                                                │
│  Caddy 2 (TLS via Let's Encrypt, :80/:443)  ──reverse_proxy──►  Next.js standalone (Node 22) :3000        │
│                                                                  ├─ src/proxy.ts → auth0.middleware()     │
│                                                                  ├─ /auth/* (Auth0 SDK routes)            │
│                                                                  ├─ /api/* route handlers (Node runtime)  │
│                                                                  │    requireUser() on every handler      │
│                                                                  └─ src/server/** domain logic            │
└───────┬───────────────┬──────────────────┬──────────────────┬──────────────────┬──────────────┬──────────┘
        │               │                  │                  │                  │              │
        ▼               ▼                  ▼                  ▼                  ▼              ▼
   Auth0 tenant   Tiger Cloud        dataandapis.com     Open Food Facts     Gemini API     ElevenLabs
   (Universal     (Postgres +        Barcode Lookup      v2 product API      (grounded      TTS stream
    Login)        TimescaleDB,       (X-Api-Key)         (custom UA)         search, vision, (xi-api-key)
                  us-east-1)                                                  JSON output)
                                                                                   │
                                                                                   ▼
                                                                        Publisher recipe pages
                                                                        (server-side fetch →
                                                                         schema.org Recipe JSON-LD)
```

Key properties:
- **All third-party keys live on the server.** The browser talks only to our origin, plus the Auth0 Universal Login pages.
- **Camera frames never leave the device.** MediaPipe runs in the browser via WASM, and the model and WASM are self-hosted ([Gesture recognition guide for Web](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js)). Barcode decoding also runs locally. Only *still photos the user explicitly takes* for label or expiry reading go to Gemini, through our server.
- **Long-lived Node process.** Tiger's free services exclude connection pooling ([Tiger docs: create a service](https://www.tigerdata.com/docs/get-started/quickstart/create-service)). We hold one small postgres.js pool per process, which works on a VPS but would not suit serverless.

### 3.2 Repository layout and ownership

Owners: **P0** = Phase 0 (foundation, frozen after Phase 0), **A** = Cook Mode, **B** = Pantry & Nutrition, **C** = Recipes & Cooking Backend. See §18.

```
/
├─ SPEC.md, CLAUDE.md, TASKS.md, .env.example            P0 (SPEC/CLAUDE edits by humans only)
├─ package.json, package-lock.json                       P0 (dependency changes: see §18.5)
├─ Dockerfile, docker-compose.yml, Caddyfile             P0 (C handles deploy tweaks in integration)
├─ next.config.ts (output: 'standalone', headers/CSP)    P0
├─ db/migrations/0001_init.sql, 0002_timescale.sql       P0 (changes: coordinated commit, §18.5)
├─ scripts/migrate.mjs                                   P0
├─ scripts/copy-assets.mjs (MediaPipe wasm + model, zxing wasm → public/)   P0
├─ public/mediapipe/wasm/*, public/models/gesture_recognizer.task           A
├─ public/zxing/*                                                            B
└─ src/
   ├─ proxy.ts                                           P0
   ├─ contracts/  domain.ts api.ts gesture.ts voice.ts index.ts fixtures/*   P0 (FROZEN)
   ├─ lib/        auth0.ts db.ts current-user.ts env.ts http.ts units.ts gtin.ts
   │              rate-limit.ts gemini/{client.ts,schemas.ts}                P0
   ├─ components/ui/**  (design tokens, Button, Card, Badge, Dialog, Toast) P0
   ├─ app/
   │   ├─ layout.tsx, globals.css, page.tsx (landing)    P0
   │   ├─ (app)/layout.tsx (auth gate + nav)             P0
   │   ├─ (app)/onboarding/**, (app)/settings/**         B
   │   ├─ (app)/today/**, (app)/pantry/**                B
   │   ├─ (app)/recipes/**                               C
   │   ├─ (app)/cook/[sessionId]/**                      A
   │   └─ api/
   │       ├─ me/route.ts                                B
   │       ├─ products/lookup/route.ts                   B
   │       ├─ vision/label/route.ts, vision/expiry/route.ts   B
   │       ├─ pantry/route.ts, pantry/[id]/route.ts      B
   │       ├─ meals/route.ts, meals/[id]/route.ts        B
   │       ├─ nutrition/today/route.ts, nutrition/history/route.ts  B
   │       ├─ recipes/search/route.ts, recipes/[id]/route.ts, recipes/[id]/adapt/route.ts  C
   │       ├─ cook/sessions/route.ts, cook/sessions/[id]/route.ts,
   │       │  cook/sessions/[id]/finish-preview/route.ts, cook/sessions/[id]/finish/route.ts  C
   │       └─ tts/route.ts                               A
   ├─ server/   (server-only domain logic; import 'server-only')
   │   ├─ products/**  (lookup orchestrator, dataandapis + OFF adapters, normalizer)  B
   │   ├─ vision/**    (label + expiry prompts, date assembly, CFIA regex)            B
   │   ├─ pantry/**, nutrition/daily*                                                 B
   │   ├─ nutrition/recipe*  (per-serving recipe nutrition)                           C
   │   ├─ recipes/**   (discover, resolve, fetch, extract, parse, match, score, adapt) C
   │   ├─ diet/**      (allergen/diet checker; also imported by B for pantry tags)    C
   │   └─ cook/**      (sessions, finish transaction, deduction planner)              C
   └─ features/ (client components + hooks)
       ├─ gesture/**  (GestureController, engine, HUD)   A
       ├─ cook/**     (CookView, steps, timers, wake lock, resume, FinishDialog)  A
       ├─ voice/**    (useVoice, TTS client cache, speech normalizer)            A
       ├─ scan/**     (BarcodeScanner, PhotoCapture)     B
       ├─ pantry/**, nutrition/**                         B
       └─ recipes/**  (SearchStream, RecipeCard, OriginalCard, AdaptedCard)    C
```

---

## 4. Tech stack (pin exact versions)

Pin every dependency to an **exact version** (no `^`/`~`) and commit the lockfile. Phase 0 runs `npm view <pkg> version` for each **[VERIFY]** row and writes the result into `package.json`.

| Layer | Choice | Version (as of 2026-11-07) | Notes |
|---|---|---|---|
| Runtime | Node.js LTS | **22.x** (Docker `node:22-alpine`) | Auth0 SDK "requires Node.js 20 LTS and newer" ([nextjs-auth0 README](https://github.com/auth0/nextjs-auth0)) |
| Framework | `next` (App Router, TS, `output: 'standalone'`) | **16.4.5** ([npm registry, via @auth0/nextjs-auth0 research](https://registry.npmjs.org/@auth0/nextjs-auth0)) | Next 16 uses `proxy.ts` rather than `middleware.ts` for Auth0 ([Auth0 blog](https://auth0.com/blog/handling-auth-nextjs16-with-server-actions-middleware/)) |
| UI runtime | `react`, `react-dom` | whatever `next@16.4.5` peers require **[VERIFY]** | |
| Styling | Tailwind CSS (create-next-app default) | **[VERIFY]** | Design tokens in `globals.css` |
| Auth | `@auth0/nextjs-auth0` | **4.33.0** (published 2026-10-22) ([npm](https://registry.npmjs.org/@auth0/nextjs-auth0)) | Auth0 app type: Regular Web Application |
| DB driver | `postgres` (postgres.js) | **4.1.0** ([npm](https://registry.npmjs.org/postgres/latest)) | Hand-written SQL migrations. No ORM, because TimescaleDB DDL is raw SQL anyway |
| Validation | `zod` | 4.x **[VERIFY]** | Validate every request body and every LLM output |
| Gestures | `@mediapipe/tasks-vision` | **1.2.2** (published 2026-11-03) ([npm](https://registry.npmjs.org/@mediapipe/tasks-vision)) | Self-host WASM and model. Never use `@latest` URLs |
| Barcode | `barcode-detector` (Sec-ant, MIT, zxing-wasm) | 3.x exact **[VERIFY]** ([GitHub](https://github.com/Sec-ant/barcode-detector)) | Use `barcode-detector/ponyfill`. Self-host the `.wasm` |
| LLM | `@google/genai` | latest **[VERIFY]** | The legacy `@google/generative-ai` package is not used. Wrap all calls in `src/lib/gemini/` |
| Gemini model | `gemini-3.8-flash` (env `GEMINI_MODEL`) | listed as new; recommended for new projects ([Gemini models](https://aistudio.google.com/docs/models)) | `gemini-3.5-flash-lite` is the cheaper alternative. `gemini-2.0-flash` and `gemini-3-pro-preview` are **shut down** |
| Recipe parsing | `recipe-scrapers` (TS) | ≥1.10.0 **[VERIFY license/maintenance]** ([architecture doc](https://cdn.jsdelivr.net/npm/recipe-scrapers@1.10.0/docs/architecture.md)) | Plus a hand-rolled JSON-LD fallback (§10.4) |
| TTS | ElevenLabs REST via `fetch` | model `eleven_flash_v2_5` ([Models](https://elevenlabs.io/docs/overview/models)) | No SDK needed. Its `play()` is server-only ([elevenlabs-js](https://github.com/elevenlabs/elevenlabs-js)) |
| Tests | `vitest` (unit), `@playwright/test` (one e2e smoke) | **[VERIFY]** | |
| Reverse proxy | Caddy | `caddy:2` image | Automatic HTTPS ([Vultr Caddy guide](https://docs.vultr.com/how-to-install-caddy-using-docker-on-a-vultr-cloud-server)) |
| Charts | Hand-rolled SVG (rings, 7-day bars) | none | Avoids a dependency |

Do **not** add: an ORM, a state-management library (React context plus `useReducer` is enough), html5-qrcode or `@zxing/library` (both unmaintained per [Scanbot](https://scanbot.io/blog/popular-open-source-javascript-barcode-scanners/)), or the ElevenLabs JS SDK.

---

## 5. Data model (Tiger Data / TimescaleDB)

### 5.1 Design rules

- **Base units everywhere.** Store `quantity_base` in g, ml or count, and keep the user's `display_unit` alongside for display.
- **Nutrition per 100 g or 100 ml** is canonical. Per serving is derived, or stored when the source gives it.
- **Mutable state goes in plain tables:** `pantry_items`, `recipes`, `recipe_variants`, `cooking_sessions`.
- **Append-only, time-keyed data goes in hypertables:** `meal_logs`, `pantry_events`. A continuous aggregate `daily_nutrition` provides history charts.
- Hypertable constraints: unique indexes must include the partitioning column, and hypertable-to-hypertable foreign keys are unsupported ([Tiger limitations](https://www.tigerdata.com/docs/deploy/limitations/index.md); [primary keys](https://www.tigerdata.com/docs/learn/data-model/primary-keys-time-and-uniqueness)). Hence `PRIMARY KEY (id, eaten_at)`, and nothing references `meal_logs`.
- Hypertable syntax `WITH (tsdb.hypertable, tsdb.partition_column = '…')` and the continuous-aggregate and policy syntax come from [Tiger's continuous aggregate docs](https://tigerdata.com/docs/build/continuous-aggregates/create-a-continuous-aggregate). Continuous-aggregate `GROUP BY` must include `time_bucket` on the time column, and the source hypertable cannot use row-level security. That is fine here, because isolation is enforced in application code.
- **Nutrition in `meal_logs` is a snapshot.** Later recipe edits never rewrite history.
- **Every query is scoped by `user_id`**, which comes from `requireUser()` and never from the request body.

### 5.2 `db/migrations/0001_init.sql`

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TYPE unit_dim       AS ENUM ('mass','volume','count');
CREATE TYPE product_source AS ENUM ('dataandapis','openfoodfacts','gemini_photo','manual');

-- ───────────── users ─────────────
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub            text UNIQUE NOT NULL,          -- 'auth0|…', 'google-oauth2|…' (never merge by email)
  email                text,
  display_name         text,
  avatar_url           text,
  tz                   text NOT NULL DEFAULT 'America/Vancouver',
  daily_kcal_goal      int CHECK (daily_kcal_goal > 0),
  daily_protein_goal_g numeric(6,1) CHECK (daily_protein_goal_g >= 0),
  diets                text[] NOT NULL DEFAULT '{}',  -- DietFlag[]
  allergens            text[] NOT NULL DEFAULT '{}',  -- Allergen[]
  onboarded_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now()
);

-- ───────────── global product cache (provider hits only; shared across users) ─────────────
CREATE TABLE products (
  gtin              text PRIMARY KEY CHECK (gtin ~ '^[0-9]{13,14}$'),
  name              text NOT NULL,
  brand             text,
  image_url         text,
  categories        text[] NOT NULL DEFAULT '{}',
  allergen_tags     text[] NOT NULL DEFAULT '{}',   -- normalized Allergen[] derived from provider 'allergens'
  package_qty_text  text,                           -- as printed, e.g. '500 g'
  package_dim       unit_dim,
  package_qty_base  numeric(12,3),                  -- 500 (g)
  serving_size_text text,
  serving_size_base numeric(10,3),                  -- g or ml
  nutrition_basis   text NOT NULL DEFAULT '100g' CHECK (nutrition_basis IN ('100g','100ml')),
  per100            jsonb NOT NULL DEFAULT '{}',    -- Nutrients
  per_serving       jsonb,                          -- Nutrients | null
  source            product_source NOT NULL CHECK (source IN ('dataandapis','openfoodfacts')),
  attribution       text,                           -- 'Open Food Facts, ODbL v1.0'
  raw               jsonb,                          -- provider payload(s) for re-parsing
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  refresh_after     timestamptz NOT NULL DEFAULT now() + interval '120 days'
);

-- lookup log: negative caching + quota monitoring
CREATE TABLE barcode_lookups (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gtin        text NOT NULL,
  provider    text NOT NULL CHECK (provider IN ('dataandapis','openfoodfacts')),
  status      text NOT NULL CHECK (status IN ('hit','miss','error')),
  http_status int,
  latency_ms  int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX barcode_lookups_gtin_idx ON barcode_lookups (gtin, provider, created_at DESC);

-- ───────────── pantry (mutable current state; one row per physical item/batch) ─────────────
CREATE TABLE pantry_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gtin                  text REFERENCES products(gtin),
  name                  text NOT NULL,
  normalized_name       text NOT NULL,              -- lowercase, singular, descriptors stripped
  brand                 text,
  dim                   unit_dim NOT NULL,
  quantity_base         numeric(12,3) NOT NULL CHECK (quantity_base >= 0),
  initial_quantity_base numeric(12,3),
  display_unit          text NOT NULL,              -- DisplayUnit
  grams_per_unit        numeric(10,3),              -- count↔mass bridge (1 egg ≈ 50 g)
  density_g_per_ml      numeric(8,4),               -- volume↔mass bridge
  expiry_date           date,
  expiry_source         text CHECK (expiry_source IN ('photo','manual')),
  expiry_raw_text       text,                       -- what Gemini read, for transparency
  nutrition_basis       text NOT NULL DEFAULT '100g' CHECK (nutrition_basis IN ('100g','100ml','unit')),
  kcal_per_basis        numeric(8,2),
  protein_g_per_basis   numeric(8,2),
  carbs_g_per_basis     numeric(8,2),
  fat_g_per_basis       numeric(8,2),
  serving_size_base     numeric(10,3),
  allergen_tags         text[] NOT NULL DEFAULT '{}',
  source                product_source NOT NULL DEFAULT 'manual',
  user_verified         boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((expiry_date IS NULL) = (expiry_source IS NULL))
);
CREATE INDEX pantry_user_name_idx   ON pantry_items (user_id, normalized_name);
CREATE INDEX pantry_user_expiry_idx ON pantry_items (user_id, expiry_date) WHERE quantity_base > 0;

-- ───────────── recipes (saved per user when opened/cooked) ─────────────
CREATE TABLE recipes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url_hash            text NOT NULL,                -- sha256(canonical_url)
  source_url          text NOT NULL,                -- final canonical URL, never a vertexaisearch redirect
  site_name           text NOT NULL,
  author              text,
  title               text NOT NULL,
  extraction_method   text NOT NULL CHECK (extraction_method IN ('jsonld','microdata','site-scraper','llm')),
  publisher_nutrition jsonb,                        -- Nutrients per serving from JSON-LD, if any
  total_time_min      int,
  retrieved_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, url_hash)
);

-- original + AI-adapted variants; original is immutable
CREATE TABLE recipe_variants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id             uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  parent_variant_id     uuid REFERENCES recipe_variants(id),
  kind                  text NOT NULL CHECK (kind IN ('original','ai_adapted')),
  servings              numeric(5,2) NOT NULL CHECK (servings > 0),
  ingredients           jsonb NOT NULL,             -- RecipeIngredient[]
  steps                 jsonb NOT NULL,             -- RecipeStep[]
  substitutions         jsonb,                      -- Substitution[] (ai_adapted only)
  warnings              jsonb,                      -- string[] (ai_adapted only)
  nutrition_per_serving jsonb,                      -- NutritionEstimate
  model                 text,                       -- Gemini model id (ai_adapted only)
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'original') = (parent_variant_id IS NULL))
);
CREATE UNIQUE INDEX one_original_per_recipe ON recipe_variants (recipe_id) WHERE kind = 'original';

-- short-lived cache of discovery results (TTL enforced in code; see §10.3 Grounding-terms caveat)
CREATE TABLE recipe_search_cache (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_key   text NOT NULL,                        -- sha256(sorted expiring items + diets + allergens)
  candidates  jsonb NOT NULL,                       -- resolved canonical URLs + titles
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, query_key)
);

-- ───────────── cooking sessions ─────────────
CREATE TABLE cooking_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_variant_id uuid NOT NULL REFERENCES recipe_variants(id),
  status            text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','finished','abandoned')),
  current_step      int NOT NULL DEFAULT 0,
  servings_planned  numeric(5,2) NOT NULL CHECK (servings_planned > 0),
  servings_cooked   numeric(5,2),
  servings_eaten    numeric(5,2),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  CHECK ((status = 'finished') = (finished_at IS NOT NULL))
);
CREATE INDEX cooking_sessions_user_idx ON cooking_sessions (user_id, started_at DESC);
```

### 5.3 `db/migrations/0002_timescale.sql`

```sql
-- HYPERTABLE: meal logs (from Finish cooking, or manual)
CREATE TABLE meal_logs (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  eaten_at           timestamptz NOT NULL DEFAULT now(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date         date NOT NULL,                 -- user's local day, computed in app from users.tz
  source             text NOT NULL CHECK (source IN ('cooking_session','manual','pantry_item','barcode')),
  cooking_session_id uuid REFERENCES cooking_sessions(id),
  recipe_variant_id  uuid REFERENCES recipe_variants(id),
  pantry_item_id     uuid REFERENCES pantry_items(id) ON DELETE SET NULL,
  label              text NOT NULL,
  servings           numeric(5,2) CHECK (servings > 0),
  kcal               numeric(8,1) NOT NULL CHECK (kcal >= 0),
  protein_g          numeric(7,1) NOT NULL DEFAULT 0 CHECK (protein_g >= 0),
  carbs_g            numeric(7,1),
  fat_g              numeric(7,1),
  PRIMARY KEY (id, eaten_at)
) WITH (tsdb.hypertable, tsdb.partition_column = 'eaten_at');
CREATE INDEX meal_logs_user_time_idx ON meal_logs (user_id, eaten_at DESC);
CREATE INDEX meal_logs_user_date_idx ON meal_logs (user_id, local_date);

-- HYPERTABLE: pantry ledger (audit + "usage over time")
CREATE TABLE pantry_events (
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pantry_item_id     uuid REFERENCES pantry_items(id) ON DELETE SET NULL,
  kind               text NOT NULL CHECK (kind IN ('add','cook_deduct','eat_deduct','manual_adjust','discard')),
  delta_base         numeric(12,3) NOT NULL,        -- negative for deductions
  cooking_session_id uuid REFERENCES cooking_sessions(id)
) WITH (tsdb.hypertable, tsdb.partition_column = 'occurred_at');
CREATE INDEX pantry_events_user_time_idx ON pantry_events (user_id, occurred_at DESC);

-- CONTINUOUS AGGREGATE: daily nutrition per user
CREATE MATERIALIZED VIEW daily_nutrition
WITH (timescaledb.continuous) AS
SELECT user_id,
       time_bucket(INTERVAL '1 day', eaten_at, 'America/Vancouver') AS day,  -- [VERIFY] tz arg in caggs; fallback: drop tz arg (UTC buckets)
       sum(kcal)      AS kcal,
       sum(protein_g) AS protein_g,
       sum(carbs_g)   AS carbs_g,
       sum(fat_g)     AS fat_g,
       count(*)       AS entries
FROM meal_logs
GROUP BY user_id, day
WITH NO DATA;

SELECT add_continuous_aggregate_policy('daily_nutrition',
  start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes');

-- real-time aggregation so "today" includes rows not yet materialized   [VERIFY behaviour]
ALTER MATERIALIZED VIEW daily_nutrition SET (timescaledb.materialized_only = false);
```

Notes and fallbacks:
- **"Today" totals** are read from `meal_logs WHERE user_id=$1 AND local_date=$2`, which is exact and cheap. **History (7/30 days)** is read from `daily_nutrition`, the Tiger showcase. Both should agree for Vancouver-time users. A mismatch for users in other time zones is acceptable for the hackathon.
- If `WITH (tsdb.hypertable …)` is rejected on the provisioned service, create the plain table and convert it with `SELECT create_hypertable('meal_logs', by_range('eaten_at'));`. **[VERIFY]** That fallback syntax comes from training knowledge and was not checked during research.
- Before running migrations, confirm that TimescaleDB is installed on the free service: `SELECT extname, extversion FROM pg_extension;`. Tiger's docs imply that it is unless "plain PostgreSQL" was chosen, but they don't say so explicitly ([Tiger docs: create a service](https://www.tigerdata.com/docs/get-started/quickstart/create-service)).
- `scripts/migrate.mjs` applies `db/migrations/*.sql` in order inside a `schema_migrations(version text primary key, applied_at timestamptz)` table it creates itself.

### 5.4 Unit conversion (static map in `src/lib/units.ts`, owned by Phase 0)

| Dimension | Base | Factors to base |
|---|---|---|
| mass | g | g=1, kg=1000, oz=28.3495, lb=453.592 |
| volume | ml | ml=1, l=1000, tsp=4.92892, tbsp=14.7868, cup=236.588, fl_oz=29.5735 |
| count | count | pcs = each = clove = egg = 1 |

Cross-dimension conversions bridge through `grams_per_unit` (count↔mass) or `density_g_per_ml` (volume↔mass). **If there is no bridge, never guess.** Flag the line `unconvertible` and let the user adjust it manually. "To taste", "pinch" and "a dash" count as 0 and are flagged as `negligible`. (The design comes from the research notes; it is not taken from an external standard.)

Exported API (frozen):

```ts
export function toBase(qty: number, unit: DisplayUnit): { dim: UnitDim; qtyBase: number } | null;
export function fromBase(qtyBase: number, dim: UnitDim, unit: DisplayUnit): number | null;
export function convertBetween(qtyBase: number, from: UnitDim, to: UnitDim,
  bridge: { gramsPerUnit?: number | null; densityGPerMl?: number | null }): number | null;
export function parseUnit(raw: string): DisplayUnit | null;   // 'Tbsp'|'tablespoons' → 'tbsp'
export function formatQty(qtyBase: number, dim: UnitDim, preferred?: DisplayUnit): string; // '1.5 kg', '3 pcs'
```

---

## 6. Shared contracts (`src/contracts/`, frozen after Phase 0)

These files are the interface between workstreams. Phase 0 writes them completely, along with fixtures in `src/contracts/fixtures/` (one product, one pantry of 12 items, two original recipes, one adapted recipe, one cooking session, one day of meals). After Phase 0 they change only through the protocol in §18.5.

### 6.1 `src/contracts/domain.ts`

```ts
export type UUID = string;
export type ISODate = string;       // 'YYYY-MM-DD'
export type ISODateTime = string;   // RFC 3339

export type UnitDim = 'mass' | 'volume' | 'count';
export type DisplayUnit = 'g' | 'kg' | 'oz' | 'lb' | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'fl_oz' | 'pcs';
export type ProductSource = 'dataandapis' | 'openfoodfacts' | 'gemini_photo' | 'manual';

export type DietFlag = 'vegetarian' | 'vegan' | 'gluten_free' | 'dairy_free' | 'high_protein';
// Product decision; aligned with Canada's priority allergens [VERIFY list against Health Canada]
export type Allergen =
  | 'peanut' | 'tree_nut' | 'sesame' | 'milk' | 'egg' | 'fish'
  | 'shellfish' | 'soy' | 'wheat_gluten' | 'mustard' | 'sulphite';

export interface Nutrients {          // all nullable; units fixed by name
  energyKcal: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;       // TOTAL carbs incl. fibre (CA/US label convention)
  fatG: number | null;
  saturatedFatG?: number | null;
  sugarsG?: number | null;
  fibreG?: number | null;
  sodiumMg?: number | null;
}

export interface UserProfile {
  id: UUID;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  tz: string;                         // IANA
  dailyKcalGoal: number | null;
  dailyProteinGoalG: number | null;
  diets: DietFlag[];
  allergens: Allergen[];
  onboarded: boolean;
}

export interface Product {
  gtin: string;                       // canonical GTIN-13/14
  name: string;
  brand: string | null;
  imageUrl: string | null;
  categories: string[];
  allergenTags: Allergen[];
  packageQuantity: { value: number; unit: 'g' | 'ml' | 'count'; text: string | null } | null;
  servingSize: { value: number; unit: 'g' | 'ml'; text: string | null } | null;
  basis: '100g' | '100ml';
  per100: Nutrients;
  perServing: Nutrients | null;
  source: Exclude<ProductSource, 'gemini_photo' | 'manual'>;
  attribution: string | null;         // e.g. 'Open Food Facts, ODbL'
  fetchedAt: ISODateTime;
}

/** Form model shared by label-photo extraction and the manual product form. */
export interface ProductDraft {
  gtin: string | null;
  name: string;
  brand: string | null;
  packageQuantity: { value: number; unit: DisplayUnit } | null;
  servingSize: { value: number; unit: 'g' | 'ml'; text: string | null } | null;
  basis: '100g' | '100ml' | 'serving' | 'unit';
  nutrients: Nutrients;               // expressed in `basis`
  allergenTags: Allergen[];
  source: 'gemini_photo' | 'manual';
}

export interface PantryItem {
  id: UUID;
  gtin: string | null;
  name: string;
  normalizedName: string;
  brand: string | null;
  dim: UnitDim;
  quantityBase: number;
  displayUnit: DisplayUnit;
  quantityDisplay: string;            // formatted, e.g. '350 g'
  gramsPerUnit: number | null;
  densityGPerMl: number | null;
  expiryDate: ISODate | null;
  expirySource: 'photo' | 'manual' | null;
  daysToExpiry: number | null;        // computed in user's tz; negative = past date
  nutritionBasis: '100g' | '100ml' | 'unit';
  nutrition: Nutrients;               // per basis
  perServing: Nutrients | null;
  servingSizeBase: number | null;
  allergenTags: Allergen[];
  source: ProductSource;
  userVerified: boolean;
  updatedAt: ISODateTime;
}

export interface RecipeSource {
  url: string;                        // final canonical URL (never a vertexaisearch redirect)
  siteName: string;
  author: string | null;
  retrievedAt: ISODateTime;
  extractionMethod: 'jsonld' | 'microdata' | 'site-scraper' | 'llm'; // 'llm' → UI shows "may not be verbatim"
}

export interface RecipeIngredient {
  raw: string;                        // EXACT published text — display this
  qty: number | null;                 // parsed (for matching/nutrition/deduction only)
  unit: DisplayUnit | null;
  name: string | null;
  normalizedName: string | null;
  dim: UnitDim | null;
  qtyBase: number | null;             // for recipe's own servings
  isStaple: boolean;                  // salt, pepper, water, oil → always 'have'
  flags: Array<'unconvertible' | 'negligible' | 'parse_failed'>;
}

export interface RecipeStep {
  index: number;                      // 0-based
  text: string;                       // published text (original) or adapted text
  timerSeconds: number | null;        // parsed from text; null = no explicit duration
  changed?: boolean;                  // true only in AI-adapted variants
}

export interface OriginalRecipe {
  kind: 'original';
  recipeId: UUID;
  variantId: UUID;
  title: string;
  source: RecipeSource;
  servings: number;                   // from recipeYield; default 4 if unparseable (flagged)
  yieldRaw: string | null;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  times: { prepMin: number | null; cookMin: number | null; totalMin: number | null };
  declaredDiet: string[];             // schema.org suitableForDiet — informational ONLY
}

export interface Substitution {
  missingIngredient: string;          // as written in the original
  substitute: string | null;          // null = omit
  pantryItemId: UUID | null;          // must exist in the user's pantry when not null
  quantity: string | null;
  reason: string;
  impact: 'minimal' | 'moderate' | 'significant';
}

export interface AdaptedRecipe {
  kind: 'ai_adapted';
  label: 'AI-adapted';
  recipeId: UUID;
  variantId: UUID;
  basedOnVariantId: UUID;             // the original's variantId
  substitutions: Substitution[];
  ingredients: Array<{ text: string; changed: boolean; parsed: RecipeIngredient }>;
  steps: RecipeStep[];                // full step list; changed steps have changed=true
  warnings: string[];
  model: string;
  generatedAt: ISODateTime;
}

export type MatchStatus = 'have' | 'missing' | 'staple' | 'insufficient';
export interface PantryMatch {
  ingredientIndex: number;
  status: MatchStatus;
  pantryItemId: UUID | null;
  pantryItemName: string | null;
  daysToExpiry: number | null;
}

export interface DietCheck {
  ok: boolean;
  violations: Array<{ ingredientRaw: string; rule: DietFlag | Allergen; matchedKeyword: string }>;
}

export interface NutritionEstimate {
  perServing: Nutrients;
  coveragePct: number;                // 0–100: share of non-staple ingredients with usable data
  basedOn: number;
  total: number;
  estimatedFields: string[];          // e.g. ['ingredient 3: density assumed 1.0 g/ml']
}

export interface RecipeScore {
  coverage: number;                   // 0–1
  expiryScore: number;                // normalized 0–1
  missingCount: number;
  proteinPerServingG: number | null;
  score: number;
}

export interface RecipeCandidate {
  recipeId: UUID;
  title: string;
  source: RecipeSource;
  totalMin: number | null;
  servings: number;
  score: RecipeScore;
  usesExpiring: Array<{ pantryItemId: UUID; name: string; daysToExpiry: number }>;
  matches: PantryMatch[];
  nutrition: NutritionEstimate;
}

export type CookingStatus = 'in_progress' | 'finished' | 'abandoned';
export interface CookingSession {
  id: UUID;
  recipeId: UUID;
  variantId: UUID;
  variantKind: 'original' | 'ai_adapted';
  status: CookingStatus;
  currentStep: number;
  servingsPlanned: number;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface StepTimer {
  id: string;
  label: string;                      // 'Step 4 · Simmer sauce'
  stepIndex: number;
  kind: 'countdown' | 'stopwatch';
  durationMs: number | null;          // countdown only
  endsAt: number | null;              // epoch ms while running (countdown)
  startedAt: number | null;           // epoch ms while running (stopwatch)
  pausedRemainingMs: number | null;   // countdown paused
  pausedElapsedMs: number | null;     // stopwatch paused
  status: 'idle' | 'running' | 'paused' | 'done';
}

export interface MealLog {
  id: UUID;
  eatenAt: ISODateTime;
  localDate: ISODate;
  source: 'cooking_session' | 'manual' | 'pantry_item' | 'barcode';
  label: string;
  servings: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number | null;
  fatG: number | null;
  cookingSessionId: UUID | null;
  pantryItemId: UUID | null;
}

export interface DailyTotals {
  date: ISODate;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  entries: number;
  kcalGoal: number | null;
  proteinGoalG: number | null;
}
```

### 6.2 `src/contracts/gesture.ts`

```ts
export type GestureAction =
  | 'ARM' | 'DISARM'
  | 'NEXT_STEP' | 'PREV_STEP'
  | 'SCROLL_UP' | 'SCROLL_DOWN'
  | 'TIMER_TOGGLE' | 'SPEAK_TOGGLE';

export type CannedGesture =
  | 'None' | 'Closed_Fist' | 'Open_Palm' | 'Pointing_Up'
  | 'Thumb_Down' | 'Thumb_Up' | 'Victory' | 'ILoveYou';

export type GestureEngineState =
  | 'off' | 'loading' | 'permission_needed' | 'error'
  | 'no_hand' | 'hand_seen' | 'armed' | 'holding' | 'cooldown';

export interface GestureHud {
  state: GestureEngineState;
  pose: CannedGesture;
  holdProgress: number;               // 0–1 for the radial ring
  pendingAction: GestureAction | null;
  armedRemainingMs: number;
  lastAction: { action: GestureAction; at: number } | null;
  hint: null | 'move_closer' | 'more_light' | 'one_hand_only';
  fps: number;
  error?: 'NotAllowedError' | 'NotFoundError' | 'NotReadableError' | 'InsecureContext' | 'ModelLoadFailed';
}

export interface GestureConfig {
  minScore: number; fistMinScore: number; classifierScoreThreshold: number;
  armHoldMs: number; actionHoldMs: number; armWindowMs: number; alwaysArmed: boolean;
  cooldownMs: number; releaseMs: number;
  scrollFirstMs: number; scrollRepeatMs: number; scrollFraction: number;
  swipeWindowMs: number; swipeMinDx: number; swipeDxToDyRatio: number; swipeMinVelocity: number;
  swipeNextDirection: 'left' | 'right';
  minHandHeightFrac: number; targetFps: number; idleFps: number; idleAfterMs: number;
  delegate: 'GPU' | 'CPU';
}

/** Anything that produces gesture actions: MediaPipe, keyboard mock, test harness. */
export interface GestureSource {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  onAction(cb: (a: GestureAction) => void): () => void;
  onHud(cb: (h: GestureHud) => void): () => void;   // throttled to ≤10 Hz
}

/** The single integration point: every input channel calls these. Owned by Cook Mode. */
export interface CookingController {
  nextStep(): void;
  prevStep(): void;
  scroll(direction: 'up' | 'down'): void;
  toggleTimer(): void;                 // current step's timer
  toggleSpeak(): void;                 // read current step / stop
  source?: 'gesture' | 'keyboard' | 'touch' | 'voice';
}
```

### 6.3 `src/contracts/voice.ts`

```ts
export type SpeechEngine = 'elevenlabs' | 'browser';
export interface VoicePlayer {
  unlock(): Promise<void>;                          // call inside the "Start cooking" tap
  speak(text: string, opts?: { cacheKey?: string }): Promise<SpeechEngine>;
  stop(): void;
  prefetch(text: string): void;                     // warm cache for next step
  readonly speaking: boolean;
  onChange(cb: (speaking: boolean, engine: SpeechEngine | null) => void): () => void;
}
```

---

## 7. API route contracts (`src/contracts/api.ts`)

General rules for every route:
- Node runtime (`export const runtime = 'nodejs'`). The first line is `const user = await requireUser()`, which returns 401 `UNAUTHORIZED` when there is no session.
- Bodies are validated with Zod. Errors use the shape below. Success returns the typed payload directly, with no envelope.
- The user id comes **only** from the session. Never accept `userId` in a request.
- Per-user rate limits (in-memory token bucket in `src/lib/rate-limit.ts`): `/api/recipes/search` 6/min, `/api/recipes/*/adapt` 6/min, `/api/vision/*` 10/min, `/api/tts` 60/min, `/api/products/lookup` 30/min.

```ts
import type * as D from './domain';

export type ApiErrorCode =
  | 'UNAUTHORIZED' | 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE' | 'UNPROCESSABLE' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL';
export interface ApiError { error: { code: ApiErrorCode; message: string; details?: unknown } }

// ── Profile ────────────────────────────────────────────────────────────────
// GET  /api/me                → D.UserProfile
// PATCH /api/me               → D.UserProfile
export interface UpdateMeRequest {
  displayName?: string;
  tz?: string;
  dailyKcalGoal?: number | null;
  dailyProteinGoalG?: number | null;
  diets?: D.DietFlag[];
  allergens?: D.Allergen[];
  completeOnboarding?: boolean;
}

// ── Products ───────────────────────────────────────────────────────────────
// POST /api/products/lookup
export interface ProductLookupRequest { barcode: string }          // digits only, 8–14
export interface ProviderAttempt {
  provider: 'cache' | 'dataandapis' | 'openfoodfacts';
  result: 'hit' | 'miss' | 'error' | 'skipped';
  httpStatus?: number;
  ms: number;
}
export type ProductLookupResponse =
  | { status: 'found'; product: D.Product; cached: boolean; attempts: ProviderAttempt[] }
  | { status: 'not_found'; gtin: string; attempts: ProviderAttempt[] }
  | { status: 'invalid_barcode'; reason: 'length' | 'check_digit' | 'non_numeric' };

// POST /api/vision/label   multipart/form-data: images (1–3 files, each ≤ 4 MB, jpeg/png/webp/heic), gtin?
export interface LabelExtractionResponse {
  isFoodProduct: boolean;
  draft: D.ProductDraft;                      // source = 'gemini_photo'
  flaggedFields: Array<keyof D.Nutrients | 'servingSize' | 'packageQuantity' | 'name'>;
  macrosConsistent: boolean | null;           // 4p + 4c + 9f ≈ kcal within ±20%
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  model: string;
}

// POST /api/vision/expiry  multipart/form-data: image (1 file ≤ 4 MB)
export interface ExpiryExtractionResponse {
  rawText: string | null;
  dateType: 'best_before' | 'expiry' | 'use_by' | 'packaged_on' | 'sell_by' | 'unknown';
  suggestedDate: D.ISODate | null;            // null if packaged_on or unreadable
  candidates: D.ISODate[];                    // >1 when order is ambiguous
  needsUserChoice: boolean;
  yearInferred: boolean;
  regexCrossCheck: 'agree' | 'disagree' | 'no_match';
  confidence: 'high' | 'medium' | 'low';
}

// ── Pantry ─────────────────────────────────────────────────────────────────
// GET /api/pantry?sort=expiry|name&includeEmpty=false   → ListPantryResponse
export interface ListPantryResponse { items: D.PantryItem[] }
// POST /api/pantry                                      → D.PantryItem
export interface CreatePantryItemRequest {
  gtin?: string | null;
  name: string;
  brand?: string | null;
  quantity: number;                           // in displayUnit
  displayUnit: D.DisplayUnit;
  gramsPerUnit?: number | null;
  densityGPerMl?: number | null;
  expiryDate?: D.ISODate | null;
  expirySource?: 'photo' | 'manual' | null;
  expiryRawText?: string | null;
  nutritionBasis: '100g' | '100ml' | 'unit';
  nutrition?: D.Nutrients | null;             // per basis
  servingSizeBase?: number | null;
  allergenTags?: D.Allergen[];
  source: D.ProductSource;
  userVerified: boolean;
}
// PATCH /api/pantry/:id                                 → D.PantryItem
export type UpdatePantryItemRequest =
  Partial<Omit<CreatePantryItemRequest, 'source' | 'gtin'>> & { adjustReason?: 'manual_adjust' | 'discard' };
// DELETE /api/pantry/:id                                → { ok: true }

// ── Recipes ────────────────────────────────────────────────────────────────
// POST /api/recipes/search   → application/x-ndjson stream of RecipeSearchEvent (one JSON per line)
export interface RecipeSearchRequest {
  mustUsePantryItemIds?: D.UUID[];            // default: items with daysToExpiry ≤ 3
  freeText?: string;                          // e.g. 'quick dinner', ≤ 100 chars
  maxResults?: number;                        // default 6, max 10
  extraDiets?: D.DietFlag[];                  // may only ADD to profile filters, never remove
}
export type RecipeSearchEvent =
  | { type: 'status'; stage: 'searching' | 'resolving' | 'fetching' | 'parsing' | 'checking_diet' | 'ranking'; message: string }
  | { type: 'search_suggestions'; html: string }      // Gemini searchEntryPoint.renderedContent, render unmodified
  | { type: 'candidate'; candidate: D.RecipeCandidate }
  | { type: 'excluded'; url: string; reason: 'no_recipe_markup' | 'fetch_failed' | 'diet_violation' | 'allergen' | 'duplicate' | 'blocked_url'; detail?: string }
  | { type: 'done'; total: number; excludedCount: number; cached: boolean }
  | { type: 'error'; error: ApiError['error'] };

// GET /api/recipes/:id                                  → RecipeDetailResponse
export interface RecipeDetailResponse {
  original: D.OriginalRecipe;
  adaptations: D.AdaptedRecipe[];             // newest first; usually 0 or 1
  matches: D.PantryMatch[];
  score: D.RecipeScore;
  dietCheck: D.DietCheck;
  nutrition: { estimate: D.NutritionEstimate; publisher: D.Nutrients | null };
  adaptationNutrition: Record<D.UUID, D.NutritionEstimate>;   // keyed by adapted variantId
}
// POST /api/recipes/:id/adapt   body: {}                → AdaptResponse
//   409 CONFLICT  if no missing ingredients
//   422 UNPROCESSABLE if validation fails twice (allergen in substitute, unknown pantryItemId, …)
export interface AdaptResponse { adaptation: D.AdaptedRecipe; nutrition: D.NutritionEstimate }

// ── Cooking ────────────────────────────────────────────────────────────────
// POST /api/cook/sessions                               → D.CookingSession
export interface StartSessionRequest { recipeId: D.UUID; variantId: D.UUID; servingsPlanned: number }
// GET /api/cook/sessions/:id                            → CookSessionView
export interface CookSessionView {
  session: D.CookingSession;
  recipe: { title: string; source: D.RecipeSource; servings: number; isAdapted: boolean };
  ingredients: Array<{ text: string; changed: boolean; scaledQtyDisplay: string | null; usedInSteps: number[] }>;
  steps: D.RecipeStep[];
  substitutions: D.Substitution[];            // empty for originals
}
// PATCH /api/cook/sessions/:id                          → D.CookingSession
export interface UpdateSessionRequest { currentStep?: number; status?: 'abandoned' }
// GET /api/cook/sessions/:id/finish-preview?servingsCooked=4   → FinishPreview
export interface DeductionLine {
  ingredientRaw: string;
  pantryItemId: D.UUID | null;
  pantryItemName: string | null;
  proposedQtyBase: number | null;             // scaled by servingsCooked / variant.servings
  availableQtyBase: number | null;
  dim: D.UnitDim | null;
  display: string;                            // 'Spinach: 150 g of 200 g → 50 g left'
  status: 'ok' | 'clamped' | 'unconvertible' | 'no_match' | 'staple';
}
export interface FinishPreview {
  deductions: DeductionLine[];
  nutritionPerServing: D.NutritionEstimate;
  publisherPerServing: D.Nutrients | null;
  suggestedLogPerServing: { kcal: number; proteinG: number; basis: 'estimate' | 'publisher' | 'low_coverage_estimate' };
  defaultServingsEaten: number;               // 1
}
// POST /api/cook/sessions/:id/finish                    → FinishResult
//   409 CONFLICT if session not in_progress (idempotency guard)
export interface FinishRequest {
  servingsCooked: number;                     // > 0, drives deduction
  servingsEaten: number;                      // ≥ 0, drives meal log (0 → no log)
  deductions: Array<{ pantryItemId: D.UUID; qtyBase: number }>;   // user-confirmed lines only
  perServingOverride?: { kcal: number; proteinG: number };
}
export interface FinishResult {
  session: D.CookingSession;
  pantryUpdates: Array<{ pantryItemId: D.UUID; name: string; beforeBase: number; afterBase: number }>;
  mealLog: D.MealLog | null;
}

// ── Voice ──────────────────────────────────────────────────────────────────
// POST /api/tts   body: TtsRequest   → 200 audio/mpeg (streamed) | ApiError (client falls back)
export interface TtsRequest { text: string /* 1–2000 chars, already speech-normalized */ }

// ── Nutrition & meals ──────────────────────────────────────────────────────
// GET /api/nutrition/today                 → D.DailyTotals          (from meal_logs by local_date)
// GET /api/nutrition/history?days=7        → { days: D.DailyTotals[] }   (from daily_nutrition cagg; days ≤ 30)
// GET /api/meals?date=YYYY-MM-DD           → { meals: D.MealLog[] }
// POST /api/meals                          → D.MealLog
export type ManualMealRequest =
  | { kind: 'quick_add'; label: string; kcal: number; proteinG: number; carbsG?: number; fatG?: number; eatenAt?: D.ISODateTime }
  | { kind: 'pantry_item'; pantryItemId: D.UUID; amount: number; unit: D.DisplayUnit; deductFromPantry: boolean; eatenAt?: D.ISODateTime }
  | { kind: 'barcode'; gtin: string; amount: number; unit: D.DisplayUnit; eatenAt?: D.ISODateTime };
// DELETE /api/meals/:id?eatenAt=<ISO>      → { ok: true }   (composite PK needs eatenAt)
```

---

## 8. Environment variables

`.env.example` is committed. `.env.local` (dev) and `.env.production` (server, `chmod 600`) are never committed. **Only `NEXT_PUBLIC_*` variables reach the client** ([Auth0 blog](https://auth0.com/blog/handling-auth-nextjs16-with-server-actions-middleware/)), and no secret may use that prefix. `src/lib/env.ts` validates all server variables with Zod at boot and fails fast.

| Variable | Scope | Required | Example / default | Purpose |
|---|---|---|---|---|
| `AUTH0_DOMAIN` | server | yes | `dev-xxxx.us.auth0.com` | Auth0 tenant ([README](https://github.com/auth0/nextjs-auth0)) |
| `AUTH0_CLIENT_ID` | server | yes | | |
| `AUTH0_CLIENT_SECRET` | server | yes | | |
| `AUTH0_SECRET` | server | yes | `openssl rand -hex 32` **[VERIFY convention]** | Session encryption |
| `APP_BASE_URL` | server | prod yes | `https://mise.tech` | Optional in dev, where the SDK infers it from the host |
| `DATABASE_URL` | server | yes | from `tiger db connection-string` | Typically `postgres://tsdbadmin:…@host:port/tsdb?sslmode=require` **[VERIFY format]** |
| `DB_POOL_MAX` | server | no | `5` | postgres.js `max` |
| `DATABASE_URL_TEST` | server (tests) | no | connection string of a `tiger service fork` | `npm run test:db` only; never production |
| `GEMINI_API_KEY` | server | yes | | Gemini API |
| `GEMINI_MODEL` | server | no | `gemini-3.8-flash` | Vision, adaptation, normalization |
| `GEMINI_SEARCH_MODEL` | server | no | `gemini-3.8-flash` | Grounded discovery. Try `gemini-3.5-flash-lite` for latency **[VERIFY grounding support]** |
| `DATAANDAPIS_KEY` | server | yes | | `X-Api-Key` for barcode lookup |
| `OFF_BASE_URL` | server | no | `https://world.openfoodfacts.org` | Use `https://world.openfoodfacts.net` (basic auth `off:off`) while testing |
| `OFF_USER_AGENT` | server | yes | `Mise/0.1 (team@example.com)` | Required custom UA ([OFF API](https://openfoodfacts.github.io/openfoodfacts-server/api/)) |
| `RECIPE_FETCH_USER_AGENT` | server | yes | `MiseRecipeFetcher/0.1 (+https://mise.tech/bot)` | Honest UA for publisher fetches |
| `ELEVENLABS_API_KEY` | server | no* | | *If missing, `/api/tts` returns 503 and the client uses `speechSynthesis` |
| `ELEVENLABS_VOICE_ID` | server | no | `JBFqnCBsd6RMkjVDRZzb` (docs example voice) | ([Stream speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)) |
| `ELEVENLABS_MODEL_ID` | server | no | `eleven_flash_v2_5` | |
| `DEFAULT_TZ` | server | no | `America/Vancouver` | |
| `NEXT_PUBLIC_GESTURE_DEBUG` | client | no | `false` | Landmark overlay and FPS counter |

---

## 9. Functional requirements and acceptance criteria

Every acceptance criterion (AC) should be checkable by a test or by a scripted manual step in §14.

### F1. Authentication and onboarding (P0), owned by B (P0 wires the auth itself)

**Requirements.** Use `@auth0/nextjs-auth0` v4 with `src/lib/auth0.ts` exporting `new Auth0Client()`. `src/proxy.ts` returns `auth0.middleware(request)` with the documented matcher that excludes `_next/static`, `_next/image`, `favicon.ico`, `sitemap.xml` and `robots.txt` ([Auth0 blog](https://auth0.com/blog/handling-auth-nextjs16-with-server-actions-middleware/)). The SDK mounts `/auth/login`, `/auth/logout`, `/auth/callback`, `/auth/profile` and `/auth/access-token` ([README](https://github.com/auth0/nextjs-auth0)). `requireUser()` in `src/lib/current-user.ts` calls `auth0.getSession()`, upserts `users` by `sub`, and returns `{ id, sub, tz, diets, allergens }`. **Every route handler and Server Action calls it.** Server Actions "must re-validate authentication explicitly", and `useUser()` is for UI only ([Auth0 blog](https://auth0.com/blog/handling-auth-nextjs16-with-server-actions-middleware/)). Do not merge users by email: social and password logins produce different `sub` values, and the free plan has no account linking (research inference from [Auth0 pricing](https://auth0.com/pricing)). Enable Google social login in the Auth0 dashboard.

**AC**
1. A logged-out visit to `/today` redirects to `/auth/login`. `GET /api/pantry` without a session returns 401 JSON.
2. After first login a `users` row exists with `auth0_sub = session.user.sub`. A second login does not create a duplicate.
3. With two test accounts, user A's `GET /api/pantry` never returns user B's items, and `PATCH /api/pantry/<B's id>` as A returns 404.
4. `/onboarding` saves diets, allergens, goals and tz. `onboarded_at` is set, and later visits skip onboarding.
5. Logout clears the session and returns to `/`.
6. **[VERIFY]** Argument-less `auth0.getSession()` works inside App Router route handlers. Research found no primary source for that exact case. If it fails, wrap handlers with `auth0.withApiAuthRequired`.

### F2. Barcode scanning and product lookup (P0), owned by B

**Requirements.**
- *Scanner* (`features/scan/BarcodeScanner.tsx`, client-only via `next/dynamic` with `ssr:false`):
  - If `"BarcodeDetector" in globalThis` and `getSupportedFormats()` includes `ean_13`, use the native detector. Otherwise use `import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill"`, with the wasm self-hosted via `locateFile` ([Sec-ant/barcode-detector](https://github.com/Sec-ant/barcode-detector)).
  - Native support is not Baseline: Firefox has none, and Safari's is disabled by default ([caniuse](https://caniuse.com/mdn-api_barcodedetector)).
  - Formats: `ean_13`, `ean_8`, `upc_a`, `upc_e`. Detect every ~150 ms. Accept a code after **2 consecutive identical reads**.
  - Camera: `facingMode: { ideal: "environment" }`, 1280×720 ideal. The `<video>` needs `playsinline muted`. Offer a camera picker on laptops and a torch toggle where supported.
  - Fallback: a still-photo input (`<input type=file accept="image/*" capture="environment">`) decoded with the same detector.
  - **A "Type barcode" numeric input is always visible.**
- *Normalization* (`src/lib/gtin.ts`, Phase 0): strip non-digits, validate the GS1 check digit, left-pad UPC-A (12 digits) to GTIN-13. EAN-8 is kept as-is but also padded to 13 for the cache key.
- *Lookup orchestrator* (`server/products/lookup.ts`, behind `POST /api/products/lookup`):
  1. Check the `products` cache. A hit within `refresh_after` costs no external call.
  2. Negative cache: if `barcode_lookups` has a `miss` for this GTIN from **both** providers within the last 14 days, return `not_found` without calling out. Never treat `error` rows (401/402/429/5xx/timeout) as misses.
  3. dataandapis, 4 s timeout (§10.1).
  4. Open Food Facts, 4 s timeout. Call it when dataandapis missed, and also when dataandapis hit but has no `serving_size`/`quantity`, to enrich per-serving data (§10.2).
  5. Normalize to `Product` and upsert `products` with `raw` set to the provider payloads. Log every attempt to `barcode_lookups`.
  6. Single-flight: concurrent lookups of the same GTIN within one process share one promise, so tokens aren't spent twice.
- Show attribution "Product data: Open Food Facts (ODbL)" on every product sourced from either provider. The dataandapis licence string reads "ODbL v1.0 (database) + DbCL (contents) - attribution required" ([dataandapis data sources](https://dataandapis.com/apis/barcode-lookup/data-sources)).

**AC**
1. Scanning a Nutella jar (`3017620422003`, the dataandapis docs example) shows its name, brand, kcal/100 g and attribution within 5 s on a cold cache, and within 300 ms on a warm cache.
2. Typing a 12-digit UPC-A looks up the GTIN-13 form. A bad check digit shows "That barcode doesn't look valid" with no network call to providers.
3. With `DATAANDAPIS_KEY` set to garbage, the lookup still succeeds via OFF, and a `barcode_lookups` row with `status='error'`, `http_status=401` is written.
4. An unknown barcode returns `not_found`, and the UI offers "Take photo of label" and "Enter manually".
5. Scanning the same code twice within 1 s results in one lookup call.
6. Works in Chrome desktop, Safari iOS and Firefox (the ponyfill path). The typed input works everywhere.

### F3. Product from label photo and manual form (P0), owned by B

**Requirements.** `POST /api/vision/label` takes 1–3 images and calls `geminiJson()` (§10.3) with the label schema and prompt rules from §10.3.3. Server checks:
- Values are non-negative.
- 4·protein + 4·carbs + 9·fat ≈ kcal within ±20%.
- Serving size is plausible (1–1000 g/ml).
- If only kJ is printed, convert at kJ ÷ 4.184 and flag the field.
- If `basis` is per serving and the serving grams are known, compute per 100 g.

Every failed check adds to `flaggedFields`. The manual form (`features/pantry/ProductForm.tsx`) is a single component used for both Gemini drafts and blank manual entry. It requires a name, quantity and unit. Nutrition fields are optional but encouraged. **Nothing extracted by Gemini is saved until the user presses Confirm.** Photos are not stored; they live in memory only for the duration of the request.

**AC**
1. A clear photo of a Canadian Nutrition Facts table yields a pre-filled form with calories, fat, carbs, protein and serving size, and `basis = 'per_serving'`.
2. A photo of a non-food object returns `isFoodProduct=false`, and the UI says so and offers the manual form.
3. Deliberately inconsistent macros (edit a test fixture) produce `macrosConsistent=false` and highlighted fields.
4. Images over 4 MB return 413. More than 3 images returns 400.
5. The saved pantry item has `source='gemini_photo'`, `user_verified=true`.

### F4. Expiry date capture (P0), owned by B

**Requirements.** Two entry paths, **photo** and **manual date picker**, plus "No date". `POST /api/vision/expiry` uses the expiry schema and CFIA-aware prompt (§10.3.4). Gemini returns date **components**, not an ISO string. The server assembles them:
- Infer a missing year as the next occurrence after today (`yearInferred=true`).
- If `ambiguous_order`, return both candidates with `needsUserChoice=true`.
- Reject dates more than 5 years ahead or more than 1 year past.
- `packaged_on` → `suggestedDate=null`.

A regex cross-check on `rawText` for the CFIA pattern `(\d{2,4})?\s*(JA|FE|MR|AL|MA|JN|JL|AU|SE|OC|NO|DE)\s*(\d{1,2})` sets `regexCrossCheck`. Canadian best-before dates put the year first, then a bilingual two-letter month, then the day. The year is optional when the date is clear without it ([CFIA date markings](https://inspection.canada.ca/en/food-labels/labelling/industry/date-markings-and-storage-instructions)). The UI pre-fills a date picker, shows the raw text, and **requires confirmation**.

**AC**
1. Unit test: `assembleDate({year:2026, month:11, day:15, …})` → `2026-11-15`. The text `BB/MA NO 15` with no year, run on 2026-11-07, → `2026-11-15` with `yearInferred=true`. Run on 2026-11-20 it → `2027-11-15`.
2. Unit test: CFIA regex parses `2026 NO 15`, `26 MA 03` (May, not March) and `AL 09` (April).
3. Ambiguous `05/06/27` returns two candidates and the UI forces a choice.
4. A photo of "PACKAGED ON / EMPAQUETÉ LE" shows "This is a packaged-on date, not an expiry" and leaves the date empty.
5. The saved item has `expiry_source='photo'` and `expiry_raw_text` populated.

### F5. Pantry management (P0), owned by B

**Requirements.** `/pantry` lists items sorted by `expiry_date ASC NULLS LAST`. Each row shows a colour band: expired (past date) red, ≤3 days amber, ≤7 days yellow, otherwise neutral, with the text "Best before Nov 15 · 2 days" (colour is never the only cue). Each row shows quantity in its display unit and nutrition per 100 g/ml plus per serving where known. Inline actions: adjust quantity (writes `pantry_events.kind='manual_adjust'`), discard (`'discard'`, quantity → 0), edit, delete. Items at 0 are hidden by default but kept, so the UI can offer "Restock" via an "Include empty" toggle. Adding a product with a known GTIN that already exists with a different expiry creates a **new row** (a separate physical batch). `normalized_name` is computed server-side: lowercase, singularized, descriptors stripped (`fresh`, `chopped`, brand words).

**AC**
1. Adding three items with expiries in 2, 10 and none days lists them in that order with the correct bands and text.
2. Adjusting 400 g → 250 g writes a `pantry_events` row with `delta_base=-150`.
3. `daysToExpiry` uses the user's tz. A date of "today" shows 0 days, "Best before today".
4. Deleting an item referenced by a past meal log keeps the meal log, whose `pantry_item_id` becomes null.

### F6. Recipe discovery: real recipes, expiry-preferring (P0), owned by C

**Requirements: pipeline** (`server/recipes/discover.ts`). Research found documented 2026 bugs when Search grounding is combined with JSON output: empty `groundingChunks` ([forum, Dec 2025](https://discuss.ai.google.dev/t/grounding-metadata-grounding-chunks-grounding-supports-empty-when-using-structured-output-with-google-search-tool/113240)) and responses that start mid-sentence ([forum, Aug 2026](https://discuss.ai.google.dev/t/google-search-grounding-drops-the-beginning-of-the-response-text-gemini-3-5-3-6-flash-json-output-starts-mid-sentence/176967)). So use **Gemini only to discover URLs**, and get the recipe content from the publisher's own markup:

1. **Build the query context** (code). Take pantry items with quantity > 0, sorted by `daysToExpiry` with expired items excluded, capped at 25 items. Drop staples (salt, pepper, oil, water). The user's diets and allergens are included in the prompt to steer search, **but enforcement is in code (F7)**.
2. **Discover** with `geminiGroundedSearch()` (§10.3.2): ask for about 8 recipe page URLs, with 2–3 searches each anchored on 2–3 expiring items. **No response schema on this call.** Collect `groundingChunks[].web.uri` plus any URLs in the text, then dedupe. If returned, emit the `searchEntryPoint.renderedContent` HTML as a `search_suggestions` event.
3. **Resolve.** Grounding URIs are Google redirect URLs (`vertexaisearch.cloud.google.com/grounding-api-redirect/...`) and must be resolved server-side by following redirects. Model-typed URLs are untrusted ([DEV GDE article](https://dev.to/gde/gde-mastering-live-sports-data-with-gemini-3-url-context-grounding-structured-output-23ho) reports the model "sometimes invents URLs"). **A recipe is shown only if its URL returned 200 and parsed as a schema.org Recipe.**
4. **Fetch** with the SSRF-safe fetcher (§13): 5 s timeout, 2 MB cap, concurrency 5, honest UA, robots.txt respected (P1).
5. **Extract** with `scrapeRecipe(html, finalUrl)` from `recipe-scrapers`. If that fails, use the hand-rolled JSON-LD extractor (§10.4). **No Recipe markup → drop the candidate** (`excluded: no_recipe_markup`). The LLM-extraction fallback (`extractionMethod:'llm'`, shown with "may not be verbatim") is **disabled by default** (P2 flag), because the confirmed product rule is to show the original.
6. **Parse ingredients.** Deterministic parser first (qty, unit via `parseUnit`, name, `normalizedName`). Unparsed lines go to one batched `geminiJson()` normalization call per recipe (no tools), which returns `{raw, qty, unit, name, dim}[]`. Parsed fields are used **only** for matching, nutrition and deduction. **Displayed text is always `raw`.**
7. **Diet/allergy check (F7).** Violations are excluded with a reason.
8. **Match and score** (§9 F6 scoring) and stream `candidate` events as each recipe finishes, so originals appear progressively. Gemini 3.8 Flash's time to first token was reported at **13.30 s against a 2.99 s median** ([eesel.ai, third-party](https://eesel.ai/blog/gemini-3-8-flash-pricing)), so streaming progress is mandatory.
9. **Persist** each shown candidate as `recipes` plus an `original` `recipe_variants` row, upserting on `(user_id, url_hash)`. Cache the discovery URL list in `recipe_search_cache` for 24 h, pending the Grounding-terms review (§17).

**Scoring** (`server/recipes/score.ts`; deterministic, my own design from the research notes, tune freely):
```
coverage    = matched non-staple ingredients / total non-staple ingredients
w(d)        = 1 / (1 + max(d, 0))          // d = daysToExpiry of matched pantry item; expired items excluded
expiryScore = Σ w(d) over matched items, normalized to 0–1 across the candidate set
proteinNorm = min(proteinPerServingG / 40, 1)   // only if 'high_protein' in diets, else 0
score       = 0.5·coverage + 0.35·expiryScore + 0.15·proteinNorm − 0.1·missingCount
hard filter : DietCheck.ok === false → excluded (never scored)
```
Matching: exact `normalizedName`, then a synonym map (`scallion=green onion`, `garbanzo=chickpea`, `cilantro=coriander`, …), then a token-subset match ("chicken thigh" ⊂ "boneless chicken thighs"). Ties go to the soonest-expiring pantry row (FEFO). `insufficient` means matched but quantity < required.

**AC**
1. With a fixture pantry where spinach expires in 1 day, at least one returned candidate uses spinach and its card shows "uses spinach · 1 day".
2. Every candidate's `source.url` is an `https://` publisher URL, not `vertexaisearch…`, and opening it shows the same title.
3. Every candidate has `extractionMethod ∈ {jsonld, microdata, site-scraper}` with the default flags.
4. The first `status` event arrives in < 1 s and the first `candidate` event arrives before `done`.
5. With Gemini returning 0 usable URLs (mocked), the stream ends with `done{total:0}` and the UI offers "Try different ingredients".
6. Results are ordered by `score` descending, and the unit test of `score()` matches the formula on fixture data.

### F7. Strict diet and allergy filtering (P0), owned by C

**Requirements.** `server/diet/check.ts` exports `checkDiet(lines: string[], profile: {diets, allergens}): DietCheck`. It is pure, deterministic and **the only enforcement mechanism**. Prompt instructions are a hint only. Keyword map (lowercased, word-boundary matched against the raw string and `normalizedName`):

| Rule | Example keywords (extend; include derivatives) |
|---|---|
| peanut | peanut, groundnut, arachis oil, satay |
| tree_nut | almond, cashew, walnut, pecan, pistachio, hazelnut, macadamia, brazil nut, pine nut, praline, marzipan, nut butter (not peanut) |
| sesame | sesame, tahini, gomasio, za'atar |
| milk / dairy_free | milk, butter, cream, cheese, yogurt/yoghurt, ghee, whey, casein, buttermilk, paneer |
| egg | egg, mayonnaise/mayo, meringue, aioli |
| fish | salmon, tuna, cod, anchovy, fish sauce, worcestershire, sardine, … |
| shellfish | shrimp, prawn, crab, lobster, scallop, clam, mussel, oyster |
| soy | soy, soya, tofu, tempeh, edamame, miso, soy sauce, tamari |
| wheat_gluten / gluten_free | wheat, flour (unless a GF flour is named), barley, rye, spelt, semolina, farro, couscous, seitan, malt, bread, pasta, soy sauce (unless "tamari"/"gluten-free") |
| mustard | mustard |
| sulphite | wine, sulphite/sulfite, dried apricot |
| vegetarian | meat, chicken, beef, pork, lamb, bacon, ham, gelatin, all fish/shellfish, anchovy, fish sauce, stock (unless "vegetable") |
| vegan | vegetarian list + all milk + egg + honey |

Also checked: the `allergen_tags` of any pantry item used as a substitute. **Applied to every original ingredient line and every AI substitution.** A recipe with any hit is excluded. An adaptation whose substitutes hit is rejected. `high_protein` is a soft ranking boost (≥ 20 g/serving earns a "High protein" badge), not a filter. Do not trust `suitableForDiet` from the page ([schema.org](https://schema.org/suitableForDiet)). The UI always shows "Always check product labels for allergens."

**AC**
1. Table-driven unit tests: "2 tbsp soy sauce" fails `gluten_free` and `soy`; "2 tbsp tamari (gluten-free)" passes `gluten_free` and fails `soy`; "1 cup almond flour" fails `tree_nut` and passes `gluten_free`; "chicken stock" fails `vegetarian`; "vegetable stock" passes.
2. An end-to-end search for a `peanut`-allergic user never shows a recipe with "peanut" in any ingredient (check with a mocked candidate set that contains one).
3. An adaptation that proposes butter for a `dairy_free` user is rejected and retried once, then the route returns 422 with "Couldn't find a safe substitution".
4. The excluded-count note on the results page matches the number of `excluded` events with reason `diet_violation|allergen`.

### F8. Recipe detail, original first with attribution (P0), owned by C

**Requirements.**
- The Original card renders first and is unlabeled except for attribution: "From **{siteName}** by {author}", plus a prominent **"View original"** link (opens a new tab, `rel="noopener"`).
- Ingredients render verbatim (`raw`), each with a have / missing / staple / insufficient marker. Steps render the published `HowToStep.text`.
- No third-party images are copied in MVP. Show a neutral placeholder or the site favicon.
- The US Copyright Office states that "a mere listing of ingredients or contents, or a simple set of directions, is uncopyrightable", while creative explanation may be protected ([Circular 33](https://www.copyright.gov/circs/circ33.pdf)). Therefore never copy headnotes or stories.
- Keep an attribution record (`source_url`, `site_name`, `author`, `retrieved_at`) with every recipe. *(Not legal advice. See §17 for the team's risk decision on storing full step text.)*

**AC**
1. Attribution and "View original" are visible without scrolling on a 1280×720 viewport.
2. Ingredient strings on screen exactly match the page's JSON-LD `recipeIngredient` (fixture test).
3. No `<img>` with a third-party `src` is rendered on the detail page.

### F9. AI adaptation only when ingredients are missing (P0), owned by C

**Requirements.** `POST /api/recipes/:id/adapt`:
1. Compute `missing = matches.filter(m => m.status === 'missing' || m.status === 'insufficient')`. If empty, return **409**. The UI never shows the adapt button in that case.
2. Call `geminiJson()` with **no tools**, the adaptation schema (§10.3.5) and the system instruction: "Only substitute the listed missing ingredients using pantry items. Never introduce excluded allergens. Do not rewrite unchanged steps." Input: the original (title, ingredients `raw`, steps), the missing list, a compact pantry list (`id`, name, qty, daysToExpiry), and the filters.
3. **Validate server-side.** Every non-null `pantryItemId` must exist in this user's pantry. Every `missingIngredient` must match an unmatched original line. Every substitute must pass `checkDiet`. `stepChanges[].stepIndex` must be in range. On failure, retry once, then return 422.
4. Build an `AdaptedRecipe` with full `steps` (marking `changed=true` where `stepChanges` applied), insert a `recipe_variants` row (`kind='ai_adapted'`, `parent_variant_id` = original), and recompute nutrition, labelled an estimate.
5. Cache by `(recipeId, sorted missing set, pantry hash, filters)`. A repeated request returns the existing variant.

**UI rules.** The adapted card appears **below** the original, with an **"AI-adapted" badge**, a tinted background, a substitution list ("Missing: X → Using: Y (from your pantry)" or "→ Omit"), warnings, and "Based on {title} from {siteName}". In cook mode, every changed step shows an "AI-adapted" chip. The original variant row is never updated.

**AC**
1. For a recipe missing only buttermilk with Greek yogurt in the pantry, the adaptation lists exactly one substitution referencing the yogurt's `pantryItemId`.
2. `SELECT … FROM recipe_variants WHERE kind='original'` for that recipe is byte-identical before and after adaptation.
3. The adapted card cannot render without the badge (component test).
4. A mocked model response that references a non-existent `pantryItemId` triggers one retry, then 422.

### F10. Nutrition per item and per recipe serving (P0), owned by C (recipe) and B (item)

**Requirements.**
- *Per item* (B): show per 100 g/ml and per serving where known (product data or label photo).
- *Per recipe serving* (C, `server/nutrition/recipe.ts`): `perServing = Σ_i (grams_i / 100) × per100_i ÷ servings` over matched pantry items that have nutrition. Volume converts via `density_g_per_ml`; if that is missing, assume 1.0 and flag it in `estimatedFields`. Count converts via `grams_per_unit`, and missing values are flagged. Return `coveragePct`.
- Display "≈ 540 kcal · 32 g protein per serving (based on 7 of 9 ingredients)".
- If JSON-LD includes `nutrition`, show it separately as **"Publisher's nutrition"**. `nutrition.calories` in Recipe markup is per serving and requires `recipeYield` ([Google Recipe structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe)).
- *Suggested meal-log value* (used by F14): our estimate if coverage ≥ 60%; otherwise publisher nutrition if present; otherwise the low-coverage estimate with a warning. The user can always edit it.

**AC**
1. Unit test: 200 g chicken (165 kcal/100 g, 31 g protein/100 g) plus 100 g rice (130 kcal/100 g, 2.7 g protein/100 g) at 2 servings → 230 kcal, 32.35 g protein per serving.
2. A recipe whose only unmatched ingredient is "2 cups broth" shows `coveragePct < 100` and the "based on" text.
3. When coverage is 0 and the publisher reports 450 kcal, `suggestedLogPerServing.basis='publisher'`.

### F11. Cooking mode UI (P0), owned by A

**Requirements.** `/cook/[sessionId]`, client-heavy, built on `CookSessionView`. All inputs (touch, keyboard, gestures, optional voice) go through one `CookingController` backed by a `useReducer` state machine: `{ stepIndex, timers: StepTimer[], speaking, scrollY }`.
- **Layout:** one step per screen. Step text ≥ 32 px (40 px on screens ≥ 1024 px wide). "Step 4 of 12" plus a progress bar. The step's ingredients with scaled quantities. Timer chips docked at the bottom. Prev and Next tap zones each ≥ 25% of the screen width. High contrast, dark theme by default. (Sizes are design heuristics, not sourced.)
- **Wake lock:** request `navigator.wakeLock.request("screen")` in the "Start cooking" click, re-acquire it on `visibilitychange` → visible, and release it on finish, exit, or 30 min of inactivity. If `!("wakeLock" in navigator)`, hide the "Screen stays on" indicator rather than showing a broken control. The API is Baseline 2025, needs HTTPS, and can be rejected in power-save mode ([MDN Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)). Keeping the screen on is proven to matter: Betty Crocker saw 3.1× longer sessions and 50% lower bounce ([web.dev case study](https://web.dev/case-studies/betty-crocker)).
- **Timers:**
  - Parse durations from step text with `/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i`. Use the **lower bound** of a range, so the cook checks early. Sum compound durations ("1 hour 15 minutes").
  - Steps without a duration get a **stopwatch** (count-up) when toggled.
  - Store timers as absolute `endsAt`/`startedAt` epoch ms. Remaining time is always `endsAt − Date.now()` and never a decrementing counter. Chrome throttles hidden-tab timers to once per minute after 5 minutes ([Chrome timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)).
  - Multiple concurrent timers are allowed, each labelled with its step.
  - Alarm: Web Audio beep plus `navigator.vibrate` plus a `Notification` if permission was granted. On `visibilitychange` → visible, check immediately for elapsed timers.
- **Recovery:** persist `{sessionId, stepIndex, timers, updatedAt}` to `localStorage` on every change. On load, if the state is less than 12 h old, offer "Resume at step N?". `PATCH /api/cook/sessions/:id {currentStep}` is debounced to 2 s.
- **Keyboard:** ←/→ steps, ↑/↓ and PgUp/PgDn scroll, **T** or **Space** toggles the timer, **R** reads aloud or stops, **Esc** exits hands-free.
- **Announcements:** an `aria-live="polite"` region announces step changes and fired actions. Honour `prefers-reduced-motion`.
- **Finish:** a "Finish cooking" button on the last step and in the menu opens `FinishDialog` (F14).

**AC**
1. Pressing → advances the step, announces "Step 5 of 12" in the live region, and stops any speech in progress.
2. Start a 10-minute timer, reload the page, accept "Resume". The timer shows the correct remaining time (±1 s).
3. Hide the tab for 2 minutes with a 1-minute timer running. On return, the alarm fires immediately.
4. Wake lock is held during cooking (`wakeLock.released === false`) and released after Finish.
5. "Simmer for 10–15 minutes" yields a 10:00 countdown. "Season to taste" yields a stopwatch when toggled.

### F12. Hand-gesture control (P0), owned by A. See §11 for the full state machine.

**AC**
1. With hands-free on, holding an open palm for ≥ 600 ms shows "Ready" with a countdown. Swiping left advances one step, and a single swipe never advances two steps.
2. Holding a fist for ≥ 800 ms toggles the current step's timer exactly once. Holding it 3 s longer does nothing more until the hand is released.
3. Holding thumb up scrolls up about 40% of the viewport every 700 ms while held. Thumb down scrolls down.
4. Holding a victory sign for ≥ 800 ms starts read-aloud. Repeating it stops the speech.
5. With hands-free **not** armed, 30 s of stirring and chopping motion in front of the camera fires 0 actions (manual test, recorded in §14).
6. Camera permission denied → the HUD shows "Camera blocked. Use the buttons or keyboard", and every other control still works.
7. Leaving the page or toggling hands-free off stops all camera tracks: the camera light goes off within 1 s.
8. No network request carries image or video data while hands-free is on (DevTools check). The model and WASM load from our origin.

### F13. Read aloud (P0), owned by A

**Requirements.**
- `features/voice/useVoice.ts` implements `VoicePlayer`.
- `speak(text)`:
  1. `normalizeForSpeech(text)` (P0 rules: fractions "1/2" → "one half", "350°F" → "350 degrees Fahrenheit", "tbsp" → "tablespoons", "tsp" → "teaspoons", "g" → "grams", "ml" → "millilitres", ranges "10–15" → "10 to 15"). Flash v2.5 "does not normalize numbers by default" ([ElevenLabs Models](https://elevenlabs.io/docs/overview/models)).
  2. Cache lookup in a `Map<sha256(text+voice+model), objectURL>`.
  3. `fetch('/api/tts')` with a **1.5 s timeout to first byte**.
  4. Play via an `<audio>` element.
  5. On any failure (non-2xx, timeout, no key, offline), use `speechSynthesis.cancel()` then `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`. `SpeechSynthesis` is Baseline, widely available ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)), and voices load asynchronously via `voiceschanged`.
- `prefetch(nextStepText)` runs after each step change.
- `unlock()` plays a silent clip inside the "Start cooking" tap, to satisfy the autoplay policy.
- Step change or exit calls `stop()`.
- A small "Voice: ElevenLabs / Device" label shows which engine spoke.
- Optional setting: "Auto-read each step" (default off).
- `/api/tts` (§10.5) proxies ElevenLabs streaming and caps text at 2000 chars.

**AC**
1. With a valid key, R on a step plays ElevenLabs audio, and the engine label reads "ElevenLabs".
2. With `ELEVENLABS_API_KEY` unset, R still speaks via the browser, and the engine label reads "Device".
3. Reading the same step a second time makes no network request.
4. Advancing a step mid-speech stops the audio immediately.

### F14. Finish cooking: pantry deduction and meal log (P0), owned by C (server) and A (dialog UI)

**Requirements.**
- `GET finish-preview` plans deductions (`server/cook/plan.ts`). For each matched ingredient line:

  `needBase = qtyBase × servingsCooked / variant.servings`

  Then convert to the pantry item's dim (bridge or `unconvertible`), choose the pantry row by explicit `pantryItemId` from matching (substitutions use their `pantryItemId`) or by FEFO, and clamp at the available quantity (`clamped`).
- The dialog lets the user edit quantities, uncheck lines, set servings cooked and eaten, and edit kcal and protein per serving.
- `POST finish` runs **one transaction** (`server/cook/finish.ts`), following the research notes' design:
  1. `UPDATE cooking_sessions SET status='finished', finished_at=now(), servings_cooked, servings_eaten WHERE id AND user_id AND status='in_progress' RETURNING …`. If no row, throw 409. This is the idempotency guard.
  2. For each confirmed deduction: `SELECT quantity_base … FOR UPDATE` scoped by `user_id`, `take = min(available, requested)`, update the quantity (never below 0), and insert `pantry_events(kind='cook_deduct', delta_base=-take, cooking_session_id)`.
  3. If `servingsEaten > 0`: insert `meal_logs(source='cooking_session', label=title, servings=servingsEaten, kcal = perServing.kcal × servingsEaten, protein_g = …, local_date = today in users.tz)`.
- **Decisions:**
  - Clamp at 0 and don't fail.
  - Keep rows at 0 for "Restock".
  - `servings_cooked` drives deduction and `servings_eaten` drives calories; they differ when there are leftovers.
  - Meal nutrition is a snapshot.

**AC**
1. Finishing with 200 g spinach in the pantry and 150 g needed leaves 50 g, adds a `pantry_events` row of −150, and adds a `meal_logs` row with `source='cooking_session'`.
2. Posting finish twice: the second call returns 409, and the pantry is deducted only once.
3. `servingsEaten=0` deducts the pantry and creates no meal log.
4. An ingredient in cups matched to a pantry item in grams with no density shows `unconvertible` in the preview and is not deducted.
5. If any statement fails (simulate by deleting the pantry row mid-request), nothing is written.

### F15. Daily tracking and manual logging (P0), owned by B

**Requirements.**
- `/today` shows:
  - Two SVG rings: kcal and protein against goals. When no goal is set, show the totals only.
  - Today's meals, each deletable.
  - A 7-day bar chart from `GET /api/nutrition/history?days=7`, which reads the `daily_nutrition` continuous aggregate.
  - The "Expiring soon" list (≤ 3 days) linking to "Find recipes with these".
- "Log food" dialog with three tabs:
  - *From pantry:* amount → nutrition computed from the item's per-basis values. "Also remove from pantry" defaults on and writes `pantry_events.kind='eat_deduct'` in the same transaction.
  - *Scan:* reuses the scanner and lookup.
  - *Quick add:* label, kcal, protein.
- `local_date` is computed server-side from `users.tz`.

**AC**
1. Logging a 170 g yogurt (59 kcal / 10 g protein per 100 g) adds ≈ 100 kcal and 17 g protein to today's rings, and deducts 170 g from the pantry.
2. After finishing a recipe, `/today` reflects the meal on the next render without waiting for the aggregate refresh (today is read from `meal_logs`).
3. The 7-day chart shows yesterday's totals from `daily_nutrition`. `EXPLAIN ANALYZE` of the history query hits the continuous aggregate (captured for Tiger proof, §16).
4. Deleting a meal updates the rings immediately.

---

## 10. External API details

### 10.1 dataandapis.com Barcode Lookup (first in the chain)

- **Request:** `GET https://api-barcode-lookup.dataandapis.com/v1/products/{barcode}` with header `X-Api-Key: $DATAANDAPIS_KEY` ([endpoint page](https://dataandapis.com/apis/barcode-lookup/lookup-by-barcode)). Accepts EAN-13, UPC-A, EAN-8 or GTIN-14, and tries leading zeros and re-paddings automatically ([product page](https://dataandapis.com/apis/barcode-lookup)).
- **200 fields** (from the documented Nutella example): `ok`, `barcode`, `name`, `brand`, `quantity` (string|null), `categories`, `labels`, `countries`, `allergens`, `serving_size` (string|null), `ingredients`, `scores{nutriscore,nova_group,ecoscore}`, `nutriments_per_100g{energy_kcal, fat, saturated_fat, carbohydrates, sugars, proteins, salt, sodium}`, `completeness`, `image_url`, `last_modified`, `attribution{dataset,source,source_url,licence}` ([OpenAPI](https://dataandapis.com/apis/barcode-lookup/openapi.json)). There are **no per-serving values and no fibre**. `quantity` and `serving_size` were null even for Nutella.
- **Provenance:** the whole catalogue is an Open Food Facts–family copy, about 4.2M food records, listed as "Daily" cadence with retrieval date 2026-08-29. The licence is ODbL + DbCL, and attribution is required ([data sources](https://dataandapis.com/apis/barcode-lookup/data-sources)). So OFF mostly adds products created or edited after that copy, plus per-serving data.
- **Quota:** 1 token per call. The Free plan is 500 tokens/month. Starter is $6.99 for 25k ([product page](https://dataandapis.com/apis/barcode-lookup)). The team's plan tier is unknown, so the cache in F2 is mandatory.
- **Errors:** documented responses are 401 (bad key), 402 (past due, with `payment_url`) and 429 (monthly allowance exhausted). 400 and 404 are not documented ([OpenAPI](https://dataandapis.com/apis/barcode-lookup/openapi.json)).
- **Adapter rules** (`server/products/dataandapis.ts`):
  - **Miss:** a non-2xx response other than 401/402/429, or `ok:false`, or a missing `name`.
  - **Error** (log + alert, continue to OFF, don't negative-cache): 401, 402, 429, 5xx, or timeout.
- **Mapping:**

  | dataandapis field | Our field |
  |---|---|
  | `energy_kcal` | `per100.energyKcal` |
  | `proteins` | `proteinG` |
  | `carbohydrates` | `carbohydrateG` |
  | `fat` | `fatG` |
  | `saturated_fat` | `saturatedFatG` |
  | `sugars` | `sugarsG` |
  | `sodium` (assumed g, ×1000) | `sodiumMg` **[VERIFY unit and the carb convention against a live response]** |
  | `name` | `name` |
  | `brand` | `brand` |
  | `quantity` | `packageQuantity.text`, parsed with a "500 g" / "1.89 L" regex |
  | `image_url` | `imageUrl` |
  | `allergens` | `allergenTags`, via a keyword map |
- **[VERIFY] in Phase 0:** call it with `0000000000000` to learn the not-found shape, and check whether a miss consumes a token. Save one real response as `src/contracts/fixtures/dataandapis.nutella.json`.

### 10.2 Open Food Facts (second in the chain)

- **Request:** `GET {OFF_BASE_URL}/api/v2/product/{gtin}.json?fields=code,product_name,product_name_en,product_name_fr,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,nutrition_data_per,nutriments,image_front_url,categories_tags,allergens_tags`.
  - Header `User-Agent: $OFF_USER_AGENT`, in the format `AppName/Version (ContactEmail)`.
  - Reads need no other auth.
  - Rate limit: **15 req/min/IP** for product reads; exceeding it returns 503.
  - Staging is `world.openfoodfacts.net` with basic auth `off/off`, and the docs say to use staging while testing.
  - Source: [OFF API intro](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- **Fields:** v2 nutriments are flat keys: `energy-kcal_100g` (hyphen), `carbohydrates_100g`, `sugars_100g` and so on, with `_serving` variants. `serving_quantity` is computed in grams ([OFF nutrition data](https://openfoodfacts.github.io/openfoodfacts-server/dev/explain-nutrition-data/); [tutorial](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorial-off-api/)). `proteins_100g`, `fat_100g`, `fiber_100g` and `sodium_100g` follow the documented scheme but were not seen verbatim **[VERIFY with one staging call; save it as a fixture]**.
- **Not found:** treat `status !== 1` **or** HTTP 404 as a miss. The exact v2 shape is unverified.
- **Versioning:** OFF docs label v3 "current" and v2 "deprecated". v3.5 adds a nested `nutrition` object, and in it `carbohydrates` *excludes* fibre while `carbohydrates-total` includes it ([v3.5 schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_nutrition_v3.5/)). Keep the parser in one adapter file so a later v3 migration touches only that file.
- **Names:** prefer `product_name_en`, then `product_name`, then `product_name_fr`, since Canadian products are bilingual.
- **Licence:** database ODbL, contents DbCL, **images CC BY-SA 3.0** ([OFF API intro](https://openfoodfacts.github.io/openfoodfacts-server/api/)). Show attribution next to product images.

### 10.3 Gemini API

#### 10.3.1 Client wrapper (`src/lib/gemini/client.ts`, Phase 0, frozen signatures)

The research found **two SDK call shapes** in current material:
- The structured-output and image docs show `client.interactions.create({ model, input, response_format: { type: 'text', mime_type: 'application/json', schema } })`, read via `interaction.output_text`, with images passed as `{ type: "image", data: <base64>, mime_type }` parts. Inline requests are capped at 20 MB in total ([structured output](https://ai.google.dev/gemini-api/docs/structured-output); [image understanding](https://aistudio.google.com/docs/image-understanding)).
- Grounding examples use `ai.models.generateContent({ model, contents, config: { tools: [{ googleSearch: {} }] } })` and read `candidates[0].groundingMetadata`. That shape comes from training knowledge plus community reports **[VERIFY]**.

Phase 0 confirms both against the current `@google/genai` README and hides them behind:

```ts
export interface GeminiImage { mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif'; base64: string }

/** JSON-mode call, NO tools. Validates with zod; strips ```json fences; 1 retry on parse failure. */
export async function geminiJson<T>(opts: {
  system?: string;
  text: string;                    // put the text prompt BEFORE images (docs tip)
  images?: GeminiImage[];
  jsonSchema: object;              // Gemini JSON-Schema subset (§10.3.6)
  zod: import('zod').ZodType<T>;
  model?: string;                  // default env GEMINI_MODEL
  timeoutMs?: number;              // default 30_000
}): Promise<{ data: T; model: string }>;

/** Grounded search call, NO response schema (avoids 2025–26 grounding+JSON bugs). */
export async function geminiGroundedSearch(opts: {
  prompt: string;
  model?: string;                  // default env GEMINI_SEARCH_MODEL
  timeoutMs?: number;              // default 45_000
}): Promise<{
  text: string;
  sources: Array<{ uri: string; title: string | null }>;   // groundingChunks[].web
  webSearchQueries: string[];
  searchEntryPointHtml: string | null;                      // render unmodified if present
}>;
```

Facts that shape usage:
- **Structured output** guarantees schema-valid JSON but "the values may still be wrong", so validate in code ([structured output](https://ai.google.dev/gemini-api/docs/structured-output)). That is why every extraction ends in a user confirmation step.
- **Pricing.** Gemini 3.8 Flash costs about **$0.75 / $3.75 per 1M input/output tokens until 31 Dec 2026**, then doubles, and output includes thinking tokens ([eesel.ai, third-party, VERIFY](https://eesel.ai/blog/gemini-3-8-flash-pricing)). **Search grounding** is free for **5,000 queries/month** shared across Gemini 3.x models, then $14/1,000, billed **per search query the model runs** rather than per prompt ([Google AI forum, quoting the pricing row](https://discuss.ai.google.dev/t/grounding-free-quota-clarifying-2026-rules-for-gemini-2-5-flash-paid-tier-1/144593)). Budget per query, not per user request.
- **Image cost.** An image ≤ 384 px on both sides costs 258 tokens. Larger images are tiled at 768×768, with each tile costing 258 tokens. Downscaling to about 1600 px is a balance between legibility and cost ([image understanding](https://aistudio.google.com/docs/image-understanding)).

#### 10.3.2 Discovery prompt (grounded, no schema)

```
You are finding REAL recipes published on the web. Use Google Search.
Find up to 8 distinct recipe pages (not videos, not listicles, not aggregator search pages)
that use several of these ingredients, prioritising the first ones (they expire soonest):
MUST PREFER (expiring): spinach (1d), chicken thigh (2d), greek yogurt (3d)
ALSO AVAILABLE: rice, onion, garlic, canned tomatoes, lemon, ...
DIET: gluten_free, high_protein. EXCLUDE ALLERGENS: peanut, sesame.
{optional free text}
Run 2–3 different searches, each anchored on 2–3 of the expiring ingredients.
Return one line per recipe: <title> | <url>. Do not invent URLs.
```

Server behaviour:
- **Sources:** union of grounding-chunk URIs and URLs parsed from the text. Text URLs are lower trust, and both are verified by fetch and parse.
- **Resolve:** redirects are followed with the SSRF-safe fetcher. The canonical URL is taken from `<link rel=canonical>` or JSON-LD `url`, falling back to the final URL.

#### 10.3.3 Label extraction schema and rules

Schema fields:
- **Identity:** `is_food_product`, `name`, `brand`, `barcode_digits_if_visible`.
- **Package:** `package_quantity_text`, `package_quantity_value`, `package_quantity_unit` (g/kg/ml/l/oz/lb/fl_oz/count/null).
- **Panel:** `nutrition_panel_visible`, `serving_size_text`, `serving_size_value`, `serving_size_unit` (g/ml/null), `basis` (`per_serving | per_100g | per_100ml | unknown`).
- **Nutrients:** `calories_kcal`, `fat_g`, `saturated_fat_g`, `trans_fat_g`, `carbohydrate_g` (total, as printed), `fibre_g`, `sugars_g`, `protein_g`, `sodium_mg`.
- **Quality:** `confidence` (high/medium/low), `notes`.
- **Required:** `is_food_product`, `nutrition_panel_visible`, `basis`, `confidence`.
- Nullable fields use type arrays such as `["number","null"]`.

The schema follows the research notes' design. Prompt rules:
- "Transcribe only values printed on the label. Never estimate or use outside knowledge. Use null when a value is not legible."
- "Canadian Nutrition Facts tables are per serving, with the serving size shown in a household measure and in grams. Report the basis accordingly."
- "Calories are kcal. If only kJ is printed, return null for calories and mention it in notes."
- "Ignore % Daily Value columns."
- "If the panel has two columns (as sold / prepared), use 'as sold'."

#### 10.3.4 Expiry extraction schema and rules

Schema fields:
- `raw_text`.
- `date_type`: `best_before | expiry | use_by | packaged_on | sell_by | unknown`.
- `year`, `month` (1–12), `day` (1–31): integer or null.
- `year_was_printed` (boolean).
- `ambiguous_order` (boolean).
- `confidence`.
- **Required:** `date_type`, `year_was_printed`, `ambiguous_order`, `confidence`.

Prompt rules, based on [CFIA](https://inspection.canada.ca/en/food-labels/labelling/industry/date-markings-and-storage-instructions):
- Canadian dates show the **year first (if at all), then month, then day**.
- Month codes are **JA FE MR AL MA JN JL AU SE OC NO DE**. Note **MA = May** and **AL = April** (French *avril*).
- Example: "BB/MA 2026 NO 15" → 2026-11-15. Example: "EXP 11/20/26" is US MM/DD/YY → 2026-11-20.
- "PKD" / "packaged on" / "empaqueté le" → `packaged_on`.
- Ignore lot and batch codes.
- Always return `raw_text`.

A true *expiration* date is mandatory only on a short list of foods (formulated liquid diets, infant formula, …). Most foods carry "best before" dates, and date marking is mandatory only for foods with a durable life of ≤ 90 days ([CFIA](https://inspection.canada.ca/en/food-labels/labelling/industry/date-markings-and-storage-instructions)). UI copy therefore says **"Best before"**, not "Expires".

#### 10.3.5 Adaptation schema (no tools)

```json
{ "type": "object", "required": ["substitutions","ingredients","stepChanges","warnings"],
  "properties": {
    "substitutions": { "type": "array", "items": { "type": "object",
      "required": ["missingIngredient","substitute","pantryItemId","reason","impact"],
      "properties": {
        "missingIngredient": {"type":"string"}, "substitute": {"type":["string","null"]},
        "pantryItemId": {"type":["string","null"]}, "quantity": {"type":["string","null"]},
        "reason": {"type":"string"}, "impact": {"type":"string","enum":["minimal","moderate","significant"]} } } },
    "ingredients": { "type": "array", "items": { "type": "object", "required": ["text","changed"],
      "properties": { "text": {"type":"string"}, "changed": {"type":"boolean"} } } },
    "stepChanges": { "type": "array", "items": { "type": "object", "required": ["stepIndex","newText"],
      "properties": { "stepIndex": {"type":"integer"}, "newText": {"type":"string"} } } },
    "warnings": { "type": "array", "items": {"type":"string"} } } }
```

#### 10.3.6 Schema subset reminders

- **Supported:** types `string`, `number`, `integer`, `boolean`, `object`, `array`, `null`. Nullable fields use type arrays; there is no `nullable` keyword. Keywords `title`, `description`, `properties`, `required`, `additionalProperties`, `enum`, `format` (date/date-time/time), `minimum`/`maximum`, `items`, `prefixItems`, `minItems`/`maxItems`.
- **Not enforced:** `minLength`, `maxLength` and `uniqueItems` are silently stripped.
- **Size:** very large or deeply nested schemas can fail with 400 `INVALID_ARGUMENT`.
- Source: [structured output](https://ai.google.dev/gemini-api/docs/structured-output)

### 10.4 Publisher recipe pages (schema.org Recipe)

- **Properties:** Google's Recipe markup requires only `name` and `image`, and recommends `author`, `recipeIngredient` (one ingredient per string), `recipeInstructions` (preferably `HowToStep` with `text`), `recipeYield`, `nutrition.calories`, ISO-8601 `prepTime`/`cookTime`/`totalTime`, `recipeCategory` and `recipeCuisine` ([Google Search Central](https://developers.google.com/search/docs/appearance/structured-data/recipe)).
- **`recipe-scrapers`:** reads JSON-LD and microdata (`SchemaOrgPlugin`), falls back to OpenGraph, has site-specific scrapers plus a generic "wild mode", repairs broken JSON-LD, and returns a Zod-validated object. Call it as `scrapeRecipe(html, url)` ([architecture doc](https://cdn.jsdelivr.net/npm/recipe-scrapers@1.10.0/docs/architecture.md)).
- **Server-side fetch:** only about 2% of crawls inject schema via JavaScript, so a plain fetch without a headless browser should usually be enough ([Digital Applied, Nov 2026](https://www.digitalapplied.com/blog/schema-markup-adoption-top-homepages-2026)). The share of *recipe pages* that carry Recipe markup is unquantified.
- **Fallback extractor** (`server/recipes/jsonld.ts`): match `<script type="application/ld+json">` blocks, `JSON.parse` each one, walk arrays and `@graph`, and return the first node whose `@type` is `"Recipe"` or includes it.
- **`recipeInstructions` normalization:** a string becomes one step per paragraph, `HowToStep[]` becomes their `.text`, and `HowToSection` is flattened in order.
- **Yield:** take the first integer in `recipeYield`. If none, use 4 and flag it.

### 10.5 ElevenLabs text-to-speech

- **Request:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128`
  - Header `xi-api-key`.
  - Body `{ text, model_id: "eleven_flash_v2_5" }`. The API default model is `eleven_multilingual_v2`, so **always set the model explicitly**.
  - `optimize_streaming_latency` is deprecated.
  - Source: [Stream speech](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)
- **Why HTTP streaming:** it is the recommended mode "for cases where the input text is available up-front", which fits recipe steps. WebSockets are for incremental LLM text ([latency guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization.md)).
- **Model choice:** Flash v2.5 has about 100 ms median model latency, up to 40,000 characters per request, 32 languages, and 50% lower per-character price. `eleven_turbo_v2_5` is deprecated ([Models](https://elevenlabs.io/docs/overview/models)).
- **Cost:** Flash/Turbo API pricing is **$0.04 per 1K characters** ([API pricing](https://elevenlabs.io/pricing/api)). A 15-step recipe at about 150 characters per step comes to roughly $0.09, and caching makes repeat demos close to free.
- **Route** (`app/api/tts/route.ts`):
  1. Validate 1–2000 chars.
  2. If there is no key, return 503 `UPSTREAM_UNAVAILABLE`.
  3. Stream `r.body` through with `Content-Type: audio/mpeg` and `Cache-Control: private, max-age=86400`.
  4. If the upstream response is non-2xx, return 502, and the client falls back.

### 10.6 MediaPipe Tasks Vision

- **Package and assets:** `@mediapipe/tasks-vision@1.2.2`. It ships two WASM variants of about 14.6 MB each, and types `FilesetResolver.forVisionTasks(basePath?, useModule?)`, `BaseOptions.delegate: "CPU" | "GPU"` and `recognizeForVideo(frame, timestamp)`, which is synchronous ([npm tarball](https://registry.npmjs.org/@mediapipe/tasks-vision)).
- **Model file:** the canonical model URL is `https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task` ([overview](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer)). Download it once, commit it to `public/models/`, and **[VERIFY]** that the URL serves (research couldn't reach it through the sandbox proxy).
- **Self-hosting:** `scripts/copy-assets.mjs` (postinstall) copies `node_modules/@mediapipe/tasks-vision/wasm/*` → `public/mediapipe/wasm/`. Never use the `@latest` CDN path. The package shipped four minor releases in Oct–Nov 2026.
- **Canned gestures:** None, Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory, ILoveYou. **Handedness is reported for the subject's hand, and a mirrored image inverts it** ([overview](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer)).
- **Threading:** `recognizeForVideo()` blocks the UI thread, and Google recommends web workers for camera input ([web guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js)). We start on the main thread behind `GestureSource` (§11.7).
- **Performance:** the only published benchmarks are for a Pixel 6: GestureRecognizer averages about 16.8 ms on CPU and 20.9 ms on GPU. Laptop numbers are unknown, so ship a dev FPS counter.

### 10.7 Auth0 and Tiger quick facts

- **Auth0 free plan:** up to 25,000 MAU, unlimited social connections, 1-day log retention, no Pro MFA ([Auth0 pricing](https://auth0.com/pricing)).
- **Auth0 dashboard URLs** for production:
  - Allowed Callback URLs: `https://<domain>/auth/callback`
  - Allowed Logout URLs: `https://<domain>`
  - Allowed Web Origins: `https://<domain>`
  - Keep the localhost equivalents for dev.
- **Tiger free services:** two free services per account (beta), hosted in `us-east-1`, with **no connection pooling, replication, tiering or VPC**. A free service goes read-only when it hits its storage limit ([create a service](https://www.tigerdata.com/docs/get-started/quickstart/create-service)). That limit is reported as **750 MB** by a third party ([Bytebase, VERIFY](https://www.bytebase.com/blog/postgres-hosting-options-pricing-comparison.md)).
- **Tiger trial:** a **$1,000 / 30-day trial** of the paid tiers needs no credit card ([Tiger pricing docs](https://www.tigerdata.com/docs/about/latest/pricing-and-account-management)).
- **Provisioning:** the Console "Download the config" is **the only time the password is shown**.
- **Tiger CLI and MCP** ([Tiger blog](https://www.tigerdata.com/blog/five-features-tiger-cli-you-arent-using-but-should)):
  ```bash
  curl -fsSL https://cli.tigerdata.com | sh && tiger auth login
  tiger service create --name mise-db
  tiger db connection-string
  tiger mcp install claude-code          # lets each Claude agent inspect schema/queries
  tiger service fork <service-id> --name mise-staging   # instant zero-copy fork for migration tests
  ```

---

## 11. Gesture state machine (owned by A)

No published thresholds exist for kitchen gesture control. Every number below is an **engineering starting value to tune**, exposed in `GestureConfig` and adjustable in Settings ("Sensitivity", "Hold time", "Swipe direction", "Always armed").

### 11.1 Mapping

| User control (confirmed) | Gesture | Fires | Why |
|---|---|---|---|
| *(opt-in)* Arm | `Open_Palm` held ≥ **600 ms**. Only when "Always armed" is **off**; it is **on by default** (Jerry, 2026-11-07) | `ARM`, armed for **5 s**. The window extends after each action | When enabled, stirring, chopping and reaching never fire commands. With the default, 800 ms holds, confidence thresholds and the hold-still check guard against misfires |
| Next / previous step | **`Pointing_Up` = next, `ILoveYou` (🤟) = previous**, held ≥ **800 ms**, while armed | `NEXT_STEP` / `PREV_STEP` (once per hold) | Built-in classifier gestures. Swipes and a custom landmark-based sideways point both failed in webcam tests |
| Scroll up / down | `Thumb_Up` / `Thumb_Down` held | First tick at **600 ms**, then every **700 ms** while held, each scrolling **40% of the viewport** | Avoids up/down swipes, which collide with stirring and reaching |
| Start / pause step timer | `Closed_Fist` held ≥ **800 ms**, score ≥ **0.8** | `TIMER_TOGGLE` (once per hold) | Distinct pose. A long hold and high score guard against a fist around a spoon handle |
| Read step aloud / stop | `Victory` held ≥ **800 ms** | `SPEAK_TOGGLE` (once per hold) | Rare in kitchen motion. (ILoveYou is used for previous step: the only other unused built-in gesture) |

Recognizer options:
- `runningMode: 'VIDEO'`, `numHands: 1`.
- `cannedGesturesClassifierOptions: { scoreThreshold: 0.6, categoryAllowlist: ['Open_Palm','Closed_Fist','Thumb_Up','Thumb_Down','Victory','Pointing_Up','ILoveYou'] }`. The option comes from the [1.2.2 types](https://registry.npmjs.org/@mediapipe/tasks-vision).
- The engine applies `minScore = 0.7` (and 0.8 for the fist).

### 11.2 States and transitions

```
 off ──toggle on──► loading ──model+camera ok──► no_hand
  ▲                   │ └─permission denied──► permission_needed ──retry──► loading
  │                   └─model/wasm fail──► error (buttons/keyboard still work)
  └─toggle off / page hide / route leave (stop tracks, close recognizer)

 no_hand ──hand detected (bbox h ≥ 8% frame, not touching edge)──► hand_seen
 hand_seen ──no hand ≥ 300 ms──► no_hand
 hand_seen ──Open_Palm held ≥ armHoldMs──► armed   (emit ARM; armedUntil = now + 5000)
 armed ──pose P ∈ {Closed_Fist, Victory, Thumb_Up, Thumb_Down} starts──► holding(P)
 holding(P) ──P held ≥ threshold──► emit action ──► cooldown   (scroll: repeat tick, stays holding)
 holding(P) ──P changes / hand lost before threshold──► armed
 armed ──swipe detected──► emit NEXT/PREV ──► cooldown
 cooldown ──cooldownMs elapsed AND released (pose changed or no hand ≥ 300 ms)──► armed
 armed ──now > armedUntil──► hand_seen / no_hand   (emit DISARM)
 any ──alwaysArmed=true──► arming step skipped
```

Rules:
- **Release-to-rearm:** a discrete pose action fires at most once per continuous hold.
- **Global cooldown:** 1200 ms after any discrete action (next/previous, timer, speak). Scroll ticks don't trigger it, but a release after scrolling adds a 300 ms cooldown.
- **Successful actions extend the armed window** by another 5 s from the action time.

### 11.3 Swipe detection (removed)

**Superseded (Jerry, 2026-11-07):** swipes didn't fire in the first webcam test, and a custom landmark-based sideways point didn't either. Next/previous now use the built-in `Pointing_Up` / `ILoveYou` gestures, held like the other poses (`DISCRETE` in `features/gesture/engine.ts`, §11.1), and the index fingertip must stay still during the hold. The swipe fields stay in `GestureConfig` only because the contract is frozen. The original design follows for reference.

- Palm centre = mean of landmarks **0, 5, 9, 13, 17**. Smooth with an EMA (α = 0.5) before computing velocity.
- Mirror x so directions match what the user sees: `x' = 1 − x`. **Never use the handedness label for direction.**
- Keep a ring buffer of `{t, x, y}` over the last **400 ms**.
- Fire when **all** of these hold:
  - `|Δx| ≥ 0.25` of frame width
  - `|Δx| ≥ 2·|Δy|`
  - peak velocity ≥ **1.0 frame-widths/s**
  - the pose was not `Closed_Fist` for most of the window
- After firing, clear the buffer. The 1200 ms cooldown also swallows the return stroke.

### 11.4 Constants (`features/gesture/config.ts`)

```ts
export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  minScore: 0.7, fistMinScore: 0.8, classifierScoreThreshold: 0.6,
  armHoldMs: 600, actionHoldMs: 800, armWindowMs: 5000, alwaysArmed: true, // default on (Jerry, 2026-11-07); palm-to-arm is opt-in
  cooldownMs: 1200, releaseMs: 300,
  scrollFirstMs: 600, scrollRepeatMs: 700, scrollFraction: 0.4,
  swipeWindowMs: 400, swipeMinDx: 0.25, swipeDxToDyRatio: 2, swipeMinVelocity: 1.0,
  swipeNextDirection: 'left',
  minHandHeightFrac: 0.08, targetFps: 15, idleFps: 5, idleAfterMs: 10_000,
  delegate: 'GPU',
};
```

### 11.5 Runtime loop (main thread, `features/gesture/MediaPipeGestureSource.ts`)

- **Loading:** `GestureController` is a `'use client'` component loaded with `next/dynamic(..., { ssr: false })` from **another client component**. `ssr:false` is not supported in Server Components ([Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)).
- **Init:** `forVisionTasks('/mediapipe/wasm')`, then `GestureRecognizer.createFromOptions(...)` with `delegate: 'GPU'`, catching failure and retrying with `'CPU'`. Make the delegate configurable, because GPU was *slower* than CPU on the Pixel 6 benchmark.
- **Camera:** `getUserMedia({ video: { facingMode: 'user', width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 30} }, audio: false })`. Map `NotAllowedError`, `NotFoundError` and `NotReadableError`, and handle `navigator.mediaDevices === undefined` (insecure context). A prompt the user ignores may never settle, so show "Waiting for camera permission…" ([MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)).
- **Frame loop:** a rAF loop that processes a frame only when `video.readyState >= 2 && video.currentTime !== last`, throttled to `targetFps`. Drop to `idleFps` after `idleAfterMs` with no hand. Pass a monotonic `performance.now()` timestamp ([HandLandmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)).
- **Strict Mode:** React runs an extra setup and cleanup cycle in dev ([React StrictMode](https://react.dev/reference/react/StrictMode)), so use an `aborted` flag and full cleanup: `cancelAnimationFrame`, stop the tracks, `recognizer.close()`.
- **Visibility:** pause on `visibilitychange` (hidden).
- **State placement:** keep the recognizer, stream and engine in refs. Push HUD state to React at ≤ 10 Hz.

### 11.6 HUD

- **Placement:** a corner widget, ≤ 20% of the screen.
- **Contents:**
  - Optional mirrored camera thumbnail (toggle; off hides the video element but keeps inference running).
  - State chip: "Show your hand" (always armed, the default) or "Show your palm to start" → "Ready · 4 s" → "Hold fist… ◔" → "Timer started ✓".
  - Radial hold-progress ring.
  - Gesture legend (5 icons).
  - Hints: "Move closer" (hand bbox < 8%), "Turn on a light" (low confidence for 3 s), "One hand please".
- **Debug:** landmarks are drawn only when `NEXT_PUBLIC_GESTURE_DEBUG=true`.
- **Feedback:** every fired action produces a brief full-screen edge flash plus a soft click sound (respecting reduced motion) and an `aria-live` announcement, because the cook is often looking at the pan rather than the screen.
- **Camera indicator:** a persistent "Camera on" pill with a one-tap off switch.

### 11.7 Worker offload (P2)

The `GestureSource` interface allows a `WorkerGestureSource`:
- The main thread posts transferable `VideoFrame`/`ImageBitmap` objects, with one frame in flight.
- The worker is created with `new Worker(new URL('./gesture.worker.ts', import.meta.url), { type: 'module' })` and initialized with `forVisionTasks(base, true)`.
- Fishjam used this pattern in production ([Fishjam blog](https://fishjam.swmansion.com/blog/real-time-gesture-recognition-in-videoconferencing-4711855a1a53)).
- Module workers have a history of `importScripts` breakage, and a maintainer said 0.10.35 "should work" ([issue #5257](https://github.com/google-ai-edge/mediapipe/issues/5257)). `DrawingUtils` fails in workers. Test on Safari before switching.

### 11.8 Testability

- `GestureEngine` is a pure class: `update(result: GestureRecognizerResult-like, now: number)`. It takes no DOM or MediaPipe imports, so Vitest can drive it with synthetic landmark sequences in `features/gesture/__fixtures__/`.
- `KeyboardGestureSource` (Phase 0 mock) maps keys to `GestureAction`s so Cook Mode can be built before MediaPipe works.

---

## 12. UX rules (apply everywhere)

1. **Original before AI, always.** Anything Gemini *generated or transformed* carries a visible badge: "AI-adapted" on adaptations, "Read by AI, please confirm" on label and expiry drafts, "≈ estimate" on computed nutrition. Publisher content carries attribution instead.
2. **Confirm before save** for every AI extraction. Nothing from Gemini reaches the database without a user tap.
3. **Every gesture has a tap and a keyboard equivalent.** Gestures are never the only path, and hands-free is opt-in per session.
4. **Kitchen-distance readability in cook mode:**
   - Step text ≥ 32 px.
   - One step per screen.
   - Tap targets ≥ 25% of width for Prev and Next, and ≥ 56 px elsewhere.
   - Contrast ≥ WCAG AA. Dark theme default in cook mode.
5. **Colour is never the only signal.** Expiry bands also show text ("2 days"), and have/missing markers use icon + label.
6. **Feedback for hands-free actions** goes through three channels: visual flash, sound, and `aria-live` text. Respect `prefers-reduced-motion`.
7. **Progressive results.** Recipe search streams status messages and cards. Never show a spinner with no message for more than 2 s.
8. **Honest empty and error states:**
   - "We couldn't find this product" leads straight to the next fallback.
   - "Camera blocked" offers buttons and keyboard.
   - "Voice: Device" appears when ElevenLabs is unavailable.
9. **"Best before", not "Expires"**, unless Gemini classified the date as `expiry`/`use_by`. Show the raw printed text next to the parsed date.
10. **Allergy copy:** filters are strict, but the app always says "Always check product labels for allergens." Never claim a recipe is "safe".
11. **Units:** show the user's display unit and accept common abbreviations. Never show raw base units to users.
12. **Design deliverable:** produce a Figma file of the main screens (Today, Pantry, Scan, Recipes, Recipe detail with Original + AI-adapted, Cook mode + HUD) for the Best Design submission (§16).

---

## 13. Security and privacy

| Area | Rule |
|---|---|
| Secrets | Server-only. None use the `NEXT_PUBLIC_` prefix. `.env.production` lives on the VPS with `chmod 600` and is never baked into the image. Entire's secrets redaction is a bonus, not a control |
| AuthZ | `requireUser()` in every route handler and Server Action. Every SQL statement includes `user_id = ${user.id}`. IDs in URLs are always re-checked against the user, and a mismatch returns **404** (not 403) |
| Input validation | Zod on every body and query. Barcode digits 8–14. Text caps (TTS 2000, freeText 100). Image MIME allowlist and ≤ 4 MB each, ≤ 3 per request |
| LLM output | Treated as untrusted input: Zod-validated, values sanity-checked, pantry IDs verified, allergens re-checked in code, URLs verified by fetch |
| SSRF (recipe fetcher) | `server/recipes/safe-fetch.ts`: only `http(s)` on ports 80/443. Resolve DNS and **reject private, loopback, link-local and metadata IPs** (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7), re-checked on every redirect. Max 5 redirects, 5 s timeout, 2 MB body cap, `text/html` only |
| Rendering third-party HTML | Never `dangerouslySetInnerHTML` publisher HTML. Parse it to text. Gemini's Search Suggestions HTML is rendered **unmodified inside a sandboxed `<iframe srcdoc>`** (`sandbox="allow-popups allow-popups-to-escape-sandbox"`) **[VERIFY this satisfies the Grounding display terms]** |
| Camera and video | Frames are processed locally and never recorded, uploaded or stored. Model and WASM are self-hosted, so there are no third-party requests while hands-free is on. The camera starts only after an explicit toggle, a persistent indicator is shown, and tracks stop on toggle-off, page hide and route leave |
| Photos | Label and expiry photos go to Gemini through our server for one request and are **not persisted** (memory only). The UI copy says so |
| Headers | `Permissions-Policy: camera=(self), microphone=()`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`. CSP (P1): `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`; `img-src 'self' data: blob: https:`; `media-src 'self' blob:`; `connect-src 'self'`; `worker-src 'self' blob:`. The `'wasm-unsafe-eval'` source is needed for Emscripten WASM (general knowledge **[VERIFY]**) |
| Abuse and cost | Per-user rate limits (§7). TTS text cap. Discovery cache. Barcode cache and single-flight |
| Licensing and attribution | "Product data © Open Food Facts contributors, ODbL" in the footer and on product cards. OFF images are CC BY-SA. Recipe attribution and "View original" on every recipe |
| Data deletion | Settings → "Delete my data" deletes the `users` row (cascades) (P1) |

---

## 14. Testing and verification

### 14.1 Commands (every agent's definition of done)

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # next lint / eslint
npm test               # vitest run (unit + contract tests; no network)
npm run test:db        # vitest against DATABASE_URL_TEST (a Tiger fork), runs migrations first
npm run test:e2e       # playwright smoke against a running dev server with fixtures (P1)
```

Anthropic's guidance is to "Give Claude a check it can run: tests, a build, a screenshot to compare" ([best practices](https://code.claude.com/docs/en/best-practices.md)). Each workstream keeps its tests green on its own branch before merging.

### 14.2 Required unit tests

| Module | Cases |
|---|---|
| `lib/units.ts` | Every factor. cup→ml. kg↔g. Cross-dim with and without bridge (null). `parseUnit` aliases |
| `lib/gtin.ts` | Valid EAN-13, UPC-A→GTIN-13 padding, EAN-8, bad check digit, non-numeric |
| `server/vision/date.ts` | CFIA regex (MA=May, AL=April). Missing year inference around year-end. Ambiguous order. Range rejection. packaged_on |
| `server/products/*` | dataandapis and OFF adapters on saved fixtures. Miss vs error classification. Sodium/kJ conversions |
| `server/diet/check.ts` | The table in F7 AC1, plus ≥ 3 cases per allergen and diet |
| `server/recipes/jsonld.ts`, `parse.ts` | `@graph` walk, `@type` arrays, HowToSection flattening, yield parsing, ingredient parse |
| `server/recipes/score.ts`, `match.ts` | Formula on fixtures. Synonyms. FEFO tie-break. Expired excluded |
| `server/nutrition/recipe.ts` | F10 AC1. Coverage. Density flag |
| `server/cook/plan.ts` | Scaling by servings. Clamping. Unconvertible |
| `features/gesture/engine.ts` | Synthetic sequences: arm, hold fist → exactly 1 TIMER_TOGGLE; long hold → still 1; swipe left → NEXT; return stroke ignored; unarmed motion → 0 actions; scroll repeat cadence |
| `features/cook/timers.ts` | Remaining from `endsAt`. Pause/resume. Duration regex (ranges → lower bound, compound) |
| `features/voice/normalize.ts` | Fractions, °F/°C, abbreviations, ranges |

### 14.3 DB integration tests (`npm run test:db`, against a Tiger fork)

1. Migrations apply cleanly on a fresh fork. Hypertables appear in `timescaledb_information.hypertables`, and `daily_nutrition` exists.
2. Finish-cooking transaction: F14 AC1, AC2, AC3, AC5.
3. Isolation: user A's queries never return user B's rows, for every list endpoint's SQL.
4. `daily_nutrition` real-time aggregate includes a meal inserted 1 s earlier **[VERIFY]**.

### 14.4 Manual verification checklist (run on the deployed HTTPS URL before submission)

1. Log in with Google → onboarding → `/today`.
2. Scan a real product with the laptop webcam *and* a phone. Type one barcode. Trigger one not-found and complete it via label photo. Add one item fully by hand.
3. Add an expiry by photo (a real "best before" stamp) and confirm it. Add one manually.
4. Find recipes. The cards stream in, the top card uses an expiring item, attribution and "View original" work, and a peanut-allergy test account never sees a peanut recipe.
5. Open a recipe with one missing ingredient → AI adaptation appears, badged and separate. The original is unchanged.
6. Cook hands-free: arm, swipe next ×3, swipe prev ×1, thumb-down scroll, fist starts the timer, fist pauses it, victory reads aloud via ElevenLabs. Then unset the key on a staging run and confirm the browser voice takes over.
7. **False-trigger test:** 30 s of stirring, chopping and reaching while unarmed → 0 actions. Record the result.
8. Reload mid-recipe → resume prompt → timers correct.
9. Finish → deduction preview → confirm → pantry quantities drop → `/today` rings update → 7-day chart shows history.
10. DevTools Network: no image or video uploads during hands-free mode, and model and WASM are served from our origin.

---

## 15. Deployment (Vultr)

- **Credits:** MLH gives hackers **$100 in Vultr credit**. Register at `mlh.link/vultr-discover`, then enter the promo code in Billing → Gift Code ([MLH Vultr partner page](https://www.mlh.com/partners/vultr)).
- **Server:** one Vultr Cloud Compute VPS (Ubuntu, Docker) with **≥ 2 GB RAM**. A 1–2 GB plan can run out of memory during `next build`, so add swap or build the image elsewhere and pull it. Pick a **US East region (e.g. New Jersey)** to sit near Tiger's free-service region `us-east-1` (research inference).
- **Domain:** a GoDaddy Registry domain (e.g. `.tech`) with an **A record → VPS IP**. Caddy then provisions Let's Encrypt automatically. If there's no domain, a temporary `<ip>.sslip.io` hostname with Caddy auto-TLS is the fallback **[VERIFY]**. HTTPS is mandatory: `getUserMedia` exists only in secure contexts ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)). The same applies to Wake Lock and BarcodeDetector.
- **Firewall:** `sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw reload` ([Vultr Caddy guide](https://docs.vultr.com/how-to-install-caddy-using-docker-on-a-vultr-cloud-server)).
- **Deploy early.** Ship the Phase 0 skeleton to the real HTTPS domain so camera features are tested on phones from the start.

`docker-compose.yml` (adapted from Vultr's Caddy guide, dropping its unused `external` volume and deprecated `version` key):
```yaml
services:
  web:
    build: .
    env_file: .env.production
    restart: unless-stopped
    expose: ["3000"]
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy_data:/data", "caddy_config:/config"]
    restart: unless-stopped
volumes: { caddy_data: {}, caddy_config: {} }
```

`Caddyfile`:
```
mise.tech {
  encode zstd gzip
  reverse_proxy web:3000
}
```

`Dockerfile` (multi-stage, Next standalone output; standard pattern **[VERIFY paths against Next 16 docs]**):
```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Deploy steps:
1. `git pull`.
2. `docker compose build web && docker compose up -d`.
3. `docker compose exec web node scripts/migrate.mjs`, run from the image or from a laptop against `DATABASE_URL`.
4. Check `https://<domain>/api/health`, which returns `{ ok, db, version }` (Phase 0).

Wait at least 1 minute for the first certificate.

Auth0 production settings are listed in §10.7. Set `APP_BASE_URL=https://<domain>`.

Local dev:
- `npm run dev` on `http://localhost:3000`. Localhost counts as a secure context.
- For phones on the LAN, use `next dev --experimental-https` **[VERIFY flag in Next 16]**, or just test on the deployed domain.

---

## 16. Prize-proof checklist

Opt in to every track on Devpost. Required: a GitHub repo link. Strongly recommended: a demo video of up to 4 minutes. Overall judging covers Problem & User Research, Innovation, Technical Implementation, Design & UX, and Presentation ([HackCamp 2026 Devpost](https://hackcamp-2026.devpost.com/)). Put each track's proof in its own labelled section of the Devpost write-up.

| Track | What the sponsor asks for | What we show (proof artifact) |
|---|---|---|
| **MLH Best Use of Gemini API** | Gemini-powered build ([Devpost](https://hackcamp-2026.devpost.com/)) | Four distinct Gemini uses: **grounded search finding real recipes** (screenshot of streamed results with attribution), **vision label extraction**, **expiry date reading with CFIA rules**, **schema-constrained adaptation** validated by code. A short diagram of the two-call pipeline. Model IDs in the write-up |
| **MLH Best Use of Auth0** | "creatively implement authentication and application security using Auth0" ([Devpost](https://hackcamp-2026.devpost.com/)) | Universal Login with Google in the video. `proxy.ts` protection. `requireUser()` on every route. A two-account isolation demo (B's item ID returns 404 for A). `sub`→user mapping. Logout |
| **MLH Best Use of Tiger Data** | "innovative use of Tiger Data to build high-performance applications" ([Devpost](https://hackcamp-2026.devpost.com/)) | The `meal_logs` and `pantry_events` **hypertables**. The `daily_nutrition` **continuous aggregate** with refresh policy and real-time "today". The transactional finish-cooking flow. `EXPLAIN ANALYZE` aggregate vs raw. Screenshots of `tiger mcp` used by the coding agents and a `tiger service fork` used for migration tests |
| **MLH Best Use of Vultr** | "creative use of Vultr's cloud infrastructure" ([Devpost](https://hackcamp-2026.devpost.com/)) | The live HTTPS URL on the Vultr VPS (needed for camera gestures). The Docker Compose + Caddy setup. A Vultr dashboard screenshot. *Optional:* Vultr Object Storage or inference (unverified products, P2) |
| **MLH Best Use of Entire** | Prize: Mini Portable Projector ([Devpost](https://hackcamp-2026.devpost.com/)). The brief asks to use Sessions, Graph and/or Brain; **the exact MLH wording is unverified, so confirm with the MLH/Entire rep** | See §18.6. Links to entire.com **Sessions** for each workstream. **Graph** installed and used by agents. **Brain** connected and shared across all 3 accounts (`entire brain recall`/`viz` showing a decision from A's agent reused by B's). One **Trail** per workstream with eval scores across pushes. `entire why <file>:<line>` tracing a gesture-threshold line to its prompt (Labs) |
| **MLH Best Domain Name (GoDaddy Registry)**, optional | Requires an eligible GoDaddy Registry domain ([Devpost](https://hackcamp-2026.devpost.com/)) | Register the domain, point it at Vultr, and use it as `APP_BASE_URL` |
| **Overall / Beginner Overall** (ElevenLabs subscriptions are bundled here; there is **no** dedicated ElevenLabs track) ([Devpost](https://hackcamp-2026.devpost.com/)) | General judging criteria | ElevenLabs read-aloud with device fallback, shown in the video. User-research quotes from hackers who cook |
| **Best Design** | Needs a **Figma link** ([Devpost via earlier research](https://hackcamp-2026.devpost.com/)) | A Figma file of the key screens (§12 rule 12). The cook-mode HUD design. Accessibility notes |
| **Community Impact** | Needs an **impact statement** ([Devpost via earlier research](https://hackcamp-2026.devpost.com/)) | Food-waste angle (expiry-first recipes), accessibility (hands-free, read-aloud for low vision, keyboard). Cite any user quotes gathered at the event |
| *Most Accessible Design* | Beginner stream only ([Devpost](https://hackcamp-2026.devpost.com/)) | Applies only if the team is beginner-stream |

---

## 17. Open questions and things to verify

Phase 0 resolves items 1–8 before the workstreams fork. Record each answer in this file and in Brain (`entire brain remember`).

| # | Item | Why it matters | How to verify |
|---|---|---|---|
| 1 | Exact `@google/genai` API for (a) grounded search with `googleSearch` and `groundingMetadata`, (b) JSON schema output with images (`interactions.create` vs `models.generateContent`) | The research saw both shapes. The wrapper must work | Read the current SDK README. Run one grounded call and one label-photo call |
| 2 | Gemini **Grounding terms**: must Search Suggestions be displayed, and may grounded results and URLs be cached (24 h search cache, 7-day recipe cache)? | The research could not read the terms page | Read the "Grounding with Google Search" section of the Gemini API Additional Terms. Adjust `recipe_search_cache` TTL or drop it |
| 3 | `gemini-3.8-flash` latency (reported 13.3 s TTFT) vs `gemini-3.5-flash-lite` for discovery. Does Flash-Lite support grounding? | Search UX and the 5k free grounded queries | Time 3 runs of each. Keep `GEMINI_SEARCH_MODEL` configurable |
| 4 | dataandapis not-found shape. Whether misses cost tokens. Units of `sodium` and the carb convention. The team key's plan and quota | Cache policy and correctness | Call with `0000000000000` and with a known product. Check the dashboard token count |
| 5 | OFF v2 field names (`proteins_100g`, `fat_100g`, `_serving`) and not-found shape | Adapter correctness | One staging call (`world.openfoodfacts.net`, basic auth off/off). Save as a fixture |
| 6 | Tiger free service: TimescaleDB present. `WITH (tsdb.hypertable…)` accepts the composite PK. tz-aware `time_bucket` in the cagg. Real-time aggregation. Connection string format. Storage cap (750 MB is third-party) | Migrations | Run the migrations on a fork. `SELECT extname, extversion FROM pg_extension;` |
| 7 | `auth0.getSession()` with no args inside route handlers | Auth on every API route | Quick test route. Fallback to `withApiAuthRequired` |
| 8 | MediaPipe model URL serves. GPU vs CPU delegate on the demo laptop. Laptop FPS | Gesture reliability | Download and commit the model. Enable the dev FPS counter |
| 9 | Exact versions: react, tailwind, zod (does it include `z.fromJSONSchema`, as used in the Gemini docs?), `barcode-detector`, `@google/genai`, `recipe-scrapers` (licence, maintenance), vitest, playwright | Pinning | `npm view <pkg> version license` |
| 10 | Copyright/ToS: is it acceptable to display full `HowToStep` text in cook mode (option a) versus a summary plus link (option b)? | Legal risk. US law treats simple directions as uncopyrightable ([Circular 33](https://www.copyright.gov/circs/circ33.pdf)), but site ToS and other jurisdictions weren't reviewed | Team decision. Default (a), with attribution and the "View original" link always visible |
| 11 | Allergen enum vs Health Canada's priority allergen list | Completeness of the strict filter | Check Health Canada's list. Adjust `Allergen` (a contract change, §18.5) |
| 12 | ElevenLabs: does the team have a key or credits? Free-tier quota? Is `eleven_v4_turbo` on the team's tier? An earlier report found 3 months free for Canadian students 18+ ([ElevenLabs blog](https://elevenlabs.io/blog/introducing-elevenlabs-for-students)) | Read-aloud quality in the demo | Check the account. The fallback means the demo never depends on it |
| 13 | Entire: is `/session handoff` real? Is `entire blame`/`why` Labs-only? Do Trails or hosted Brain need a paid plan? What is the exact MLH prize wording? | Entire prize proof | `entire --help`, `entire labs`, `entire agent-help`, [pricing](https://entire.com/pricing). Ask the MLH rep |
| 14 | Swipe direction default (right→left = next) and all gesture thresholds | Usability | Hallway test with 3–5 people. Tune `GestureConfig` |
| 15 | `next dev --experimental-https` flag; sslip.io fallback; Dockerfile standalone paths | Dev and deploy | Try them |
| 16 | `'wasm-unsafe-eval'` needed in the CSP for MediaPipe and zxing WASM | CSP | Enable the CSP in staging and watch the console |

**Answers (Jerry, 2026-11-07)**

- **8.** The model URL serves. `public/models/gesture_recognizer.task` is committed (8,373,440 bytes, sha256 `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`). GPU vs CPU and laptop FPS: *pending a manual test on the demo laptop* (gestures branch).
- **9.** Pinned exactly: `next` 16.4.5, `react`/`react-dom` 19.3.1, `@auth0/nextjs-auth0` 4.33.0, `postgres` 4.1.0, `zod` 4.6.7 (has `z.fromJSONSchema` and `z.toJSONSchema`), `@mediapipe/tasks-vision` 1.2.2, `barcode-detector` 3.2.3 (bundles `zxing-wasm` 3.1.6), `@google/genai` 3.0.0, `recipe-scrapers` 3.5.0 (TypeScript, MIT, last published 2026-10-31), `tailwindcss` 4.3.5 (via `@tailwindcss/turbopack`), `vitest` 5.1.0, `@playwright/test` 1.65.0. Kept create-next-app's `typescript` 5.9.3 and `eslint` 9.39.5 (TS 7 and ESLint 10 exist but weren't adopted), and `@types/node` 22.20.5 to match the Node 22 runtime. **Decision:** create-next-app 16.4.5 enables `cacheComponents` by default; it is **off**, so session reads render dynamically as this spec assumes. `npm run typecheck` runs `next typegen` first, so the global `PageProps`/`LayoutProps` types exist.
- **12.** The team has an ElevenLabs key. Tier and quota are checked when `/api/tts` lands (voice branch).
- **13.** Entire CLI 0.13.1: there is no `/session handoff` (`entire session` has `resume`, `attach`, `adopt`). `entire blame` and `entire why` are Labs commands and available. Trails work on the current plan (trails 1–3 exist). The Brain plugin isn't installed on Jerry's machine (`entire plugin install brain`). The MLH prize wording still needs to be confirmed with the rep.
- **14.** Webcam tests: swipes didn't work, nor did a custom sideways-point detector. **Next/previous are now the built-in ☝️ `Pointing_Up` / 🤟 `ILoveYou`, held 0.8 s with the fingertip still** (§11.1, §11.3). Other thresholds: *pending* further testing.
- **16.** *Pending* until the CSP in `next.config.ts` lands (Hang), then checked in the browser console with hands-free on.

---

## 18. Parallel build plan: 3 Claude Code accounts through Entire

### 18.1 Collaboration model

- **One GitHub repo**, mirrored to Entire. Entire supports mirroring a GitHub repository, and in GitHub-mirrored repos a linked GitHub PR handles CI and merge ([Entire docs index](https://docs.entire.com/); [Trails](https://docs.entire.com/guides/trails/overview.md)).
- **Three accounts on three machines.** Each teammate runs their own Claude Code account on their own clone and their own long-lived branch: `ws/a-cook`, `ws/b-pantry`, `ws/c-recipes`. Within one machine, extra parallel sessions can use `claude --worktree <name>`, which needs at least one commit to exist first ([common workflows](https://code.claude.com/docs/en/common-workflows)). Entire tracks each worktree's sessions independently ([entireio/cli](https://github.com/entireio/cli)).
- **Cross-account coordination happens through git and Entire, not through Claude's own messaging.** Whether Claude Code's agent-teams and cross-session messaging work across separate accounts is unverified. The channels are:
  - **Brain** (`entire brain connect`) for shared memory
  - **Trails** for intent and review
  - **`TASKS.md`** for the checklist
  - small, frequent commits, each of which creates an Entire checkpoint
- **Cadence:** commit small and often. Rebase on `main` regularly. Before each merge, run a fresh-context `/code-review` ([best practices](https://code.claude.com/docs/en/best-practices.md)) plus the §14.1 commands.

### 18.2 Phase 0: Foundation (one agent, everyone else sets up accounts)

**Owner:** teammate A's Claude (or whoever is fastest), with the humans reviewing. Everything in §3.2 marked **P0** is created here.

| # | Task | Done when |
|---|---|---|
| 0.1 | `create-next-app` (TS, App Router, `src/`, Tailwind, ESLint). Pin all versions (§4). Initial commit | `npm run build` passes. First commit exists (needed for worktrees) |
| 0.2 | Entire setup for the repo (§18.6). Mirror the GitHub repo. Create 3 Trails with `--no-branch` that capture each workstream's intent | `entire status` is OK on all 3 machines |
| 0.3 | Write `SPEC.md` (this file) and `CLAUDE.md` (§19). Run `entire graph setup && entire brain setup` and commit the managed blocks and `.entire/agent-guide.md` | Committed |
| 0.4 | **Contracts:** `src/contracts/{domain,api,gesture,voice,index}.ts` exactly as in §6–§7, plus fixtures | `npm run typecheck` passes |
| 0.5 | `src/lib/`: `env.ts` (Zod), `auth0.ts`, `proxy.ts`, `current-user.ts`, `db.ts` (postgres.js pool `max: DB_POOL_MAX`, `ssl:'require'`), `http.ts` (json/error helpers, NDJSON writer), `rate-limit.ts`, `units.ts` + tests, `gtin.ts` + tests | Unit tests pass. Login works locally |
| 0.6 | Tiger: create the service (`mise-db`) and a fork (`mise-test`). Write `db/migrations/0001`, `0002` and `scripts/migrate.mjs`. Apply to both. Run `tiger mcp install claude-code` on each machine | §14.3 test 1 passes. Resolve §17 item 6 |
| 0.7 | `src/lib/gemini/client.ts` with `geminiJson` and `geminiGroundedSearch` verified live (§17 items 1–3). Write the JSON schemas from §10.3 into `schemas.ts` | One grounded and one vision smoke script succeed |
| 0.8 | **Stub route handlers** for every route in §7, returning fixtures, typed against contracts, with `requireUser()` | Each route returns typed fixture JSON |
| 0.9 | `(app)/layout.tsx` with auth gate and nav (Today, Pantry, Recipes, Settings). Landing page. `components/ui/*` tokens and primitives. Empty pages for each route group showing "TODO (owner)" | All pages render behind login |
| 0.10 | `KeyboardGestureSource` mock, and a `VoicePlayer` stub that uses `speechSynthesis` only | Imported from `features/gesture` and `features/voice` placeholder index files |
| 0.11 | `scripts/copy-assets.mjs` (MediaPipe WASM + model, zxing WASM). `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `/api/health`. **Deploy the skeleton to Vultr over HTTPS.** Configure Auth0 production URLs | Login works on `https://<domain>` |
| 0.12 | Fill in §17 answers 1–8. Write `TASKS.md` with the workstream checklists below. Tag `phase0` | Tag pushed. All three teammates pull |

**Freeze:** after the `phase0` tag, `src/contracts/**`, `db/migrations/0001-0002`, `src/lib/**`, `src/components/ui/**`, `app/layout.tsx`, `globals.css`, `package.json` and the deploy files change only via §18.5.

### 18.3 Workstreams (run in parallel after `phase0`)

#### Workstream A: Cook Mode (gestures, voice, timers, cook UI)

- **Owns:** `src/features/gesture/**`, `src/features/cook/**`, `src/features/voice/**`, `src/app/(app)/cook/**`, `src/app/api/tts/**`, `public/mediapipe/**`, `public/models/**`.
- **Consumes:**
  - `GET /api/cook/sessions/:id` → `CookSessionView`
  - `PATCH /api/cook/sessions/:id`
  - `GET …/finish-preview`, `POST …/finish` (all owned by C; Phase 0 stubs until then)
- **Provides:** the `CookingController` implementation, `VoicePlayer`, `GestureSource` (MediaPipe), `FinishDialog`, `/api/tts`.
- **Tasks:**
  1. Cook view with reducer and keyboard (F11).
  2. Timers: duration parsing and absolute-time model.
  3. Wake lock.
  4. Resume.
  5. `normalizeForSpeech`.
  6. `/api/tts`.
  7. `useVoice` with cache, prefetch and fallback (F13).
  8. `GestureEngine` (pure) with tests (§11).
  9. `MediaPipeGestureSource`, the HUD and the hands-free toggle (F12).
  10. `FinishDialog` against the contracts (F14 UI).
  11. Settings panel for gesture config.
  12. False-trigger test and threshold tuning.
- **Done:** F11–F13 ACs pass, F14 UI works against stubs, and the §14.2 gesture/timer/voice tests pass.

#### Workstream B: Pantry, Products and Nutrition

- **Owns:** `src/features/scan/**`, `src/features/pantry/**`, `src/features/nutrition/**`, `src/server/products/**`, `src/server/vision/**`, `src/server/pantry/**`, `src/server/nutrition/daily*`, `src/app/(app)/{onboarding,settings,today,pantry}/**`, `src/app/api/{me,products,vision,pantry,meals,nutrition}/**`, `public/zxing/**`.
- **Consumes:** `server/diet` allergen keyword map, imported read-only from C for `allergenTags` normalization. Until C lands it, use the Phase 0 stub list.
- **Provides:** a real pantry (C needs it for matching and finish). `PantryItem` rows conform to the contract.
- **Tasks:**
  1. `/api/me` + onboarding + settings (F1).
  2. Scanner component (F2).
  3. Lookup orchestrator, dataandapis and OFF adapters, cache, single-flight, fixtures (F2).
  4. `/api/vision/label` + ProductForm (F3).
  5. `/api/vision/expiry` + date assembly + CFIA regex (F4).
  6. Pantry list, CRUD and events (F5).
  7. Meals API, today and history endpoints, rings, 7-day chart, Log Food dialog (F15).
  8. Per-item nutrition display (F10 item part).
- **Done:** F1–F5 and F15 ACs pass, plus the §14.2 products/date/units tests.

#### Workstream C: Recipes and Cooking Backend

- **Owns:** `src/features/recipes/**`, `src/server/recipes/**`, `src/server/diet/**`, `src/server/cook/**`, `src/server/nutrition/recipe*`, `src/app/(app)/recipes/**`, `src/app/api/{recipes,cook}/**`.
- **Consumes:**
  - the pantry via SQL on `pantry_items`, a read-only query helper in `server/recipes/pantry-view.ts`
  - `geminiJson` and `geminiGroundedSearch`
- **Provides:** the real `/api/recipes/*` and `/api/cook/*`, which replace the Phase 0 stubs that A builds against.
- **Tasks:**
  1. `safe-fetch` with SSRF tests.
  2. Discovery → resolve → fetch → extract (`recipe-scrapers` + JSON-LD fallback).
  3. Ingredient parse and normalization.
  4. `checkDiet` with the full test table (F7).
  5. Match and score (F6).
  6. NDJSON search route + streaming UI (F6, UF5).
  7. Recipe detail page, Original card (F8).
  8. Recipe nutrition (F10).
  9. Adapt route, validation, AdaptedCard (F9).
  10. Cook session routes, deduction planner, finish transaction + DB tests (F14 server).
- **Done:** F6–F10 and F14 server ACs pass, plus the §14.3 transaction tests.

### 18.4 Integration phase

1. Merge order: **C's cook routes first** (A depends on them), then B, then A. After each merge, run all §14.1 commands on `main`.
2. Swap stubs for real implementations and delete the Phase 0 fixture routes. Run the full §14.4 checklist locally, then on the Vultr domain.
3. Cross-workstream checks:
   - A's FinishDialog → C's finish → B's `/today` reflects the meal.
   - B's pantry items appear as matches in C's recipe cards.
   - The C detail page "Cook" button → A's cook view.
4. Polish: empty states, copy (§12), Figma parity, the attribution footer.
5. Proof capture (§16): screenshots, `EXPLAIN ANALYZE`, Entire links, `entire why` output, demo video.
6. Freeze `main`, tag `submission`, and redeploy from the tag.

### 18.5 Change protocol for frozen files

- **Contracts, migrations, `src/lib/**` and shared UI:**
  1. The agent stops and asks its human.
  2. The human makes **one small dedicated commit** on `main` titled `contract: …`. It is additive whenever possible: new optional fields, new routes, a new migration file `0003_*.sql` rather than editing old ones.
  3. The human announces it in team chat and runs `entire brain remember "…"`.
  4. All workstreams rebase.
- **`package.json`:** request the dependency in team chat. One designated person (the Phase 0 owner) adds it with an exact version and pushes. Never edit the lockfile in parallel.
- **Optional enforcement:** a Claude Code `PreToolUse` hook (`.claude/hooks/guard-paths.mjs`) that reads the edited `file_path` from the hook input and blocks (exit code 2) any path outside the allowlist for `$MISE_WS` (A/B/C), as well as any path under `src/contracts/**`. Anthropic recommends hooks for "actions that must happen every time with zero exceptions" ([best practices](https://code.claude.com/docs/en/best-practices.md)). **[VERIFY hook input format in the Claude Code hooks docs.]**

### 18.6 Entire setup and usage (every teammate)

```bash
curl -fsSL https://entire.io/install.sh | bash      # entire.io now redirects to entire.com
entire login
cd mise && entire enable --agent claude-code
entire plugin install graph && entire plugin install brain
entire graph setup && entire brain setup           # regenerates .entire/agent-guide.md + CLAUDE.md managed block
entire brain connect                               # hosted, team-shared memory across all 3 accounts
entire status
```

Sources: [entireio/cli](https://github.com/entireio/cli); [Brain docs](https://docs.entire.com/guides/brain/overview.md). Brain requires **Claude Code 2.1.78+**, has no `entire brain mcp` command, and keeps memories local until you connect. Commit `.entire/agent-guide.md` and the managed `CLAUDE.md` block. Do **not** use the stale `npm install -g @entireio/cli` / `entire init` / `entire capture` commands found in older third-party write-ups.

How each Entire capability gets used, which doubles as prize proof:
- **Sessions:** automatic. Every Claude Code session is captured. On commit, an `Entire-Checkpoint` trailer is added and metadata goes to `entire/checkpoints/v1`, with no extra commits on your branch ([entireio/cli](https://github.com/entireio/cli); [Sessions](https://docs.entire.com/guides/sessions/overview.md)). Use `entire session resume` to pick up work, and `entire checkpoint explain <id>` in reviews.
- **Graph:** a code map that agents query for "what does changing `RecipeStep` affect?". Entire claims "up to 71%" token savings, without giving a method ([Graph overview](https://docs.entire.com/guides/graph/overview.md)).
- **Brain:** **each agent starts every session with `entire brain brief "<task>" --json`**. Record decisions with `entire brain remember` (e.g. "swipe right→left = next", "finish route returns 409 on replay"). Show `entire brain recall`, `viz` and `dash` in the demo.
- **Trails:** one per workstream, created in Phase 0 with `entire trail create --title "Cook Mode: gestures + voice" --no-branch` and then linked to the branch with `entire trail link`. Eval scores (e.g. Security, Slop) are "calculated on every push", so push often for a visible history ([Trails](https://docs.entire.com/guides/trails/overview.md)). Run `entire agent-help` so agents can create and update trails themselves.
- **Labs (verify availability with `entire labs`):** `entire blame <file>` and `entire why <file>:<line>`. Demo these on the gesture threshold constants and the allergen map.
- `/session handoff` was **not found** in the docs. Don't rely on it (§17 item 13).

---

## 19. Suggested CLAUDE.md (commit at repo root; keep it this short)

Anthropic advises: "Keep it concise. For each line, ask: 'Would removing this cause Claude to make mistakes?'" Include commands, gotchas and repository etiquette, and exclude file-by-file tours ([best practices](https://code.claude.com/docs/en/best-practices.md)).

```markdown
# Mise — agent rules

Spec: @SPEC.md (contracts in src/contracts/ win over prose). Tasks: @TASKS.md

## Commands
- npm run dev | npm run build | npm run typecheck | npm run lint | npm test | npm run test:db
- Migrations: node scripts/migrate.mjs  (never edit an applied migration; add 000N_*.sql)
- Definition of done for any task: typecheck + lint + test green, and the feature's ACs in SPEC §9.

## Ownership (do NOT edit outside your workstream; ask your human instead)
- WS-A Cook Mode: src/features/{gesture,cook,voice}, src/app/(app)/cook, src/app/api/tts, public/{mediapipe,models}
- WS-B Pantry/Nutrition: src/features/{scan,pantry,nutrition}, src/server/{products,vision,pantry}, src/server/nutrition/daily*, app pages onboarding/settings/today/pantry, api me/products/vision/pantry/meals/nutrition
- WS-C Recipes/Cook backend: src/features/recipes, src/server/{recipes,diet,cook}, src/server/nutrition/recipe*, app pages recipes, api recipes/cook
- FROZEN (Phase 0; change only via a human "contract:" commit): src/contracts/**, src/lib/**, src/components/ui/**, db/migrations/0001-0002, package.json, layout/globals, Docker/Caddy files

## Hard rules
- Every route handler / Server Action starts with `const user = await requireUser()`; every SQL filters by user.id. Never read userId from the request.
- Secrets are server-only; never prefix with NEXT_PUBLIC_. Never log API keys or photos.
- All Gemini calls go through src/lib/gemini (geminiJson / geminiGroundedSearch). Never combine googleSearch tool with a response schema.
- LLM output is untrusted: zod-validate, re-check allergens with server/diet/checkDiet, verify pantry IDs and URLs.
- Show the ORIGINAL recipe verbatim with attribution; AI-adapted content is a separate variant with an "AI-adapted" badge. Never mutate an original variant.
- Store quantities in base units (g/ml/count) via src/lib/units; never guess cross-dimension conversions.
- MediaPipe/camera code: 'use client', loaded via next/dynamic({ssr:false}) from a client component; full cleanup in useEffect; never @latest URLs; frames never leave the device.
- Timers use absolute endsAt timestamps, never decrementing counters.
- Pin exact dependency versions; ask the human before adding a dependency.

## Workflow
- Start each session: `entire brain brief "<your task>" --json`. Record decisions: `entire brain remember "<decision>"`.
- Small commits (each = Entire checkpoint). Conventional prefix: feat(ws-a): / fix(ws-c): / test: / contract:
- Rebase on main often. Run /code-review in a fresh session before merging.
- Mark [VERIFY] items you resolve in SPEC §17 via your human.
```

---

## Conclusion

The riskiest parts of this build aren't gestures or auth. They are three LLM boundaries: finding real URLs, reading labels and dates, and adapting recipes. In each one, Gemini's output can be well-formed and still wrong. The spec therefore keeps Gemini out of every decision that has to be correct. Gemini finds candidate URLs, but the recipe content shown is whatever the publisher's own markup says, fetched and parsed by our code. Gemini reads a label, but a person confirms it. Gemini proposes a substitution, and `checkDiet` decides whether it is allowed. That split is also what lets three agents work in parallel safely, because the deterministic modules (units, GTIN, diet, scoring, timers, the gesture engine) are pure and testable against frozen contracts with no network. The two choices most worth revisiting after the event are the gesture thresholds in §11.4, which no published study validates, and how much publisher step text to store. That second one is a product and legal call, and the research could only partly settle it.
