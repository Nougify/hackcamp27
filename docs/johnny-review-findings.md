# Workstream B review findings

Results of three `entire review general` runs on 2026-11-08, merged and deduplicated: 23 findings, of which 21 are fixed, 1 is refuted and 1 is open. Line numbers are from the reviewed commits, before the fixes.

## Open

**`src/lib/current-user.ts:38` (low).** `devUserSeeded` caches the demo-user insert, so after "Delete my data" in no-Auth0 mode the user isn't recreated until the server restarts. Re-check the row per request, or clear the cache on delete. `src/lib` is frozen, so this needs a `contract:` commit.

## Refuted

**`src/server/pantry/profile.ts:82` (reported as high): "Delete my data" fails for anyone who has cooked.** The review expected a foreign key violation from `cooking_sessions` and `meal_logs` referencing `recipe_variants` with NO ACTION. Postgres queues the NO ACTION checks from cascaded deletes until the outer `DELETE` ends, when the sessions are gone too. The test `delete my data works for a user who has cooked` in `src/server/pantry/repo.db.test.ts` passes without any code change.

## Fixed

"Test" means an automated test covers the fix. "Browser" means it's client behaviour that still needs a manual check (see `docs/johnny-handoff.md`).

| Severity | Location | Problem | Coverage |
|---|---|---|---|
| Medium | `src/server/pantry/profile.ts:82` | Deleting a user left `daily_nutrition` rows older than the 30-day refresh window. | Test |
| Medium | `src/features/nutrition/LogFoodDialog.tsx:170` | A failed barcode still in view was looked up in a loop. | Browser |
| Medium | `src/features/scan/AddProductFlow.tsx:75` | The same retry loop after a failed lookup in the add flow. | Browser |
| Medium | `src/features/scan/AddProductFlow.tsx:71` | A slow lookup or label read could replace a half-typed manual form. | Browser |
| Medium | `src/features/nutrition/WeekChart.tsx:20` | No `ResizeObserver` attached after the empty state, clipping the chart on phones. | Browser |
| Medium | `src/features/scan/ExpiryCapture.tsx:100` | Enter in the expiry dialog submitted the outer product form. | Browser |
| Medium | `src/features/scan/ExpiryCapture.tsx:77` | The date read by Gemini had no AI badge. | Browser |
| Medium | `src/server/pantry/validation.ts:17` | Oversized quantities and nutrients overflowed their columns and returned a 500. | Test |
| Medium | `src/features/pantry/PantryList.tsx:261` | Clearing "Now have" and saving emptied the item. | Browser |
| Medium | `src/features/pantry/ProductForm.tsx:117` | Empty items couldn't be edited without inventing stock. | Browser |
| Medium | `src/features/nutrition/amounts.ts:70` | Units were limited by stock conversion even when not deducting from the pantry. | Test |
| Low | `src/features/pantry/PantryList.tsx:220` | Adjust prefilled a stale amount after an edit or restock. | Browser |
| Low | `src/features/pantry/PantryList.tsx:220` | Saving Adjust unchanged wrote the rounded prefill as a new quantity. | Browser |
| Low | `src/features/pantry/PantryList.tsx:160` | Edit prefilled unrounded values, and float noise could add a near-zero `manual_adjust` event. | Test (server side) |
| Low | `src/features/scan/AddProductFlow.tsx:65` | Scanning could stop while the preview stayed live. | Browser |
| Low | `src/features/nutrition/LogFoodDialog.tsx:230` | "Scan another" kept the previous unit, so a serving could log in the wrong unit. | Browser |
| Low | `src/server/nutrition/daily.ts:133` | Barcode logging used a second connection inside a transaction and could hang the pool. | Existing tests |
| Low | `src/server/nutrition/daily.ts:180` | `/today` loaded the same profile three times per render. | Existing tests |
| Low | `src/server/nutrition/daily.ts:113` | `FoodSource` mappings were duplicated between client and server. | Existing tests |
| Low | `src/server/vision/date.ts:80` | A long `rawText` from Gemini blocked saving. | Test |
| Low | `src/server/products/dataandapis.ts:1` | Provider modules lacked `import 'server-only'` (also `openfoodfacts.ts`, `provider.ts`). | Build |
