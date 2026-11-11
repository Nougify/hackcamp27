# Workstream B handoff

Status of the pantry, scan and nutrition work (F1–F5, F10 item, F15), updated 2026-11-08 evening. The `johnny` branch includes `main` up to #19 and adds the review fixes on top.

On that branch, typecheck, lint and 645 unit tests pass, as do 42 of 43 database tests. The one failure is explained under "Behaviour worth knowing". Review history is in `docs/johnny-review-findings.md`.

## Done since the first handoff
- Independent review of the late fixes in `src/features/scan/`, `PantryList.tsx` and `profile.ts`. One finding fixed: Enter on the expiry dialog's photo input couldn't open the file picker.
- `contract:` commit: "Delete my data" in no-Auth0 mode now re-creates the demo user on the next request (`forgetDevUser()` in `src/lib/current-user.ts`).
- Vertex AI smoke test (`scripts/gemini-smoke.mjs`) passes: grounded search and vision JSON.
- Browser checks without a camera all pass (Playwright, demo mode, test DB): Enter manually during a slow lookup, Enter in the expiry date field, phone-width week chart, the three pantry edit cases, From-pantry mass units, and the unit reset after "Scan another".
- README was already up to date.

## To do, in order

### 1. Open and merge the PR
<https://github.com/Nougify/hackcamp27/compare/main...johnny>

### 2. Apply migration 0003 to production, before deploying
`main` reads `past_best_before_grace_days`, so `/api/me`, onboarding, every onboarded page and recipe search fail without it. Check `SELECT * FROM schema_migrations`, then `npm run migrate` against production.

### 3. Camera checks (need a real phone or webcam)
- [ ] Scan an unknown barcode on Pantry → Add and in Log food → Scan, and hold it in view. It should look up once and keep scanning for other codes. Typing the same code should still retry.
- [ ] Photograph a best-before date in the expiry dialog. The AI badge should show once the date is read.

### 4. Copy the §17 answers into SPEC.md
Items 4, 5, 6, 7 and 11 are answered in `docs/johnny-verify.md` but not yet in `SPEC.md` §17.

## Housekeeping
- **Entire access:** the `hairychickenleg7` account can't see project `gh/nougify`, so `entire review` and trail commands fail. A teammate with access needs to grant it.
- **`test:e2e`:** SPEC §14.1 lists it and Playwright is installed, but no script exists. Needs the `package.json` owner.
- **Shared test DB:** `npm run test:db` and a local dev server pointed at `DATABASE_URL_TEST` share one aggregate, so manual refreshes there affect the tests. Use a separate fork for local demo data if this gets in the way.

## UX notes from QA (not bugs, consider later)
- Pantry Adjust: clearing "Now have" and saving does nothing and gives no feedback.
- Add form: choosing "pieces" switches "Values are" to "per piece" (`ProductForm.tsx`), so per-100 g numbers typed afterwards are saved per piece. Easy to miss.
- Log food → From pantry: with "Also remove from pantry" ticked, a pieces item with no piece weight shows "can't convert" with no hint that unticking unlocks g/kg (`LogFoodDialog.tsx`).

## Behaviour worth knowing
- After a failed lookup, the camera ignores that barcode until a different one is read. Typing it or using "Scan another" still works.
- "Delete my data" refreshes `daily_nutrition` only for buckets older than 29 days; the 30-day policy clears newer ones. If that refresh fails, the account is still deleted and the error is only logged as `[delete-user] daily_nutrition refresh failed`. Someone would need to re-run the refresh for that range.
- **Known test failure until 2026-11-09 07:00 UTC:** `history > zero-fills, ends today and includes meals not yet materialized` in `daily.db.test.ts` fails on `chefly-test`. An earlier version of the delete fix advanced that database's aggregate watermark to that time, which hides today's new meals from real-time results. The shipped code can't do this, production was never touched, and the test should pass once the watermark is in the past.
