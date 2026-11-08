# Workstream B handoff

Status of the pantry, scan and nutrition work (F1–F5, F10 item, F15) on 2026-11-08. All of it is on the `johnny` branch, which already includes `main` up to the Vertex AI switch (#13).

On that branch, typecheck, lint, the production build, 585 unit tests and 43 database tests pass. Review history and fixes are in `docs/johnny-review-findings.md`.

## To do, in order

### 1. Open and merge the PR
Open a PR from `johnny` into `main`: <https://github.com/Nougify/hackcamp27/compare/main...johnny>. It wasn't opened from Johnny's machine because `gh` isn't installed there, and it's unconfirmed whether `johnny` has mirrored to GitHub yet.

The latest fixes haven't had an independent review, because the Entire reviews stopped before they landed. Read the diff for `src/features/scan/`, `src/features/pantry/PantryList.tsx` and `src/server/pantry/profile.ts` closely.

### 2. Apply migration 0003 to production, before deploying
`0003_user_grace_days.sql` was applied to the test database only, as far as `docs/johnny-verify.md` records. Profile queries read `past_best_before_grace_days`, so `/api/me`, onboarding and every onboarded page fail without it. Check `schema_migrations`, then run `npm run migrate`.

### 3. Check the client fixes in a browser
The automated tests don't cover these. Use a real camera for the first one.

- [ ] Scan an unknown barcode on Pantry → Add and in Log food → Scan, and hold it in view. It should look up once and keep scanning for other codes. Typing the same code should still retry.
- [ ] Tap "Enter manually" during a slow lookup, then type. The form should stay.
- [ ] Press Enter in the expiry dialog's date field. The product should not save. The AI badge should show once a date is read.
- [ ] Log your first meal on a phone-width screen. The week chart should fit, with the Today column visible.
- [ ] In the pantry: clear "Now have" and save (no change); open Adjust after an Edit (current amount shown); edit an empty item (saves with quantity 0).
- [ ] In Log food → From pantry, pick a piece-counted item with per-100 g nutrition and no piece weight. Unticking "Also remove from pantry" should enable mass units.
- [ ] After "Scan another", the unit should reset.

### 4. Fix the demo user after "Delete my data" (`contract:` commit)
In no-Auth0 mode, `devUserSeeded` in `src/lib/current-user.ts:38` isn't reset, so the demo user is missing until the server restarts. Local dev only. `src/lib` is frozen, so it needs a small `contract:` commit.

### 5. Add grace days to recipe search (Hang)
Users can set `pastBestBeforeGraceDays` (0–14), and `/today` and `/pantry` honour it. `src/server/recipes` doesn't reference it yet, so recipe search ignores the setting.

## Housekeeping
- **Vertex AI:** since #13, Gemini needs `GOOGLE_CLOUD_PROJECT` and Application Default Credentials (`gcloud auth application-default login`; production mounts `gcp-sa.json`). See `.env.example`. Label and expiry photo reading wasn't exercised against Vertex on this branch; `scripts/gemini-smoke.mjs` is a quick check.
- **Entire access:** the `hairychickenleg7` account can't see project `gh/nougify`, so its trail commands fail and its review verdicts were never posted. A teammate with access needs to grant it.
- **README is stale:** line 29 says `current-user.ts` is a placeholder, and line 33 says there's no `.env.example`.
- **`test:e2e`:** SPEC §14.1 lists it and Playwright is installed, but no script exists.

## Behaviour worth knowing
- After a failed lookup, the camera ignores that barcode until a different one is read. Typing it or using "Scan another" still works.
- If the `daily_nutrition` refresh fails after "Delete my data", the account is still deleted and the error is only logged as `[delete-user] daily_nutrition refresh failed`. Someone would need to re-run the refresh for that range.
