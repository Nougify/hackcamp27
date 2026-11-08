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

/** Own-property lookup, so untrusted strings like "constructor" never match. */
function infoOf(unit: string): UnitInfo | null {
  return Object.hasOwn(UNITS, unit) ? UNITS[unit as DisplayUnit] : null;
}

export const DISPLAY_UNITS = Object.keys(UNITS) as DisplayUnit[];

export function isDisplayUnit(x: unknown): x is DisplayUnit {
  return typeof x === 'string' && infoOf(x) !== null;
}

export function unitDim(unit: DisplayUnit): UnitDim {
  return UNITS[unit].dim;
}

export function unitsForDim(dim: UnitDim): DisplayUnit[] {
  return DISPLAY_UNITS.filter((u) => UNITS[u].dim === dim);
}

export function toBase(qty: number, unit: DisplayUnit): { dim: UnitDim; qtyBase: number } | null {
  const info = infoOf(unit);
  if (!info || !Number.isFinite(qty)) return null;
  return { dim: info.dim, qtyBase: qty * info.toBase };
}

export function fromBase(qtyBase: number, dim: UnitDim, unit: DisplayUnit): number | null {
  const info = infoOf(unit);
  if (!info || info.dim !== dim || !Number.isFinite(qtyBase)) return null;
  return qtyBase / info.toBase;
}

export function convertBetween(
  qtyBase: number,
  from: UnitDim,
  to: UnitDim,
  bridge: { gramsPerUnit?: number | null; densityGPerMl?: number | null },
): number | null {
  if (!Number.isFinite(qtyBase)) return null;
  if (from === to) return qtyBase;

  // A zero, negative or non-finite bridge is no bridge: never guess (SPEC §5.4).
  const gramsPerUnit = positive(bridge.gramsPerUnit);
  const densityGPerMl = positive(bridge.densityGPerMl);

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

function positive(x: number | null | undefined): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null;
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

// More aliases (Johnny's port). Keys are in normalized form: lowercase, dots removed,
// runs of spaces/underscores/hyphens collapsed to one space.
const MORE_ALIASES: Record<string, DisplayUnit> = {
  gramme: 'g', grammes: 'g', grm: 'g', gm: 'g', gms: 'g',
  kgs: 'kg', kilogramme: 'kg', kilogrammes: 'kg', kilo: 'kg', kilos: 'kg',
  ozs: 'oz',
  mls: 'ml', cc: 'ml',
  ltr: 'l', ltrs: 'l',
  tsps: 'tsp',
  tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tbls: 'tbsp',
  c: 'cup',
  'fl ozs': 'fl_oz', 'fluid ounce': 'fl_oz', 'fluid ounces': 'fl_oz', 'fl ounce': 'fl_oz', 'fl ounces': 'fl_oz',
  ea: 'pcs', unit: 'pcs', units: 'pcs', ct: 'pcs', whole: 'pcs',
};

// Case-sensitive cookbook shorthands, checked before lowercasing: T = tablespoon, t = teaspoon.
const CASE_SENSITIVE: Record<string, DisplayUnit> = { T: 'tbsp', Tb: 'tbsp', Tbs: 'tbsp', t: 'tsp' };

function lookup(table: Record<string, DisplayUnit>, key: string): DisplayUnit | null {
  return Object.hasOwn(table, key) ? table[key]! : null;
}

/** 'Tbsp' | 'tablespoons' → 'tbsp'. Null for anything unknown (including 'pinch', 'to taste'). */
export function parseUnit(raw: string): DisplayUnit | null {
  const trimmed = raw.trim().replace(/\.+$/, '');
  const exact = lookup(CASE_SENSITIVE, trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/\./g, '').replace(/[\s_-]+/g, ' ');
  return (
    lookup(UNIT_ALIASES, lower) ??
    lookup(UNIT_ALIASES, normalized) ??
    lookup(MORE_ALIASES, normalized) ??
    lookup(UNIT_ALIASES, normalized.replace(/ /g, ''))
  );
}

function roundDisplay(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatQty(qtyBase: number, dim: UnitDim, preferred?: DisplayUnit): string {
  let unit: DisplayUnit;
  if (preferred && infoOf(preferred)?.dim === dim) {
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
