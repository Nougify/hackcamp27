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
