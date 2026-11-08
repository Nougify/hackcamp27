export type UUID = string;
export type ISODate = string;       // 'YYYY-MM-DD'
export type ISODateTime = string;   // RFC 3339

export type UnitDim = 'mass' | 'volume' | 'count';
export type DisplayUnit = 'g' | 'kg' | 'oz' | 'lb' | 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'fl_oz' | 'pcs';
export type ProductSource = 'dataandapis' | 'openfoodfacts' | 'gemini_photo' | 'manual';

export type DietFlag = 'vegetarian' | 'vegan' | 'gluten_free' | 'dairy_free' | 'high_protein';
// Product decision; aligned with Canada's priority allergens [VERIFY list against Health Canada]
export type Allergen =
  | 'peanut' | 'tree_nut' | 'sesame' | 'milk' | 'egg' | 'fish'
  | 'shellfish' | 'soy' | 'wheat_gluten' | 'mustard' | 'sulphite';

export interface Nutrients {          // all nullable; units fixed by name
  energyKcal: number | null;
  proteinG: number | null;
  carbohydrateG: number | null;       // TOTAL carbs incl. fibre (CA/US label convention)
  fatG: number | null;
  saturatedFatG?: number | null;
  sugarsG?: number | null;
  fibreG?: number | null;
  sodiumMg?: number | null;
}

export interface UserProfile {
  id: UUID;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  tz: string;                         // IANA
  dailyKcalGoal: number | null;
  dailyProteinGoalG: number | null;
  diets: DietFlag[];
  allergens: Allergen[];
  onboarded: boolean;
  /** 0–14. Items up to this many days past their best-before date still count as usable
   *  (Expiring soon, pantry colouring, recipe matching). Absent = 0. */
  pastBestBeforeGraceDays?: number;
}

export interface Product {
  gtin: string;                       // canonical GTIN-13/14
  name: string;
  brand: string | null;
  imageUrl: string | null;
  categories: string[];
  allergenTags: Allergen[];
  packageQuantity: { value: number; unit: 'g' | 'ml' | 'count'; text: string | null } | null;
  servingSize: { value: number; unit: 'g' | 'ml'; text: string | null } | null;
  basis: '100g' | '100ml';
  per100: Nutrients;
  perServing: Nutrients | null;
  source: Exclude<ProductSource, 'gemini_photo' | 'manual'>;
  attribution: string | null;         // e.g. 'Open Food Facts, ODbL'
  fetchedAt: ISODateTime;
}

/** Form model shared by label-photo extraction and the manual product form. */
export interface ProductDraft {
  gtin: string | null;
  name: string;
  brand: string | null;
  packageQuantity: { value: number; unit: DisplayUnit } | null;
  servingSize: { value: number; unit: 'g' | 'ml'; text: string | null } | null;
  basis: '100g' | '100ml' | 'serving' | 'unit';
  nutrients: Nutrients;               // expressed in `basis`
  allergenTags: Allergen[];
  source: 'gemini_photo' | 'manual';
}

export interface PantryItem {
  id: UUID;
  gtin: string | null;
  name: string;
  normalizedName: string;
  brand: string | null;
  dim: UnitDim;
  quantityBase: number;
  displayUnit: DisplayUnit;
  quantityDisplay: string;            // formatted, e.g. '350 g'
  gramsPerUnit: number | null;
  densityGPerMl: number | null;
  expiryDate: ISODate | null;
  expirySource: 'photo' | 'manual' | null;
  daysToExpiry: number | null;        // computed in user's tz; negative = past date
  nutritionBasis: '100g' | '100ml' | 'unit';
  nutrition: Nutrients;               // per basis
  perServing: Nutrients | null;
  servingSizeBase: number | null;
  allergenTags: Allergen[];
  source: ProductSource;
  userVerified: boolean;
  updatedAt: ISODateTime;
}

export interface RecipeSource {
  url: string;                        // final canonical URL (never a vertexaisearch redirect)
  siteName: string;
  author: string | null;
  retrievedAt: ISODateTime;
  extractionMethod: 'jsonld' | 'microdata' | 'site-scraper' | 'llm'; // 'llm' → UI shows "may not be verbatim"
}

export interface RecipeIngredient {
  raw: string;                        // EXACT published text — display this
  qty: number | null;                 // parsed (for matching/nutrition/deduction only)
  unit: DisplayUnit | null;
  name: string | null;
  normalizedName: string | null;
  dim: UnitDim | null;
  qtyBase: number | null;             // for recipe's own servings
  isStaple: boolean;                  // salt, pepper, water, oil → always 'have'
  flags: Array<'unconvertible' | 'negligible' | 'parse_failed'>;
}

export interface RecipeStep {
  index: number;                      // 0-based
  text: string;                       // published text (original) or adapted text
  timerSeconds: number | null;        // parsed from text; null = no explicit duration
  changed?: boolean;                  // true only in AI-adapted variants
}

export interface OriginalRecipe {
  kind: 'original';
  recipeId: UUID;
  variantId: UUID;
  title: string;
  source: RecipeSource;
  servings: number;                   // from recipeYield; default 4 if unparseable (flagged)
  yieldRaw: string | null;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  times: { prepMin: number | null; cookMin: number | null; totalMin: number | null };
  declaredDiet: string[];             // schema.org suitableForDiet — informational ONLY
}

export interface Substitution {
  missingIngredient: string;          // as written in the original
  substitute: string | null;          // null = omit
  pantryItemId: UUID | null;          // must exist in the user's pantry when not null
  quantity: string | null;
  reason: string;
  impact: 'minimal' | 'moderate' | 'significant';
}

export interface AdaptedRecipe {
  kind: 'ai_adapted';
  label: 'AI-adapted';
  recipeId: UUID;
  variantId: UUID;
  basedOnVariantId: UUID;             // the original's variantId
  substitutions: Substitution[];
  ingredients: Array<{ text: string; changed: boolean; parsed: RecipeIngredient }>;
  steps: RecipeStep[];                // full step list; changed steps have changed=true
  warnings: string[];
  model: string;
  generatedAt: ISODateTime;
}

export type MatchStatus = 'have' | 'missing' | 'staple' | 'insufficient';
export interface PantryMatch {
  ingredientIndex: number;
  status: MatchStatus;
  pantryItemId: UUID | null;
  pantryItemName: string | null;
  daysToExpiry: number | null;
}

export interface DietCheck {
  ok: boolean;
  violations: Array<{ ingredientRaw: string; rule: DietFlag | Allergen; matchedKeyword: string }>;
}

export interface NutritionEstimate {
  perServing: Nutrients;
  coveragePct: number;                // 0–100: share of non-staple ingredients with usable data
  basedOn: number;
  total: number;
  estimatedFields: string[];          // e.g. ['ingredient 3: density assumed 1.0 g/ml']
}

export interface RecipeScore {
  coverage: number;                   // 0–1
  expiryScore: number;                // normalized 0–1
  missingCount: number;
  proteinPerServingG: number | null;
  score: number;
}

export interface RecipeCandidate {
  recipeId: UUID;
  title: string;
  source: RecipeSource;
  totalMin: number | null;
  servings: number;
  score: RecipeScore;
  usesExpiring: Array<{ pantryItemId: UUID; name: string; daysToExpiry: number }>;
  matches: PantryMatch[];
  nutrition: NutritionEstimate;
}

export type CookingStatus = 'in_progress' | 'finished' | 'abandoned';
export interface CookingSession {
  id: UUID;
  recipeId: UUID;
  variantId: UUID;
  variantKind: 'original' | 'ai_adapted';
  status: CookingStatus;
  currentStep: number;
  servingsPlanned: number;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
}

export interface StepTimer {
  id: string;
  label: string;                      // 'Step 4 · Simmer sauce'
  stepIndex: number;
  kind: 'countdown' | 'stopwatch';
  durationMs: number | null;          // countdown only
  endsAt: number | null;              // epoch ms while running (countdown)
  startedAt: number | null;           // epoch ms while running (stopwatch)
  pausedRemainingMs: number | null;   // countdown paused
  pausedElapsedMs: number | null;     // stopwatch paused
  status: 'idle' | 'running' | 'paused' | 'done';
}

export interface MealLog {
  id: UUID;
  eatenAt: ISODateTime;
  localDate: ISODate;
  source: 'cooking_session' | 'manual' | 'pantry_item' | 'barcode';
  label: string;
  servings: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number | null;
  fatG: number | null;
  cookingSessionId: UUID | null;
  pantryItemId: UUID | null;
}

export interface DailyTotals {
  date: ISODate;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  entries: number;
  kcalGoal: number | null;
  proteinGoalG: number | null;
}
