import type * as D from './domain';

export type ApiErrorCode =
  | 'UNAUTHORIZED' | 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE' | 'UNPROCESSABLE' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL';
export interface ApiError { error: { code: ApiErrorCode; message: string; details?: unknown } }

// ── Profile ────────────────────────────────────────────────────────────────
// GET  /api/me                → D.UserProfile
// PATCH /api/me               → D.UserProfile
export interface UpdateMeRequest {
  displayName?: string;
  tz?: string;
  dailyKcalGoal?: number | null;
  dailyProteinGoalG?: number | null;
  diets?: D.DietFlag[];
  allergens?: D.Allergen[];
  completeOnboarding?: boolean;
}

// ── Products ───────────────────────────────────────────────────────────────
// POST /api/products/lookup
export interface ProductLookupRequest { barcode: string }          // digits only, 8–14
export interface ProviderAttempt {
  provider: 'cache' | 'dataandapis' | 'openfoodfacts';
  result: 'hit' | 'miss' | 'error' | 'skipped';
  httpStatus?: number;
  ms: number;
}
export type ProductLookupResponse =
  | { status: 'found'; product: D.Product; cached: boolean; attempts: ProviderAttempt[] }
  | { status: 'not_found'; gtin: string; attempts: ProviderAttempt[] }
  | { status: 'invalid_barcode'; reason: 'length' | 'check_digit' | 'non_numeric' };

// POST /api/vision/label   multipart/form-data: images (1–3 files, each ≤ 4 MB, jpeg/png/webp/heic), gtin?
export interface LabelExtractionResponse {
  isFoodProduct: boolean;
  draft: D.ProductDraft;                      // source = 'gemini_photo'
  flaggedFields: Array<keyof D.Nutrients | 'servingSize' | 'packageQuantity' | 'name'>;
  macrosConsistent: boolean | null;           // 4p + 4c + 9f ≈ kcal within ±20%
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  model: string;
}

// POST /api/vision/expiry  multipart/form-data: image (1 file ≤ 4 MB)
export interface ExpiryExtractionResponse {
  rawText: string | null;
  dateType: 'best_before' | 'expiry' | 'use_by' | 'packaged_on' | 'sell_by' | 'unknown';
  suggestedDate: D.ISODate | null;            // null if packaged_on or unreadable
  candidates: D.ISODate[];                    // >1 when order is ambiguous
  needsUserChoice: boolean;
  yearInferred: boolean;
  regexCrossCheck: 'agree' | 'disagree' | 'no_match';
  confidence: 'high' | 'medium' | 'low';
}

// ── Pantry ─────────────────────────────────────────────────────────────────
// GET /api/pantry?sort=expiry|name&includeEmpty=false   → ListPantryResponse
export interface ListPantryResponse { items: D.PantryItem[] }
// POST /api/pantry                                      → D.PantryItem
export interface CreatePantryItemRequest {
  gtin?: string | null;
  name: string;
  brand?: string | null;
  quantity: number;                           // in displayUnit
  displayUnit: D.DisplayUnit;
  gramsPerUnit?: number | null;
  densityGPerMl?: number | null;
  expiryDate?: D.ISODate | null;
  expirySource?: 'photo' | 'manual' | null;
  expiryRawText?: string | null;
  nutritionBasis: '100g' | '100ml' | 'unit';
  nutrition?: D.Nutrients | null;             // per basis
  servingSizeBase?: number | null;
  allergenTags?: D.Allergen[];
  source: D.ProductSource;
  userVerified: boolean;
}
// PATCH /api/pantry/:id                                 → D.PantryItem
export type UpdatePantryItemRequest =
  Partial<Omit<CreatePantryItemRequest, 'source' | 'gtin'>> & { adjustReason?: 'manual_adjust' | 'discard' };
// DELETE /api/pantry/:id                                → { ok: true }

// ── Recipes ────────────────────────────────────────────────────────────────
// POST /api/recipes/search   → application/x-ndjson stream of RecipeSearchEvent (one JSON per line)
export interface RecipeSearchRequest {
  mustUsePantryItemIds?: D.UUID[];            // default: items with daysToExpiry ≤ 3
  freeText?: string;                          // e.g. 'quick dinner', ≤ 100 chars
  maxResults?: number;                        // default 6, max 10
  extraDiets?: D.DietFlag[];                  // may only ADD to profile filters, never remove
}
export type RecipeSearchEvent =
  | { type: 'status'; stage: 'searching' | 'resolving' | 'fetching' | 'parsing' | 'checking_diet' | 'ranking'; message: string }
  | { type: 'search_suggestions'; html: string }      // Gemini searchEntryPoint.renderedContent, render unmodified
  | { type: 'candidate'; candidate: D.RecipeCandidate }
  | { type: 'excluded'; url: string; reason: 'no_recipe_markup' | 'fetch_failed' | 'diet_violation' | 'allergen' | 'duplicate' | 'blocked_url'; detail?: string }
  | { type: 'done'; total: number; excludedCount: number; cached: boolean }
  | { type: 'error'; error: ApiError['error'] };

// GET /api/recipes/:id                                  → RecipeDetailResponse
export interface RecipeDetailResponse {
  original: D.OriginalRecipe;
  adaptations: D.AdaptedRecipe[];             // newest first; usually 0 or 1
  matches: D.PantryMatch[];
  score: D.RecipeScore;
  dietCheck: D.DietCheck;
  nutrition: { estimate: D.NutritionEstimate; publisher: D.Nutrients | null };
  adaptationNutrition: Record<D.UUID, D.NutritionEstimate>;   // keyed by adapted variantId
}
// POST /api/recipes/:id/adapt   body: {}                → AdaptResponse
//   409 CONFLICT  if no missing ingredients
//   422 UNPROCESSABLE if validation fails twice (allergen in substitute, unknown pantryItemId, …)
export interface AdaptResponse { adaptation: D.AdaptedRecipe; nutrition: D.NutritionEstimate }

// ── Cooking ────────────────────────────────────────────────────────────────
// POST /api/cook/sessions                               → D.CookingSession
export interface StartSessionRequest { recipeId: D.UUID; variantId: D.UUID; servingsPlanned: number }
// GET /api/cook/sessions/:id                            → CookSessionView
export interface CookSessionView {
  session: D.CookingSession;
  recipe: { title: string; source: D.RecipeSource; servings: number; isAdapted: boolean };
  ingredients: Array<{ text: string; changed: boolean; scaledQtyDisplay: string | null; usedInSteps: number[] }>;
  steps: D.RecipeStep[];
  substitutions: D.Substitution[];            // empty for originals
}
// PATCH /api/cook/sessions/:id                          → D.CookingSession
export interface UpdateSessionRequest { currentStep?: number; status?: 'abandoned' }
// GET /api/cook/sessions/:id/finish-preview?servingsCooked=4   → FinishPreview
export interface DeductionLine {
  ingredientRaw: string;
  pantryItemId: D.UUID | null;
  pantryItemName: string | null;
  proposedQtyBase: number | null;             // scaled by servingsCooked / variant.servings
  availableQtyBase: number | null;
  dim: D.UnitDim | null;                      // the PANTRY item's dim (unit of availableQtyBase and of what /finish deducts), also on 'unconvertible' lines
  display: string;                            // 'Spinach: 150 g of 200 g → 50 g left'
  status: 'ok' | 'clamped' | 'unconvertible' | 'no_match' | 'staple';
}
export interface FinishPreview {
  deductions: DeductionLine[];
  nutritionPerServing: D.NutritionEstimate;
  publisherPerServing: D.Nutrients | null;
  suggestedLogPerServing: { kcal: number; proteinG: number; basis: 'estimate' | 'publisher' | 'low_coverage_estimate' };
  defaultServingsEaten: number;               // 1
}
// POST /api/cook/sessions/:id/finish                    → FinishResult
//   409 CONFLICT if session not in_progress (idempotency guard)
export interface FinishRequest {
  servingsCooked: number;                     // > 0, drives deduction
  servingsEaten: number;                      // ≥ 0, drives meal log (0 → no log)
  deductions: Array<{ pantryItemId: D.UUID; qtyBase: number }>;   // user-confirmed lines only
  perServingOverride?: { kcal: number; proteinG: number };
}
export interface FinishResult {
  session: D.CookingSession;
  pantryUpdates: Array<{ pantryItemId: D.UUID; name: string; beforeBase: number; afterBase: number }>;
  mealLog: D.MealLog | null;
}

// ── Voice ──────────────────────────────────────────────────────────────────
// POST /api/tts   body: TtsRequest   → 200 audio/mpeg (streamed) | ApiError (client falls back)
export interface TtsRequest { text: string /* 1–2000 chars, already speech-normalized */ }

// ── Nutrition & meals ──────────────────────────────────────────────────────
// GET /api/nutrition/today                 → D.DailyTotals          (from meal_logs by local_date)
// GET /api/nutrition/history?days=7        → { days: D.DailyTotals[] }   (from daily_nutrition cagg; days ≤ 30)
// GET /api/meals?date=YYYY-MM-DD           → { meals: D.MealLog[] }
// POST /api/meals                          → D.MealLog
export type ManualMealRequest =
  | { kind: 'quick_add'; label: string; kcal: number; proteinG: number; carbsG?: number; fatG?: number; eatenAt?: D.ISODateTime }
  | { kind: 'pantry_item'; pantryItemId: D.UUID; amount: number; unit: D.DisplayUnit; deductFromPantry: boolean; eatenAt?: D.ISODateTime }
  | { kind: 'barcode'; gtin: string; amount: number; unit: D.DisplayUnit; eatenAt?: D.ISODateTime };
// DELETE /api/meals/:id?eatenAt=<ISO>      → { ok: true }   (composite PK needs eatenAt)
