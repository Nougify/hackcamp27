import type { Allergen } from '@/contracts/domain';
import { ALLERGEN_KEYWORDS, checkDiet } from '@/server/diet/check';

// Pantry allergen tags (team decision 2026-11-08): the provider's or user's tags UNION whatever
// Hang's keyword map (server/diet/check.ts, read-only) finds in the item's name. Over-tagging only
// makes AI substitutions stricter, which is the safe direction.

export const ALL_ALLERGENS = Object.keys(ALLERGEN_KEYWORDS) as Allergen[];

export function isAllergen(x: unknown): x is Allergen {
  return typeof x === 'string' && Object.hasOwn(ALLERGEN_KEYWORDS, x);
}

/** Allergens whose keywords appear in any of `texts` (e.g. name and brand). */
export function detectAllergens(texts: Array<string | null | undefined>): Allergen[] {
  const lines = texts.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  if (lines.length === 0) return [];
  const found = new Set<Allergen>();
  for (const v of checkDiet(lines, { diets: [], allergens: ALL_ALLERGENS }).violations) {
    if (isAllergen(v.rule)) found.add(v.rule);
  }
  return ALL_ALLERGENS.filter((a) => found.has(a));
}

/** Union of given tags and name-detected tags, deduplicated, in enum order. */
export function pantryAllergenTags(given: readonly Allergen[] | null | undefined, name: string): Allergen[] {
  const set = new Set<Allergen>([...(given ?? []).filter(isAllergen), ...detectAllergens([name])]);
  return ALL_ALLERGENS.filter((a) => set.has(a));
}
