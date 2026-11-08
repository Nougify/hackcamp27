import 'server-only';
import sql from '@/lib/db';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { formatQty } from '@/lib/units';
import { estimateRecipeNutrition, suggestLogPerServing } from '@/server/nutrition/recipe';
import { matchIngredients } from '@/server/recipes/match';
import { listPantryByIds, listPantryForMatching } from '@/server/recipes/pantry-view';
import { planDeductions } from './plan';
import type { CookSessionView, FinishPreview } from '@/contracts/api';
import type {
  CookingSession,
  Nutrients,
  RecipeIngredient,
  RecipeStep,
  Substitution,
} from '@/contracts/domain';

interface SessionRow {
  id: string;
  recipe_variant_id: string;
  status: CookingSession['status'];
  current_step: number;
  servings_planned: string | number;
  servings_cooked: string | number | null;
  servings_eaten: string | number | null;
  started_at: Date;
  finished_at: Date | null;
}

interface VariantRow {
  id: string;
  recipe_id: string;
  kind: 'original' | 'ai_adapted';
  servings: string | number;
  ingredients: unknown;
  steps: unknown;
  substitutions: unknown;
}

interface RecipeRow {
  id: string;
  title: string;
  source_url: string;
  site_name: string;
  author: string | null;
  extraction_method: 'jsonld' | 'microdata' | 'site-scraper' | 'llm';
  publisher_nutrition: Nutrients | null;
  retrieved_at: Date;
}

function toCookingSession(recipeId: string, variantKind: 'original' | 'ai_adapted', row: SessionRow): CookingSession {
  return {
    id: row.id,
    recipeId,
    variantId: row.recipe_variant_id,
    variantKind,
    status: row.status,
    currentStep: row.current_step,
    servingsPlanned: Number(row.servings_planned),
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

async function loadSessionBundle(userId: string, sessionId: string) {
  const sessions = await sql<SessionRow[]>`
    SELECT id, recipe_variant_id, status, current_step, servings_planned, servings_cooked, servings_eaten, started_at, finished_at
    FROM cooking_sessions WHERE id = ${sessionId} AND user_id = ${userId} LIMIT 1
  `;
  const session = sessions[0];
  if (!session) return null;
  const variants = await sql<VariantRow[]>`
    SELECT id, recipe_id, kind, servings, ingredients, steps, substitutions
    FROM recipe_variants WHERE id = ${session.recipe_variant_id} LIMIT 1
  `;
  const variant = variants[0];
  if (!variant) return null;
  const recipes = await sql<RecipeRow[]>`
    SELECT id, title, source_url, site_name, author, extraction_method, publisher_nutrition, retrieved_at
    FROM recipes WHERE id = ${variant.recipe_id} AND user_id = ${userId} LIMIT 1
  `;
  const recipe = recipes[0];
  if (!recipe) return null;
  return { session, variant, recipe };
}

export async function createSession(
  userId: string,
  input: { recipeId: string; variantId: string; servingsPlanned: number },
): Promise<CookingSession> {
  const variants = await sql<VariantRow[]>`
    SELECT v.id, v.recipe_id, v.kind, v.servings, v.ingredients, v.steps, v.substitutions
    FROM recipe_variants v JOIN recipes r ON r.id = v.recipe_id
    WHERE v.id = ${input.variantId} AND v.recipe_id = ${input.recipeId} AND r.user_id = ${userId} LIMIT 1
  `;
  const variant = variants[0];
  if (!variant) throw new NotFoundError('Recipe variant not found');
  const rows = await sql<SessionRow[]>`
    INSERT INTO cooking_sessions (user_id, recipe_variant_id, servings_planned)
    VALUES (${userId}, ${input.variantId}, ${input.servingsPlanned})
    RETURNING id, recipe_variant_id, status, current_step, servings_planned, servings_cooked, servings_eaten, started_at, finished_at
  `;
  return toCookingSession(variant.recipe_id, variant.kind, rows[0]!);
}

function variantIngredients(variant: VariantRow): Array<{ text: string; changed: boolean; parsed: RecipeIngredient }> {
  if (variant.kind === 'original') {
    return ((variant.ingredients as RecipeIngredient[]) ?? []).map((parsed) => ({
      text: parsed.raw,
      changed: false,
      parsed,
    }));
  }
  return ((variant.ingredients as Array<{ text: string; changed: boolean; parsed: RecipeIngredient }>) ?? []).map(
    (i) => ({ text: i.text, changed: i.changed, parsed: i.parsed }),
  );
}

function usedInSteps(name: string | null, steps: RecipeStep[]): number[] {
  if (!name) return [];
  const tokens = name.toLowerCase().split(/[\s-]+/).filter((t) => t.length > 3);
  if (tokens.length === 0) return [];
  const out: number[] = [];
  steps.forEach((s, i) => {
    const lower = s.text.toLowerCase();
    if (tokens.some((t) => lower.includes(t))) out.push(i);
  });
  return out;
}

export async function getSessionView(userId: string, sessionId: string): Promise<CookSessionView | null> {
  const bundle = await loadSessionBundle(userId, sessionId);
  if (!bundle) return null;
  const { session, variant, recipe } = bundle;
  const variantServings = Number(variant.servings);
  const ratio = Number(session.servings_planned) / variantServings;
  const steps = (variant.steps as RecipeStep[]) ?? [];
  const ingredients = variantIngredients(variant).map((ing) => {
    const scaled = ing.parsed.qtyBase != null && ing.parsed.dim != null ? ing.parsed.qtyBase * ratio : null;
    return {
      text: ing.text,
      changed: ing.changed,
      scaledQtyDisplay:
        scaled != null && ing.parsed.dim ? formatQty(scaled, ing.parsed.dim, ing.parsed.unit ?? undefined) : null,
      usedInSteps: usedInSteps(ing.parsed.normalizedName ?? ing.parsed.name, steps),
    };
  });
  return {
    session: toCookingSession(recipe.id, variant.kind, session),
    recipe: {
      title: recipe.title,
      source: {
        url: recipe.source_url,
        siteName: recipe.site_name,
        author: recipe.author,
        retrievedAt: recipe.retrieved_at.toISOString(),
        extractionMethod: recipe.extraction_method,
      },
      servings: variantServings,
      isAdapted: variant.kind === 'ai_adapted',
    },
    ingredients,
    steps,
    substitutions: variant.kind === 'ai_adapted' ? ((variant.substitutions as Substitution[]) ?? []) : [],
  };
}

export async function updateSession(
  userId: string,
  sessionId: string,
  input: { currentStep?: number; status?: 'abandoned' },
): Promise<CookingSession> {
  const bundle = await loadSessionBundle(userId, sessionId);
  if (!bundle) throw new NotFoundError('Cooking session not found');
  if (bundle.session.status !== 'in_progress') throw new ConflictError('Session is no longer in progress');
  const steps = (bundle.variant.steps as RecipeStep[]) ?? [];
  if (input.currentStep != null && (input.currentStep < 0 || input.currentStep >= steps.length)) {
    throw new ConflictError(`Step out of range (0–${steps.length - 1})`);
  }
  const rows = await sql<SessionRow[]>`
    UPDATE cooking_sessions
    SET current_step = COALESCE(${input.currentStep ?? null}, current_step),
        status = COALESCE(${input.status ?? null}, status)
    WHERE id = ${sessionId} AND user_id = ${userId} AND status = 'in_progress'
    RETURNING id, recipe_variant_id, status, current_step, servings_planned, servings_cooked, servings_eaten, started_at, finished_at
  `;
  const updated = rows[0];
  if (!updated) throw new ConflictError('Session is no longer in progress');
  return toCookingSession(bundle.recipe.id, bundle.variant.kind, updated);
}

export async function getFinishPreview(
  userId: string,
  tz: string,
  sessionId: string,
  servingsCooked: number,
): Promise<FinishPreview> {
  const bundle = await loadSessionBundle(userId, sessionId);
  if (!bundle) throw new NotFoundError('Cooking session not found');
  if (bundle.session.status !== 'in_progress') throw new ConflictError('Session is no longer in progress');

  const pantry = await listPantryForMatching(userId, tz, new Date(), 200);
  const pantryById = new Map(pantry.map((p) => [p.id, p]));
  const parsed = variantIngredients(bundle.variant).map((i) => i.parsed);
  const matches = matchIngredients(parsed, pantry);
  const variantServings = Number(bundle.variant.servings);
  const deductions = planDeductions({ ingredients: parsed, matches, pantryById, servingsCooked, variantServings });
  const nutritionPerServing = estimateRecipeNutrition({
    ingredients: parsed,
    matches,
    pantryById,
    servings: variantServings,
  });
  const publisherPerServing = bundle.recipe.publisher_nutrition;
  return {
    deductions,
    nutritionPerServing,
    publisherPerServing,
    suggestedLogPerServing: suggestLogPerServing(nutritionPerServing, publisherPerServing),
    defaultServingsEaten: 1,
  };
}

export { listPantryByIds };
