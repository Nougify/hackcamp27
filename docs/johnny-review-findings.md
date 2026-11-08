# Workstream B review findings

Results of two `entire review general` runs on 2026-11-08, merged and deduplicated. The first covered `johnny/nutrition` at `fc8eb88` against `origin/main`; the second ran one commit later.

The reviewers read the code and did not run it. Apart from the refuted item below, these findings have not been reproduced, so confirm each one before fixing it. Line numbers are from the reviewed commits. Where the two runs gave different severities, the higher one is listed.

## Refuted

**`src/server/pantry/profile.ts:82` (reported as high): "Delete my data" fails for anyone who has cooked.** The review expected a foreign key violation from `cooking_sessions` and `meal_logs` referencing `recipe_variants` with NO ACTION. Postgres queues the NO ACTION checks from cascaded deletes until the outer `DELETE` ends, when the sessions are gone too. The test `delete my data works for a user who has cooked` in `src/server/pantry/repo.db.test.ts` passes on the unchanged code.

## Open

| # | Severity | Location | Problem | Suggested fix |
|---|---|---|---|---|
| 1 | Medium | `src/server/pantry/profile.ts:82` | Deleting a user leaves `daily_nutrition` rows older than the 30-day refresh window, although Settings promises permanent deletion of meal history. | Refresh the aggregate over the user's full meal range, or purge those buckets, and assert it in a test. |
| 2 | Medium | `src/features/nutrition/LogFoodDialog.tsx:170` | `FromScan` has no same-code guard and remounts the scanner after a failed lookup, so a barcode still in view is looked up in a loop, spending `products/lookup` quota. | Ignore a repeat of the last failed code until the user acts or the code changes, as `AddProductFlow` attempts. |
| 3 | Medium | `src/features/nutrition/WeekChart.tsx:20` | The `[]` effect runs while the empty state is rendered, so no `ResizeObserver` attaches. After the first log the chart stays 560px wide and clips the Today column on phones. | Use a callback ref, or render the observed box in both branches. |
| 4 | Medium | `src/features/scan/ExpiryCapture.tsx:100`, `src/features/pantry/ProductForm.tsx:248` | The non-portaled `<dialog>` sits inside `ProductForm`'s `<form>`, so pressing Enter in its date input saves the product before the photo date is confirmed. | Render it outside the form, or stop Enter on those inputs. |
| 5 | Medium | `src/server/pantry/validation.ts:17` | Quantity and nutrient values have no upper bound, so values beyond `numeric(12,3)` or `numeric(8,2)` overflow and return a 500. | Add bounds matching the columns, applied to quantity after unit conversion. |
| 6 | Medium | `src/features/pantry/PantryList.tsx:261` | `Number('')` is 0, so clearing "Now have" and saving empties the item and writes a `manual_adjust` event. | Reject a blank value before parsing. |
| 7 | Medium | `src/features/pantry/ProductForm.tsx:117` | Edit requires quantity above 0, so empty pantry items can't be corrected without inventing stock. | Allow 0 in edit mode, which the update schema already accepts. |
| 8 | Low | `src/features/pantry/PantryList.tsx:220` | Adjust's `value` is set once per row, so after an Edit or restock it prefills a stale amount and saving can revert the change. | Set `value` from the current quantity when Adjust opens. |
| 9 | Low | `src/features/scan/AddProductFlow.tsx:65` | The 1-second duplicate check returns after `BarcodeScanner` has stopped its tick loop, so the preview stays live but scanning has stopped. | Keep scanning when a code is ignored, or remount the scanner. |
| 10 | Low | `src/server/nutrition/daily.ts:133` | The barcode branch calls `getCachedProduct` on the global `sql` while holding a `sql.begin` connection. With a pool of 5, five concurrent logs could hang. | Fetch the product before `sql.begin`, or pass `tx`. |
| 11 | Low | `src/features/pantry/PantryList.tsx:160` | The edit form prefills unrounded `fromBase` values, and a floating-point difference on save can add a `manual_adjust` event with a delta of about 0. | Round the prefill and compare base quantities at column scale. |
| 12 | Low | `src/lib/current-user.ts:38` | `devUserSeeded` caches the demo-user insert, so after "Delete my data" in no-Auth0 mode the user isn't recreated until the server restarts. | Re-check the row per request, or clear the cache on delete. `src/lib` is frozen, so this needs a `contract:` commit. |
