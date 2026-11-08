# Hang: Recipes & Cooking Backend (Workstream C) + Gemini, routes, deploy

All three of us start at the same time. Source of truth is `SPEC.md`; section numbers point into it.
Branch: `hang/<feature>`. Only edit files you own. Ask in chat before touching anyone else's.

## Hour 0: foundation slice (parallel with Jerry and Johnny)

- [ ] **While Jerry scaffolds (~10 min):** get the Gemini API key, create the Vultr VPS, and point a domain (or sslip.io) at it _(human action — see docs/hang-notes.md)_
- [x] `src/lib/gemini/client.ts` (`geminiJson`, `geminiGroundedSearch`) + `schemas.ts` (§10.3). Run one grounded smoke call and one vision smoke call (0.7) _(code done; live smoke needs key: `node scripts/gemini-smoke.mjs`)_
- [x] `src/lib/http.ts` (json/error helpers, NDJSON writer), `src/lib/rate-limit.ts`
- [x] Stub route handlers for **every** route in §7, returning contract fixtures. Jerry and Johnny build against these (0.8) _(non-C routes stubbed; C routes implemented for real)_
- [x] `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `next.config.ts` headers/CSP, `/api/health`. Deploy to Vultr over HTTPS, then give Johnny the production URLs for Auth0 (0.11) _(config done; deploy needs VPS)_
- [x] Resolve §17 items 1, 2, 3, 10, 15 _(1 resolved, 15 partial, 2/3/10 need human/key — see docs/hang-notes.md)_

## Workstream C: Recipes & Cooking Backend (§18.3)

**Owns:** `src/features/recipes/**`, `src/server/{recipes,diet,cook}/**`, `src/server/nutrition/recipe*`, `src/app/(app)/recipes/**`, `src/app/api/{recipes,cook}/**`
**Consumes:** `pantry_items` via a read-only helper `server/recipes/pantry-view.ts`, plus `geminiJson` and `geminiGroundedSearch`
**Provides:** the real `/api/recipes/*` and `/api/cook/*`. Jerry's cook mode depends on these, so **merge the cook routes first** (§18.4).

- [x] 1. `safe-fetch` with SSRF tests
- [x] 2. Discover → resolve → fetch → extract (`recipe-scrapers` + JSON-LD fallback, §10.4)
- [x] 3. Ingredient parse + normalization
- [x] 4. `checkDiet` with full test table (F7). Push the allergen map early; Johnny imports it
- [x] 5. Match + score (F6)
- [x] 6. NDJSON search route + streaming UI (F6, UF5)
- [x] 7. Recipe detail page, Original card (F8)
- [x] 8. Recipe nutrition (F10)
- [x] 9. Adapt route, validation, AdaptedCard (F9)
- [x] 10. Cook session routes, deduction planner, finish transaction + DB tests (F14 server)

**Done:** F6–F10 and F14 server ACs pass, plus the §14.3 transaction tests.
