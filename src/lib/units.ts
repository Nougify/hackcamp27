import type { DisplayUnit, UnitDim } from '@/contracts/domain';

interface UnitInfo {
  dim: UnitDim;
  toBase: number; // multiply a quantity in this unit by this to get the base unit
}

const UNITS: Record<DisplayUnit, UnitInfo> = {
  g: { dim: 'mass', toBase: 1 },
  kg: { dim: 'mass', toBase: 1000 },
  oz: { dim: 'mass', toBase: 28.3495 },
  lb: { dim: 'mass', toBase: 453.592 },
  ml: { dim: 'volume', toBase: 1 },
  l: { dim: 'volume', toBase: 1000 },
  tsp: { dim: 'volume', toBase: 4.92892 },
  tbsp: { dim: 'volume', toBase: 14.7868 },
  cup: { dim: 'volume', toBase: 236.588 },
  fl_oz: { dim: 'volume', toBase: 29.5735 },
  pcs: { dim: 'count', toBase: 1 },
};

export function toBase(qty: number, unit: DisplayUnit): { dim: UnitDim; qtyBase: number } | null {
  const info = UNITS[unit];
  if (!info) return null;
  return { dim: info.dim, qtyBase: qty * info.toBase };
}

export function fromBase(qtyBase: number, dim: UnitDim, unit: DisplayUnit): number | null {
  const info = UNITS[unit];
  if (!info || info.dim !== dim) return null;
  return qtyBase / info.toBase;
}

export function convertBetween(
  qtyBase: number,
  from: UnitDim,
  to: UnitDim,
  bridge: { gramsPerUnit?: number | null; densityGPerMl?: number | null },
): number | null {
  if (from === to) return qtyBase;

  const { gramsPerUnit, densityGPerMl } = bridge;

  // Normalize to grams first.
  let grams: number | null;
  if (from === 'mass') grams = qtyBase;
  else if (from === 'count') grams = gramsPerUnit != null ? qtyBase * gramsPerUnit : null;
  else if (from === 'volume') grams = densityGPerMl != null ? qtyBase * densityGPerMl : null;
  else grams = null;

  if (grams == null) return null;

  if (to === 'mass') return grams;
  if (to === 'count') return gramsPerUnit != null ? grams / gramsPerUnit : null;
  if (to === 'volume') return densityGPerMl != null ? grams / densityGPerMl : null;
  return null;
}

const UNIT_ALIASES: Record<string, DisplayUnit> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  gr: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  floz: 'fl_oz',
  'fl oz': 'fl_oz',
  'fl.oz': 'fl_oz',
  fluidounce: 'fl_oz',
  fluidounces: 'fl_oz',
  pcs: 'pcs',
  pc: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  each: 'pcs',
  clove: 'pcs',
  cloves: 'pcs',
  egg: 'pcs',
  eggs: 'pcs',
  count: 'pcs',
};

export function parseUnit(raw: string): DisplayUnit | null {
  const key = raw.trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[key] ?? null;
}

function roundDisplay(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatQty(qtyBase: number, dim: UnitDim, preferred?: DisplayUnit): string {
  let unit: DisplayUnit;
  if (preferred && UNITS[preferred].dim === dim) {
    unit = preferred;
  } else if (dim === 'mass') {
    unit = qtyBase >= 1000 ? 'kg' : 'g';
  } else if (dim === 'volume') {
    unit = qtyBase >= 1000 ? 'l' : 'ml';
  } else {
    unit = 'pcs';
  }
  const value = roundDisplay(fromBase(qtyBase, dim, unit) ?? qtyBase);
  return `${value} ${unit === 'pcs' ? 'pcs' : unit}`;
}
