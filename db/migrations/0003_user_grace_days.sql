-- contract: per-user grace period for items past their best-before date (team decision 2026-11-07).
-- Items up to this many days past expiry_date still count as usable: /today "Expiring soon",
-- /pantry colouring, and recipe matching. Exposed as UserProfile.pastBestBeforeGraceDays.
ALTER TABLE users
  ADD COLUMN past_best_before_grace_days int NOT NULL DEFAULT 0
  CHECK (past_best_before_grace_days BETWEEN 0 AND 14);
