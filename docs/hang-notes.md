# Hang's workstream notes (Workstream C + foundation slice)

Branch: `hang`. Covers `hang.md` Hour 0 + Workstream C tasks 1–10.
Verified: `npm run typecheck` ✓, `npm run lint` (0 errors) ✓, `npm test` (263 pass) ✓, `npm run build` ✓ (with dummy env).

## §17 resolutions (items 1, 2, 3, 10, 15)

- **Item 1 — @google/genai API: RESOLVED by package inspection** (`@google/genai@3.0.0` types).
  `ai.models.generateContent({ model, contents, config })` with `config.tools = [{ googleSearch: {} }]`;
  grounding read from `candidates[0].groundingMetadata` (`groundingChunks[].web`, `webSearchQueries`,
  `searchEntryPoint.renderedContent`). JSON mode via `responseMimeType: 'application/json'` + `responseSchema`,
  images as `{ inlineData: { mimeType, data } }` parts. Implemented in `src/lib/gemini/client.ts`.
  Live proof: `gcloud auth application-default login`, then `GOOGLE_CLOUD_PROJECT=... node scripts/gemini-smoke.mjs`.
- **Item 2 — Grounding terms: NOT resolved, needs a human.** I could not read the Gemini API Additional
  Terms from here. Implementation follows the SPEC's cautious default: 24 h discovery-URL cache
  (`recipe_search_cache`), `searchEntryPoint.renderedContent` rendered unmodified in a sandboxed
  `<iframe srcdoc sandbox="allow-popups allow-popups-to-escape-sandbox">`. Human: read the terms,
  then keep/shorten/drop the cache.
- **Item 3 — 3.8-flash vs flash-lite: NOT resolved, needs a key.** `GEMINI_SEARCH_MODEL` is
  configurable (`src/lib/env.ts`, default `gemini-3.8-flash`). Human: time 3 discovery runs per model.
- **Item 10 — full step text: team decision needed; default (a) implemented.** Cook/detail views show
  full `HowToStep` text with attribution + always-visible "View original" link. No headnotes/stories
  are ever copied. Human: confirm (a) vs summary-plus-link (b).
- **Item 15 — dev/deploy flags: PARTIALLY resolved.**
  - `next dev --experimental-https` EXISTS in Next 16.4.5 (verified via `next dev --help`), with
    `--experimental-https-key/cert/ca` options. Use it for phone-on-LAN testing.
  - Dockerfile standalone paths match the standard Next 16 output (`.next/standalone/server.js` +
    `.next/static` + `public/`); `npm run build` produces them (verified).
  - sslip.io fallback: unverified here; Caddy auto-TLS against it needs a VPS test.

## Deliberate deviations from SPEC (all marked "tune freely" or forced by tooling)

1. **expiryScore normalization** (`src/server/recipes/score.ts`): SPEC sketches cross-set normalization,
   which forbids streaming each candidate with its final score (F6 step 8). Using per-candidate
   saturating `Σw/(Σw+1)` instead. Ordering intent preserved; F6 AC6 test matches this formula.
2. **TypeScript 6.0.3, not 7.x**: typescript-eslint does not support TS 7, which broke `npm run lint`
   entirely. Pinned `typescript: 6.0.3` (exact). Revisit if Next/Auth0 require TS 7 features.
3. **ESLint flat config**: `FlatCompat` + `next/core-web-vitals` crashes under ESLint 10. Using the
   documented Next 16 flat pattern (`eslint-config-next/core-web-vitals` + `/typescript`).
   `@eslint/eslintrc` left installed but unused (harmless; remove in a cleanup pass if wanted).
4. **Discovery cache key** includes `freeText` (SPEC lists expiring+diets+allergens only) — a different
   theme must not reuse another theme's URLs.
5. **Adaptation cache**: SPEC keys by (recipeId, missing set, pantry hash, filters); implemented as
   newest-first match on the exact missing-ingredient set (pantry hash/filters not persisted — no
   column for them without a migration B/C must coordinate). Documented in `store.ts`.
6. `cheerio@1.2.0` + `parse-ingredient@3.2.0` added (exact) — required peers of `recipe-scrapers`.

## For Jerry (A) — cook routes are real, merge these first (§18.4)

- `POST /api/cook/sessions`, `GET/PATCH /api/cook/sessions/:id`,
  `GET .../finish-preview?servingsCooked=`, `POST .../finish` — all contract-typed.
- `CookSessionView` includes `scaledQtyDisplay` + `usedInSteps` per ingredient; changed steps carry
  `changed: true` (show the "AI-adapted" chip).
- Finish is one transaction with 409-on-replay; preview `display` strings are ready to render.

## For Johnny (B)

- `server/diet/check.ts` exports `ALLERGEN_KEYWORDS` + `checkDiet` — import read-only for
  `allergenTags` normalization (additive changes only, tell me first).
- `GET /api/pantry` etc. are still Phase 0 stubs returning fixtures; C's matching reads `pantry_items`
  directly via `server/recipes/pantry-view.ts` and needs your real rows for meaningful results.
- `src/lib/gemini/schemas.ts` has the label/expiry JSON schemas + Zod + system prompts for your vision routes.

## Human actions still needed (need real credentials / accounts)

1. ADC + `GOOGLE_CLOUD_PROJECT` → run `node scripts/gemini-smoke.mjs`, then `npm run dev` search for real.
2. Tiger service (`chefly-db`) + fork (`chefly-test`) → `DATABASE_URL`, `DATABASE_URL_TEST` → `npm run migrate`, `npm run test:db`.
3. Auth0 tenant URLs (callback/logout/origins) for localhost + production (§10.7).
4. Vultr VPS + domain (or sslip.io) → `.env.production` (chmod 600) + `gcp-sa.json` service-account key (Vertex AI User, chmod 600) next to docker-compose.yml → compose up → `/api/health`.
5. Decisions: §17 items 2 (terms), 10 (step text), 3 (model latency test).
