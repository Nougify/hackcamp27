# Johnny: §17 answers and decisions (Workstream B + auth/DB foundation)

These answers are for a human to copy into SPEC.md §17. Items still marked **Pending** need live credentials.

## §17 answers

### 4. dataandapis.com: not-found shape, token cost, sodium unit, carbs, plan
**Verified 2026-11-08** (team key, 2 calls):
- **Miss:** HTTP **404**, `{"ok":false,"message":"Product '0000000000000' not found","tried":["0000000000000","00000000","000000000000","00000000000000"]}`. The API retries re-paddings itself.
- **Token cost:** the response header `ratelimit-requests-remaining` read **500 after the miss and 499 after the Nutella hit**, so a miss appears **not** to cost a token. Re-check on the dashboard if quota gets tight.
- **Plan:** a full allowance of 500 means the **Free plan** (500 tokens/month). The products cache and negative cache are essential.
- **Sodium:** `nutriments_per_100g.sodium` is **grams**. Nutella gives `0.043` against OFF's `0.0428 g`, and `salt` 0.107 ≈ sodium × 2.5. So `sodiumMg = sodium × 1000`.
- **Carbs:** `carbohydrates` 57.5 equals OFF's `carbohydrates_100g`, i.e. as printed. Team decision: store as printed (EU labels exclude fibre).
- **Fields seen:** `quantity` was `"400 g e"` (not null as the docs example showed), `serving_size` null, `allergens` `"Milk, Nuts, Soybeans"` (comma-separated English), `attribution {dataset, source:"Open Food Facts", source_url, licence:"ODbL v1.0"}`, `image_url`, `last_modified`, `completeness`.
- Latency was 389–718 ms. The Nutella body is saved as the adapter fixture.

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
**Blocked (2026-11-08):** both `DATABASE_URL` and `DATABASE_URL_TEST` in `.env.local` have **no password** (`postgres://tsdbadmin@host:port/tsdb?sslmode=require`), so connecting fails with `28P01 password authentication failed`. Add the password from the Tiger config download (URL-encode special characters). Then:
1. `SELECT extname, extversion FROM pg_extension;` and confirm `timescaledb` is listed.
2. `node scripts/migrate.mjs --test`. This checks that `WITH (tsdb.hypertable…)` accepts the composite PK and that `time_bucket(…, 'America/Vancouver')` works in the cagg.
3. Insert a meal, then `SELECT * FROM daily_nutrition` right away to confirm real-time aggregation.

Migration design (dev's `scripts/migrate.mjs`, run with `npm run migrate` / `npm run test:db`):
- Every file runs in its own transaction (`sql.begin`), and versions are tracked by filename in `schema_migrations`.
- **Open risk:** 0002 creates a continuous aggregate and its policy inside that transaction, and TimescaleDB may reject that ("cannot run inside a transaction block"). Verify on the fork first. If it fails, `migrate.mjs` needs a no-transaction path for 0002.

### 7. `auth0.getSession()` with no args in route handlers
**Partly verified 2026-11-08** against the real tenant (`next dev`, no browser):
- Signed-out `GET /api/pantry` returns **401** `{"error":{"code":"UNAUTHORIZED","message":"No active session"}}`. So the no-arg `getSession()` runs inside a route handler and returns null without a session.
- Signed-out `GET /today` returns **307 → /auth/login**.
- `/auth/login` returns **307 → https://nougify.ca.auth0.com/authorize** (PKCE S256, scope `openid profile email offline_access`, `redirect_uri=http://localhost:3000/auth/callback`).
- **Still to do:** a real browser login, then `GET /api/me`, which needs the DB password fix. The `@auth0/nextjs-auth0@4.33.0` type docs say the no-arg `getSession()` works in App Router route handlers.

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
