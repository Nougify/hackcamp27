import type { DisplayUnit, Nutrients, UnitDim } from '@/contracts/domain';
import { DISPLAY_UNITS, convertBetween, toBase, unitDim } from '@/lib/units';

// SPEC F15: turning "170 g of this item" into calories, and into a pantry deduction. Pure, so the
// Log Food preview and the server always agree.

export interface FoodSource {
  basis: '100g' | '100ml' | 'unit';
  nutrition: Nutrients;
  /** What the stock is measured in; null for a product that isn't in the pantry. */
  stockDim: UnitDim | null;
  gramsPerUnit: number | null;
  densityGPerMl: number | null;
}

export interface MealNutrition {
  kcal: number;
  proteinG: number;
  carbsG: number | null;
  fatG: number | null;
}

export type AmountResult = { ok: true; meal: MealNutrition } | { ok: false; reason: 'invalid_amount' | 'no_calories' | 'no_conversion' };

const BASIS: Record<FoodSource['basis'], { dim: UnitDim; per: number }> = {
  '100g': { dim: 'mass', per: 100 },
  '100ml': { dim: 'volume', per: 100 },
  unit: { dim: 'count', per: 1 },
};

const oneDecimal = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

function convert(source: FoodSource, amount: number, unit: DisplayUnit, to: UnitDim): number | null {
  const base = toBase(amount, unit);
  return base ? convertBetween(base.qtyBase, base.dim, to, source) : null;
}

/** The amount in the stock's base unit, or null when it can't be converted. */
export function amountInStock(source: FoodSource, amount: number, unit: DisplayUnit): number | null {
  return source.stockDim ? convert(source, amount, unit, source.stockDim) : null;
}

export function nutritionForAmount(source: FoodSource, amount: number, unit: DisplayUnit): AmountResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid_amount' };
  // Team decision: no calorie data blocks logging, so totals never silently undercount.
  const kcalPer = source.nutrition.energyKcal;
  if (kcalPer == null) return { ok: false, reason: 'no_calories' };
  const { dim, per } = BASIS[source.basis];
  const inBasis = convert(source, amount, unit, dim);
  if (inBasis === null) return { ok: false, reason: 'no_conversion' };
  const factor = inBasis / per;
  const scaled = (v: number | null | undefined) => (v == null ? null : oneDecimal(v * factor));
  return {
    ok: true,
    meal: {
      kcal: oneDecimal(kcalPer * factor),
      proteinG: scaled(source.nutrition.proteinG) ?? 0,
      carbsG: scaled(source.nutrition.carbohydrateG),
      fatG: scaled(source.nutrition.fatG),
    },
  };
}

/** Units this food can be logged in: convertible to its nutrition basis and to its stock. */
export function loggableUnits(source: FoodSource): DisplayUnit[] {
  const basisDim = BASIS[source.basis].dim;
  return DISPLAY_UNITS.filter((u) => {
    const dim = unitDim(u);
    if (convertBetween(1, dim, basisDim, source) === null) return false;
    return source.stockDim === null || convertBetween(1, dim, source.stockDim, source) !== null;
  });
}

export function amountError(reason: Exclude<AmountResult, { ok: true }>['reason']): string {
  if (reason === 'no_calories') return 'This item has no calorie data. Add it on the Pantry page, or use Quick add.';
  if (reason === 'no_conversion') return "We can't convert that unit for this item.";
  return 'Enter an amount greater than 0.';
}
