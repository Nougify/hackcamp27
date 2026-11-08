import { convertBetween, formatQty } from '@/lib/units';
import type { DeductionLine } from '@/contracts/api';
import type { PantryItem, PantryMatch, RecipeIngredient } from '@/contracts/domain';

export interface PlanInput {
  ingredients: RecipeIngredient[];
  matches: PantryMatch[];
  pantryById: Map<string, PantryItem>;
  servingsCooked: number;
  variantServings: number;
}

/**
 * Deduction planner (F14): needBase = qtyBase × servingsCooked / variant.servings,
 * converted to the pantry item's dim, clamped at available quantity.
 */
export function planDeductions(input: PlanInput): DeductionLine[] {
  const { ingredients, matches, pantryById, servingsCooked, variantServings } = input;
  const ratio = servingsCooked / variantServings;
  const matchByIndex = new Map(matches.map((m) => [m.ingredientIndex, m]));

  return ingredients.map((ing, i) => {
    const match = matchByIndex.get(i);
    const base = {
      ingredientRaw: ing.raw,
      pantryItemId: match?.pantryItemId ?? null,
      pantryItemName: match?.pantryItemName ?? null,
      proposedQtyBase: null as number | null,
      availableQtyBase: null as number | null,
      dim: null as DeductionLine['dim'],
    };

    if (ing.isStaple || match?.status === 'staple') {
      return { ...base, display: `${shortName(ing)}: staple, not deducted`, status: 'staple' as const };
    }
    if (!match || match.status === 'missing' || !match.pantryItemId) {
      return { ...base, display: `${shortName(ing)}: no pantry match, not deducted`, status: 'no_match' as const };
    }
    const item = pantryById.get(match.pantryItemId);
    if (!item) {
      return { ...base, display: `${shortName(ing)}: pantry item gone, not deducted`, status: 'no_match' as const };
    }
    if (ing.qtyBase == null || ing.dim == null) {
      return {
        ...base,
        pantryItemId: item.id,
        pantryItemName: item.name,
        availableQtyBase: item.quantityBase,
        dim: item.dim,
        display: `${shortName(ing)}: quantity unknown, adjust manually`,
        status: 'unconvertible' as const,
      };
    }

    const needBase = ing.qtyBase * ratio;
    const needInPantryDim =
      ing.dim === item.dim
        ? needBase
        : convertBetween(needBase, ing.dim, item.dim, {
            gramsPerUnit: item.gramsPerUnit,
            densityGPerMl: item.densityGPerMl,
          });
    if (needInPantryDim == null) {
      return {
        ...base,
        pantryItemId: item.id,
        pantryItemName: item.name,
        availableQtyBase: item.quantityBase,
        dim: item.dim,
        display: `${shortName(ing)}: cannot convert to ${item.displayUnit}, adjust manually`,
        status: 'unconvertible' as const,
      };
    }

    const available = item.quantityBase;
    const proposed = Math.min(needInPantryDim, available);
    const left = available - proposed;
    const status = proposed < needInPantryDim ? 'clamped' : 'ok';
    return {
      ...base,
      pantryItemId: item.id,
      pantryItemName: item.name,
      proposedQtyBase: Math.round(proposed * 1000) / 1000,
      availableQtyBase: available,
      dim: item.dim,
      display:
        `${item.name}: ${formatQty(proposed, item.dim)} of ${formatQty(available, item.dim)} → ` +
        `${formatQty(left, item.dim)} left${status === 'clamped' ? ' (clamped)' : ''}`,
      status,
    };
  });
}

function shortName(ing: RecipeIngredient): string {
  return ing.name ?? ing.normalizedName ?? ing.raw.slice(0, 40);
}
