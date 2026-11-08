import 'server-only';
import { createHash } from 'node:crypto';
import sql from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import type {
  AdaptedRecipe,
  Nutrients,
  NutritionEstimate,
  OriginalRecipe,
  RecipeIngredient,
  RecipeSource,
  RecipeStep,
  Substitution,
} from '@/contracts/domain';
import type { ExtractedRecipe } from './extract';
import { parseTimerSeconds } from './extract';

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

interface RecipeRow {
  id: string;
  source_url: string;
  site_name: string;
  author: string | null;
  title: string;
  extraction_method: RecipeSource['extractionMethod'];
  publisher_nutrition: Nutrients | null;
  total_time_min: number | null;
  retrieved_at: Date;
}

interface VariantRow {
  id: string;
  recipe_id: string;
  parent_variant_id: string | null;
  kind: 'original' | 'ai_adapted';
  servings: string | number;
  ingredients: unknown;
  steps: unknown;
  substitutions: unknown;
  warnings: unknown;
  nutrition_per_serving: unknown;
  model: string | null;
  created_at: Date;
}

function toSource(row: RecipeRow): RecipeSource {
  return {
    url: row.source_url,
    siteName: row.site_name,
    author: row.author,
    retrievedAt: row.retrieved_at.toISOString(),
    extractionMethod: row.extraction_method,
  };
}

function toOriginal(recipeId: string, row: RecipeRow, variant: VariantRow): OriginalRecipe {
  return {
    kind: 'original',
    recipeId,
    variantId: variant.id,
    title: row.title,
    source: toSource(row),
    servings: Number(variant.servings),
    yieldRaw: null,
    ingredients: variant.ingredients as RecipeIngredient[],
    steps: variant.steps as RecipeStep[],
    times: { prepMin: null, cookMin: null, totalMin: row.total_time_min },
    declaredDiet: [],
  };
}

function toAdapted(recipeId: string, variant: VariantRow): AdaptedRecipe {
  return {
    kind: 'ai_adapted',
    label: 'AI-adapted',
    recipeId,
    variantId: variant.id,
    basedOnVariantId: variant.parent_variant_id!,
    substitutions: (variant.substitutions ?? []) as Substitution[],
    ingredients: variant.ingredients as AdaptedRecipe['ingredients'],
    steps: variant.steps as RecipeStep[],
    warnings: (variant.warnings ?? []) as string[],
    model: variant.model ?? 'unknown',
    generatedAt: variant.created_at.toISOString(),
  };
}

export interface PersistedCandidate {
  recipeId: string;
  variantId: string;
}

/**
 * Persists a shown candidate (F6 step 9): upserts `recipes` on
 * (user_id, url_hash) and ensures exactly one immutable `original` variant.
 */
export async function persistOriginal(
  userId: string,
  extracted: ExtractedRecipe,
  ingredients: RecipeIngredient[],
): Promise<PersistedCandidate> {
  const urlHash = sha256Hex(extracted.canonicalUrl);
  const steps: RecipeStep[] = extracted.steps.map((text, index) => ({
    index,
    text,
    timerSeconds: parseTimerSeconds(text),
  }));

  const recipeRows = await sql<RecipeRow[]>`
    INSERT INTO recipes (user_id, url_hash, source_url, site_name, author, title, extraction_method, publisher_nutrition, total_time_min)
    VALUES (
      ${userId}, ${urlHash}, ${extracted.canonicalUrl}, ${extracted.siteName}, ${extracted.author},
      ${extracted.title}, ${extracted.extractionMethod}, ${sql.json(extracted.publisherNutrition ?? null) as never},
      ${extracted.times.totalMin}
    )
    ON CONFLICT (user_id, url_hash) DO UPDATE SET
      title = EXCLUDED.title,
      total_time_min = EXCLUDED.total_time_min,
      retrieved_at = now()
    RETURNING *
  `;
  const recipe = recipeRows[0]!;

  const existing = await sql<VariantRow[]>`
    SELECT * FROM recipe_variants WHERE recipe_id = ${recipe.id} AND kind = 'original' LIMIT 1
  `;
  if (existing[0]) return { recipeId: recipe.id, variantId: existing[0].id };

  const inserted = await sql<VariantRow[]>`
    INSERT INTO recipe_variants (recipe_id, kind, servings, ingredients, steps)
    VALUES (${recipe.id}, 'original', ${extracted.servings}, ${sql.json(ingredients) as never}, ${sql.json(steps) as never})
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  const variant =
    inserted[0] ??
    (await sql<VariantRow[]>`SELECT * FROM recipe_variants WHERE recipe_id = ${recipe.id} AND kind = 'original' LIMIT 1`)[0]!;
  return { recipeId: recipe.id, variantId: variant.id };
}

export interface RecipeDetail {
  recipe: RecipeRow;
  original: OriginalRecipe;
  adaptations: AdaptedRecipe[];
}

/** Loads a recipe + variants scoped to the user. Null → 404 (never 403). */
export async function getRecipeDetail(userId: string, recipeId: string): Promise<RecipeDetail | null> {
  const recipes = await sql<RecipeRow[]>`SELECT * FROM recipes WHERE id = ${recipeId} AND user_id = ${userId} LIMIT 1`;
  const recipe = recipes[0];
  if (!recipe) return null;
  const variants = await sql<VariantRow[]>`
    SELECT * FROM recipe_variants WHERE recipe_id = ${recipeId} ORDER BY created_at DESC
  `;
  const originalRow = variants.find((v) => v.kind === 'original');
  if (!originalRow) return null;
  return {
    recipe,
    original: toOriginal(recipe.id, recipe, originalRow),
    adaptations: variants.filter((v) => v.kind === 'ai_adapted').map((v) => toAdapted(recipe.id, v)),
  };
}

export interface AdaptationInput {
  substitutions: Substitution[];
  ingredients: AdaptedRecipe['ingredients'];
  steps: RecipeStep[];
  warnings: string[];
  nutrition: NutritionEstimate;
  model: string;
}

export async function insertAdaptation(
  userId: string,
  recipeId: string,
  originalVariantId: string,
  input: AdaptationInput,
): Promise<AdaptedRecipe> {
  // Ownership check first (404 on mismatch).
  const detail = await getRecipeDetail(userId, recipeId);
  if (!detail || detail.original.variantId !== originalVariantId) {
    throw new NotFoundError('Recipe not found');
  }
  const original = await sql<VariantRow[]>`SELECT servings FROM recipe_variants WHERE id = ${originalVariantId} LIMIT 1`;
  const rows = await sql<VariantRow[]>`
    INSERT INTO recipe_variants (recipe_id, parent_variant_id, kind, servings, ingredients, steps, substitutions, warnings, nutrition_per_serving, model)
    VALUES (
      ${recipeId}, ${originalVariantId}, 'ai_adapted', ${Number(original[0]?.servings ?? 4)},
      ${sql.json(input.ingredients) as never}, ${sql.json(input.steps) as never},
      ${sql.json(input.substitutions) as never}, ${sql.json(input.warnings) as never},
      ${sql.json(input.nutrition) as never}, ${input.model}
    )
    RETURNING *
  `;
  return toAdapted(recipeId, rows[0]!);
}

/** Finds an adaptation covering the same missing set (newest first). */
export function findMatchingAdaptation(adaptations: AdaptedRecipe[], missingRaws: string[]): AdaptedRecipe | null {
  const want = [...missingRaws].sort();
  for (const a of adaptations) {
    const have = a.substitutions.map((s) => s.missingIngredient).sort();
    if (have.length === want.length && have.every((h, i) => h === want[i])) return a;
  }
  return null;
}

// ── Discovery cache (24 h TTL, enforced here) ───────────────────────────────

export function discoveryCacheKey(parts: { expiring: string[]; diets: string[]; allergens: string[]; freeText?: string }): string {
  const payload = JSON.stringify({
    expiring: [...parts.expiring].sort(),
    diets: [...parts.diets].sort(),
    allergens: [...parts.allergens].sort(),
    freeText: parts.freeText ?? '',
  });
  return sha256Hex(payload);
}

export async function getDiscoveryCache(userId: string, key: string): Promise<string[] | null> {
  const rows = await sql<{ candidates: unknown; created_at: Date }[]>`
    SELECT candidates, created_at FROM recipe_search_cache
    WHERE user_id = ${userId} AND query_key = ${key} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.created_at.getTime() > 24 * 3600 * 1000) return null;
  const urls = (row.candidates as { urls?: unknown })?.urls;
  return Array.isArray(urls) ? urls.filter((u): u is string => typeof u === 'string') : null;
}

export async function setDiscoveryCache(userId: string, key: string, urls: string[]): Promise<void> {
  await sql`
    INSERT INTO recipe_search_cache (user_id, query_key, candidates)
    VALUES (${userId}, ${key}, ${sql.json({ urls }) as never})
    ON CONFLICT (user_id, query_key) DO UPDATE SET candidates = EXCLUDED.candidates, created_at = now()
  `;
}
