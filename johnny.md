# Johnny: Pantry, Products & Nutrition (Workstream B) + auth & database

All three of us start at the same time. Source of truth is `SPEC.md`; section numbers point into it.
Branch: `johnny/<feature>`. Only edit files you own. Ask in chat before touching anyone else's.

## Hour 0: foundation slice (parallel with Jerry and Hang)

- [x] **While Jerry scaffolds (~10 min):** create the Auth0 tenant (Regular Web App) and the Tiger service `mise-db` + fork `mise-test`. Put the secrets in team chat or a password manager, never in git.
- [x] `db/migrations/0001_init.sql`, `0002_timescale.sql` (§5.2–§5.3) + `scripts/migrate.mjs`. Apply to both DBs (0.6)
- [x] `src/lib/`: `env.ts` (Zod, §8), `auth0.ts`, `src/proxy.ts`, `current-user.ts` (`requireUser`), `db.ts` (postgres.js, `max: DB_POOL_MAX`, `ssl:'require'`)
- [x] `src/lib/units.ts` + tests (§5.4), `src/lib/gtin.ts` + tests
- [x] `.env.example`
- [x] Resolve §17 items 4, 5, 6, 7, 11

Push these files as soon as they work; Jerry and Hang import `requireUser` and `db`.

## Workstream B: Pantry, Products & Nutrition (§18.3)

**Owns:** `src/features/{scan,pantry,nutrition}/**`, `src/server/{products,vision,pantry}/**`, `src/server/nutrition/daily*`, `src/app/(app)/{onboarding,settings,today,pantry}/**`, `src/app/api/{me,products,vision,pantry,meals,nutrition}/**`, `public/zxing/**`
**Consumes:** Hang's `server/diet` allergen map, read-only. Use a stub list until it lands.
**Provides:** a real pantry. Hang's recipe matching and finish-cooking read `pantry_items`.

- [x] 1. `/api/me` + onboarding + settings (F1)
- [x] 2. Scanner component (F2)
- [x] 3. Lookup orchestrator: dataandapis + OFF adapters, cache, single-flight, fixtures (F2, §10.1–§10.2)
- [x] 4. `/api/vision/label` + ProductForm (F3)
- [x] 5. `/api/vision/expiry` + date assembly + CFIA regex (F4)
- [x] 6. Pantry list, CRUD, events (F5)
- [x] 7. Meals API, today + history endpoints, rings, 7-day chart, Log Food dialog (F15)
- [x] 8. Per-item nutrition display (F10 item part)

**Done:** F1–F5 and F15 ACs pass, plus the §14.2 products/date/units tests.
