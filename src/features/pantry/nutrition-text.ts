import type { Nutrients, PantryItem } from '@/contracts/domain';

// F10 (item part): "Per 100 g: 59 kcal · 10 g protein · 3.6 g carbs · 0.4 g fat". Pure.

const fmt = (n: number) => String(Math.round(n * 10) / 10);

export function nutrientsText(n: Nutrients | null | undefined): string | null {
  if (!n) return null;
  const parts: string[] = [];
  if (n.energyKcal != null) parts.push(`${Math.round(n.energyKcal)} kcal`);
  if (n.proteinG != null) parts.push(`${fmt(n.proteinG)} g protein`);
  if (n.carbohydrateG != null) parts.push(`${fmt(n.carbohydrateG)} g carbs`);
  if (n.fatG != null) parts.push(`${fmt(n.fatG)} g fat`);
  return parts.length ? parts.join(' · ') : null;
}

export function basisLabel(basis: PantryItem['nutritionBasis']): string {
  return basis === '100g' ? 'Per 100 g' : basis === '100ml' ? 'Per 100 ml' : 'Per piece';
}

/** Lines to show under a pantry item; empty when no nutrition is known. */
export function itemNutritionLines(item: Pick<PantryItem, 'nutritionBasis' | 'nutrition' | 'perServing' | 'servingSizeBase'>): string[] {
  const lines: string[] = [];
  const per = nutrientsText(item.nutrition);
  if (per) lines.push(`${basisLabel(item.nutritionBasis)}: ${per}`);
  const serving = nutrientsText(item.perServing);
  if (serving && item.servingSizeBase) {
    const u = item.nutritionBasis === '100ml' ? 'ml' : 'g';
    lines.push(`Per serving (${fmt(item.servingSizeBase)} ${u}): ${serving}`);
  }
  return lines;
}
