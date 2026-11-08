# Johnny: §17 answers and decisions (Workstream B + auth/DB foundation)

These answers are for a human to copy into SPEC.md §17. Items still marked **Pending** need live credentials.

## §17 answers

### 4. dataandapis.com: not-found shape, token cost, sodium unit, carbs, plan
**Pending:** no `DATAANDAPIS_KEY` yet. Once it's set:
1. `GET https://api-barcode-lookup.dataandapis.com/v1/products/0000000000000` with `X-Api-Key`. Record the status and body.
2. Call Nutella `3017620422003` and save the body as `src/server/products/__fixtures__/dataandapis.nutella.json`.
3. Compare the dashboard token count before and after the miss to see whether misses cost a token.
4. Check the `sodium` unit against OFF's `sodium_100g` for Nutella (OFF has 0.0428 g).
5. Note the plan tier.

The adapter treats these as **miss**: any non-2xx other than 401/402/429/5xx, `ok:false`, or a missing `name`. Errors are never negatively cached.

### 5. Open Food Facts v2 fields and not-found shape
**Verified 2026-11-07** (staging `world.openfoodfacts.net` plus one production read):
- **Found:** HTTP 200, `{"status":1,"status_verbose":"product found","product":{…}}`.
- **Valid but unknown GTIN:** **HTTP 404**, `{"code":"4821739056146","status":0,"status_verbose":"product not found"}`.
- **Invalid code** (e.g. all zeros): **HTTP 200**, `{"code":"00000000","status":0,"status_verbose":"no code or invalid code"}`. OFF strips leading zeros from the echoed code.
- So "`status !== 1` or HTTP 404 → miss" (§10.2) covers both cases.
- **Nutriment keys** (flat, v2):
  - Confirmed verbatim: `energy-kcal_100g`, `energy-kj_100g`, `proteins_100g`, `fat_100g`, `saturated-fat_100g`, `carbohydrates_100g`, `sugars_100g`, `fiber_100g` (US spelling), `sodium_100g`, `salt_100g`, plus `<name>_unit`.
  - `sodium_100g` is in **grams** (`sodium_unit: "g"`), so `sodiumMg = sodium_100g × 1000`.
  - `_serving` keys appear only when the product has serving data. Nutella currently has none.
- **Quantity:**
  - `product_quantity` is a number and `product_quantity_unit` a unit (Nutella: `400`, `"g"`).
  - `quantity` is free text (`"400 g e"`; the `e` is the EU estimated sign).
  - `serving_quantity` is in grams when present.
- **Staging data isn't realistic.** It holds test products for the GS1 example codes (`5901234123457` is "Pancakes"), and its Nutella has an empty `quantity`. Fixtures therefore come from a production read.

### 6. Tiger: TimescaleDB present, hypertable syntax, tz-aware time_bucket, real-time cagg, connection string, storage cap
**Pending:** no Tiger services yet. Once `DATABASE_URL_TEST` (the fork) is set:
1. `SELECT extname, extversion FROM pg_extension;` and confirm `timescaledb` is listed.
2. `node scripts/migrate.mjs --test`. This checks that `WITH (tsdb.hypertable…)` accepts the composite PK and that `time_bucket(…, 'America/Vancouver')` works in the cagg.
3. Insert a meal, then `SELECT * FROM daily_nutrition` right away to confirm real-time aggregation.

Migration design (dev's `scripts/migrate.mjs`, run with `npm run migrate` / `npm run test:db`):
- Every file runs in its own transaction (`sql.begin`), and versions are tracked by filename in `schema_migrations`.
- **Open risk:** 0002 creates a continuous aggregate and its policy inside that transaction, and TimescaleDB may reject that ("cannot run inside a transaction block"). Verify on the fork first. If it fails, `migrate.mjs` needs a no-transaction path for 0002.

### 7. `auth0.getSession()` with no args in route handlers
**Documented, not yet run.** The `@auth0/nextjs-auth0@4.33.0` type docs say the no-arg `getSession()` "can be used in Server Components, Server Actions, and Route Handlers in the **App Router**". I'll confirm at runtime once the Auth0 tenant exists.

How sign-in is enforced on `dev`:
- `src/proxy.ts` only runs `auth0.middleware()`, which mounts `/auth/*` and rolls sessions. It's skipped when `authDisabled`, i.e. outside production with no `AUTH0_DOMAIN`, where everyone is a demo user.
- `requireUser()` throws `UnauthorizedError`. Route handlers turn it into a 401 `ApiError` JSON via `handleRouteError`, and `(app)/layout.tsx` turns it into a redirect to `/auth/login`.
- This covers F1 AC1 as long as every route handler uses `try { … } catch (err) { return handleRouteError(err) }`.

### 11. Allergen enum vs Health Canada priority allergens
Health Canada's priority allergens are peanuts, tree nuts, sesame, milk, eggs, fish, crustaceans, molluscs, soy, wheat and triticale, and mustard, plus sulphites and gluten sources (barley, oats, rye).

Decision (team): **keep the `Allergen` enum unchanged** and document the mapping:
- `shellfish` = crustaceans **and** molluscs
- `wheat_gluten` = wheat, triticale, barley, oats, rye (gluten sources)
- The other values map one-to-one.

## Other decisions
- **Env validation:** dev's `getEnv()` parses only partially during `next build` and in tests, warns in local dev, and throws in production. `src/instrumentation.ts` calls it at server start, so production fails at boot with the missing variable names.
  - Verified: `next build` passes with no `.env.local`.
  - Verified: `next start` in production with no env logs the names and "Failed to prepare server".
  - Caveat: in that failed state the `next start` process stayed alive instead of exiting.
- **DB types (`src/lib/db.ts`):** `numeric` and `int8` are parsed to JS numbers. `date` stays a `'YYYY-MM-DD'` string. `timestamptz` comes back as a `Date`. Existing callers already wrap values in `Number()` and accept `string | Date` dates.
- **`.env.example`:** dev's file (whitelisted in `.gitignore`).
- **GTIN (`src/lib/gtin.ts`):**
  - Spaces, hyphens and dots are stripped; letters give `non_numeric`.
  - UPC-E expands to GTIN-13. Scanner `upc_e` is always expanded; a typed 8-digit code is tried as EAN-8 first.
  - A GTIN-14 with indicator 0 collapses to GTIN-13. This changed one expectation in dev's `gtin.test.ts`.
  - `normalizeGtin(raw, format?)` keeps dev's `{ ok, gtin }` shape. `normalizeBarcode()` also returns `lookupCode` and `kind`.
  - EAN-8 uses its 8 digits for provider calls and the 13-digit padded form as the key.
- **Label basis:** Gemini's `per_serving` maps to `ProductDraft.basis = 'serving'`. F3 AC1's `'per_serving'` wording is the schema value, not the contract value.
- **Normalizer:** `normalized_name` comes from `src/server/pantry/normalize.ts` (Johnny). Hang's recipe ingredient parser imports it, so matching uses identical rules.
