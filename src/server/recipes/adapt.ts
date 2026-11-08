import 'server-only';
import { geminiJson } from '@/lib/gemini/client';
import { ADAPT_SYSTEM_PROMPT, adaptationJsonSchema, adaptationSchema, type AdaptationOutput } from '@/lib/gemini/schemas';
import { UnprocessableError } from '@/lib/errors';
import { checkDiet } from '@/server/diet/check';
import type {
  AdaptedRecipe,
  Allergen,
  DietFlag,
  OriginalRecipe,
  PantryItem,
  RecipeIngredient,
  RecipeStep,
  Substitution,
} from '@/contracts/domain';
import { parseIngredientLine } from './parse';
import { parseTimerSeconds } from './extract';

export interface AdaptValidationContext {
  missingRaws: string[];
  pantryById: Map<string, PantryItem>;
  stepCount: number;
  diets: DietFlag[];
  allergens: Allergen[];
}

export interface AdaptValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Server-side validation of the model's adaptation (F9 step 3):
 * pantry IDs must exist, missing lines must match unmatched originals,
 * substitutes must pass checkDiet (plus the substitute pantry item's
 * allergen tags), step indexes must be in range.
 */
export function validateAdaptation(output: AdaptationOutput, ctx: AdaptValidationContext): AdaptValidation {
  const errors: string[] = [];
  const missingSet = new Set(ctx.missingRaws);

  for (const sub of output.substitutions) {
    if (!missingSet.has(sub.missingIngredient)) {
      errors.push(`missingIngredient does not match an unmatched line: "${sub.missingIngredient.slice(0, 80)}"`);
    }
    if (sub.pantryItemId != null && !ctx.pantryById.has(sub.pantryItemId)) {
      errors.push(`unknown pantryItemId: ${sub.pantryItemId}`);
    }
    if (sub.substitute) {
      const check = checkDiet([sub.substitute], { diets: ctx.diets, allergens: ctx.allergens });
      if (!check.ok) {
        errors.push(`substitute violates ${check.violations[0]!.rule}: "${sub.substitute.slice(0, 80)}"`);
      }
    }
    if (sub.pantryItemId) {
      const item = ctx.pantryById.get(sub.pantryItemId);
      if (item) {
        const clash = item.allergenTags.filter((t) => ctx.allergens.includes(t));
        if (clash.length > 0) {
          errors.push(`substitute pantry item carries allergen(s): ${clash.join(', ')}`);
        }
      }
    }
  }

  for (const change of output.stepChanges) {
    if (change.stepIndex < 0 || change.stepIndex >= ctx.stepCount) {
      errors.push(`stepIndex out of range: ${change.stepIndex}`);
    }
  }

  // The model can slip an allergen into the cooked ingredient list or a rewritten step
  // while keeping the substitution text clean, so check everything it changed.
  const changedTexts = [
    ...output.ingredients.filter((i) => i.changed).map((i) => i.text),
    ...output.stepChanges.map((c) => c.newText),
  ];
  const changedCheck = checkDiet(changedTexts, { diets: ctx.diets, allergens: ctx.allergens });
  for (const v of changedCheck.violations) {
    errors.push(`changed text violates ${v.rule}: "${v.ingredientRaw.slice(0, 80)}"`);
  }

  return { ok: errors.length === 0, errors };
}

/** True if a stored adaptation still fits the user's current diets/allergens (they may have changed since). */
export function adaptationStillAllowed(a: Pick<AdaptedRecipe, 'ingredients' | 'substitutions' | 'steps'>, filters: { diets: DietFlag[]; allergens: Allergen[] }): boolean {
  const texts = [
    ...a.ingredients.filter((i) => i.changed).map((i) => i.text),
    ...a.substitutions.map((s) => s.substitute).filter((s): s is string => !!s),
    ...a.steps.filter((s) => s.changed).map((s) => s.text),
  ];
  return checkDiet(texts, filters).ok;
}

export function buildAdaptPrompt(
  original: OriginalRecipe,
  missingRaws: string[],
  pantry: PantryItem[],
  filters: { diets: DietFlag[]; allergens: Allergen[] },
): string {
  const compact = pantry
    .map((p) => `- ${p.id} | ${p.name} | ${p.quantityDisplay} | expires in ${p.daysToExpiry ?? '?'}d`)
    .join('\n');
  return [
    `Original recipe: "${original.title}" (${original.servings} servings).`,
    'Ingredients:',
    ...original.ingredients.map((ing, i) => `${i + 1}. ${ing.raw}`),
    'Steps:',
    ...original.steps.map((s) => `${s.index + 1}. ${s.text}`),
    `Missing ingredients to replace: ${missingRaws.map((r) => `"${r}"`).join(', ')}.`,
    `User pantry (id | name | qty | expiry):\n${compact}`,
    `Filters — diets: ${filters.diets.join(', ') || 'none'}; allergens to exclude: ${filters.allergens.join(', ') || 'none'}.`,
    'Propose one substitution per missing ingredient (or omit it), the full updated ingredient list, step changes, and warnings.',
  ].join('\n');
}

export interface BuiltAdaptation {
  substitutions: Substitution[];
  ingredients: AdaptedRecipe['ingredients'];
  steps: RecipeStep[];
  warnings: string[];
  model: string;
}

/** Builds the adapted variant content. The original is never modified. */
export function buildAdaptedRecipe(original: OriginalRecipe, output: AdaptationOutput, model: string): BuiltAdaptation {
  const changedSteps = new Map(output.stepChanges.map((c) => [c.stepIndex, c.newText]));
  const steps: RecipeStep[] = original.steps.map((s) => {
    const replacement = changedSteps.get(s.index);
    if (replacement == null) return { ...s, changed: false };
    return { index: s.index, text: replacement, timerSeconds: parseTimerSeconds(replacement), changed: true };
  });

  const substitutions: Substitution[] = output.substitutions.map((s) => ({
    missingIngredient: s.missingIngredient,
    substitute: s.substitute,
    pantryItemId: s.pantryItemId,
    quantity: s.quantity ?? null,
    reason: s.reason,
    impact: s.impact,
  }));

  const parsedByText = new Map<string, RecipeIngredient>();
  const ingredients = output.ingredients.map((item) => {
    let parsed = parsedByText.get(item.text);
    if (!parsed) {
      parsed = parseIngredientLine(item.text);
      parsedByText.set(item.text, parsed);
    }
    return { text: item.text, changed: item.changed, parsed };
  });

  return { substitutions, ingredients, steps, warnings: output.warnings, model };
}

export interface AdaptationDeps {
  generate?: (prompt: string) => Promise<{ data: AdaptationOutput; model: string }>;
}

/**
 * Requests an adaptation with validation + retry-once-then-422 (F9 steps 2–3).
 */
export async function requestAdaptation(
  original: OriginalRecipe,
  missingRaws: string[],
  pantry: PantryItem[],
  filters: { diets: DietFlag[]; allergens: Allergen[] },
  deps: AdaptationDeps = {},
): Promise<BuiltAdaptation> {
  const generate =
    deps.generate ??
    ((prompt: string) =>
      geminiJson({ system: ADAPT_SYSTEM_PROMPT, text: prompt, jsonSchema: adaptationJsonSchema, zod: adaptationSchema }));
  const prompt = buildAdaptPrompt(original, missingRaws, pantry, filters);
  const ctx: AdaptValidationContext = {
    missingRaws,
    pantryById: new Map(pantry.map((p) => [p.id, p])),
    stepCount: original.steps.length,
    diets: filters.diets,
    allergens: filters.allergens,
  };

  const errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, model } = await generate(prompt);
    const validation = validateAdaptation(data, ctx);
    if (validation.ok) return buildAdaptedRecipe(original, data, model);
    errors.push(...validation.errors);
  }
  throw new UnprocessableError("Couldn't find a safe substitution", errors);
}
