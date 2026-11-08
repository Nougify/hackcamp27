import type { PantryMatch, RecipeIngredient, RecipeScore } from '@/contracts/domain';

export interface ScorableCandidate {
  ingredients: RecipeIngredient[];
  matches: PantryMatch[];
  proteinPerServingG: number | null;
}

/**
 * Deterministic ranking (§9 F6):
 *   coverage    = matched non-staple / total non-staple (have + insufficient count)
 *   w(d)        = 1 / (1 + max(d, 0))
 *   expiryScore = Σw / (Σw + 1) over matched items
 *   proteinNorm = min(proteinPerServingG / 40, 1) iff high_protein, else 0
 *   score       = 0.5·coverage + 0.35·expiryScore + 0.15·proteinNorm − 0.1·missingCount
 *
 * Note: the SPEC sketches cross-set normalization for expiryScore, but search
 * must stream each candidate with its FINAL score as it finishes (F6 step 8),
 * which a set-dependent normalization forbids. The saturating Σw/(Σw+1) form
 * preserves the ordering intent (more/sooner-expiring matches → higher) while
 * staying per-candidate computable. The SPEC explicitly allows tuning.
 */
export function computeScores(candidates: ScorableCandidate[], opts: { highProtein: boolean }): RecipeScore[] {
  return candidates.map((c) => {
    const sum = expirySum(c.matches);
    const nonStaple = c.ingredients.filter((ing) => !ing.isStaple);
    const nonStapleIdx = new Set(
      c.ingredients.map((ing, idx) => ({ ing, idx })).filter(({ ing }) => !ing.isStaple).map(({ idx }) => idx),
    );
    const relevant = c.matches.filter((m) => nonStapleIdx.has(m.ingredientIndex));
    const matched = relevant.filter((m) => m.status === 'have' || m.status === 'insufficient').length;
    const missingCount = relevant.filter((m) => m.status === 'missing').length;

    const coverage = nonStaple.length === 0 ? 1 : matched / nonStaple.length;
    const expiryScore = sum > 0 ? sum / (sum + 1) : 0;
    const proteinNorm =
      opts.highProtein && c.proteinPerServingG != null ? Math.min(c.proteinPerServingG / 40, 1) : 0;
    const score = 0.5 * coverage + 0.35 * expiryScore + 0.15 * proteinNorm - 0.1 * missingCount;

    return {
      coverage,
      expiryScore,
      missingCount,
      proteinPerServingG: c.proteinPerServingG,
      score: Math.round(score * 1000) / 1000,
    };
  });
}

function expirySum(matches: PantryMatch[]): number {
  let sum = 0;
  for (const m of matches) {
    if ((m.status === 'have' || m.status === 'insufficient') && m.daysToExpiry != null) {
      sum += 1 / (1 + Math.max(m.daysToExpiry, 0));
    }
  }
  return sum;
}
