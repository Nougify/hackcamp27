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
