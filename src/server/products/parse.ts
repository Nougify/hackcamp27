import type { Allergen, Nutrients, Product } from '@/contracts/domain';
import { ALL_ALLERGENS, detectAllergens } from '@/server/pantry/allergens';

// Pure parsing shared by the provider adapters (SPEC §10.1, §10.2). Provider data is crowd-sourced:
// everything here tolerates junk and returns null rather than guessing.

export type PackageQuantity = NonNullable<Product['packageQuantity']>;
export type ServingSize = NonNullable<Product['servingSize']>;

/** Fits products.package_qty_base numeric(12,3), and rejects typos like "4000000 kg". */
const MAX_PACKAGE_BASE = 1_000_000;
/** The plausibility range SPEC F3 uses for a serving. */
const MAX_SERVING_BASE = 1000;

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** A finite number ≥ 0 from a number or numeric string, else null. */
export function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Provider sodium is in grams; salt is 2.5 × sodium (§10.1, verified against live responses). */
export function sodiumMgFrom(sodiumG: unknown, saltG: unknown): number | null {
  const sodium = num(sodiumG);
  if (sodium !== null) return round(sodium * 1000);
  const salt = num(saltG);
  return salt === null ? null : round((salt / 2.5) * 1000);
}

export function kcalFromKj(kj: unknown): number | null {
  const n = num(kj);
  return n === null ? null : round(n / 4.184);
}

export function emptyNutrients(): Nutrients {
  return { energyKcal: null, proteinG: null, carbohydrateG: null, fatG: null, saturatedFatG: null, sugarsG: null, fibreG: null, sodiumMg: null };
}

/** "1,5" is 1.5 but "1,000" is 1000. */
function decimal(s: string): number {
  return /^\d{1,3},\d{3}$/.test(s) ? Number(s.replace(',', '')) : Number(s.replace(',', '.'));
}

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const METRIC_UNITS: Array<[RegExp, 'g' | 'ml', number]> = [
  [/^(kg|kilograms?|kilogrammes?)$/i, 'g', 1000],
  [/^(g|gr|grams?|grammes?)$/i, 'g', 1],
  [/^(ml|millilit(er|re)s?)$/i, 'ml', 1],
  [/^cl$/i, 'ml', 10],
  [/^dl$/i, 'ml', 100],
  [/^(l|lt|lit(er|re)s?)$/i, 'ml', 1000],
];
const METRIC = new RegExp(
  String.raw`(?<![\d.,])(?:(\d+)\s*[x×*]\s*)?(${NUMBER})\s*(kilogram(?:me)?s?|kg|gram(?:me)?s?|gr|g|millilit(?:er|re)s?|ml|cl|dl|lit(?:er|re)s?|lt|l)(?![a-z])`,
  'gi',
);
const IMPERIAL = new RegExp(String.raw`(?<![\d.,])(?:(\d+)\s*[x×*]\s*)?(${NUMBER})\s*(fl\.?\s*oz|oz|ounces?|lbs?|pounds?)(?![a-z])`, 'i');
const COUNT = new RegExp(String.raw`(?<![\d.,])(\d+)\s*(pcs?|pieces?|count|ct|eggs?|units?)(?![a-z])`, 'i');

function metricMatches(text: string): Array<{ value: number; unit: 'g' | 'ml' }> {
  const out: Array<{ value: number; unit: 'g' | 'ml' }> = [];
  for (const m of text.matchAll(METRIC)) {
    const def = METRIC_UNITS.find(([re]) => re.test(m[3]));
    if (!def) continue;
    out.push({ value: (m[1] ? Number(m[1]) : 1) * decimal(m[2]) * def[2], unit: def[1] });
  }
  return out;
}

function checkedPackage(value: number, unit: PackageQuantity['unit'], text: string | null): PackageQuantity | null {
  return value > 0 && value <= MAX_PACKAGE_BASE ? { value: round(value, 3), unit, text } : null;
}

/** "400 g e", "1.89 L", "6 x 330 ml", "16 oz (454 g)", "12 eggs". Metric wins over imperial. */
export function parsePackageText(text: string | null): PackageQuantity | null {
  if (!text) return null;
  const metric = metricMatches(text)[0];
  if (metric) return checkedPackage(metric.value, metric.unit, text);
  const imperial = IMPERIAL.exec(text);
  if (imperial) {
    const count = imperial[1] ? Number(imperial[1]) : 1;
    const value = count * decimal(imperial[2]);
    const u = imperial[3].toLowerCase();
    if (u.startsWith('fl')) return checkedPackage(value * 29.5735, 'ml', text);
    if (u.startsWith('oz') || u.startsWith('ounce')) return checkedPackage(value * 28.3495, 'g', text);
    return checkedPackage(value * 453.592, 'g', text);
  }
  const count = COUNT.exec(text);
  return count ? checkedPackage(Number(count[1]), 'count', text) : null;
}

/** Serving size from text, preferring the last metric amount: "2 tbsp (30 g)" is 30 g. */
export function parseServingText(text: string | null): ServingSize | null {
  if (!text) return null;
  const metric = metricMatches(text).at(-1);
  if (!metric || metric.value <= 0 || metric.value > MAX_SERVING_BASE) return null;
  return { value: round(metric.value, 3), unit: metric.unit, text };
}

/** A numeric serving (OFF's serving_quantity) with text as a fallback for the value and the unit. */
export function servingFrom(text: string | null, quantity: unknown, unit: unknown): ServingSize | null {
  const fromText = parseServingText(text);
  const value = num(quantity);
  if (value === null || value <= 0 || value > MAX_SERVING_BASE) return fromText;
  const resolved = unit === 'ml' || unit === 'g' ? unit : (fromText?.unit ?? 'g');
  return { value: round(value, 3), unit: resolved, text };
}

// ── Allergens ───────────────────────────────────────────────────────────────

const ALLERGEN_TERMS = new Map<string, Allergen>([
  ['milk', 'milk'],
  ['lait', 'milk'],
  ['nuts', 'tree_nut'],
  ['tree nuts', 'tree_nut'],
  ['fruits a coque', 'tree_nut'],
  ['noix', 'tree_nut'],
  ['peanut', 'peanut'],
  ['peanuts', 'peanut'],
  ['arachide', 'peanut'],
  ['arachides', 'peanut'],
  ['soy', 'soy'],
  ['soya', 'soy'],
  ['soja', 'soy'],
  ['soybean', 'soy'],
  ['soybeans', 'soy'],
  ['gluten', 'wheat_gluten'],
  ['wheat', 'wheat_gluten'],
  ['ble', 'wheat_gluten'],
  ['egg', 'egg'],
  ['eggs', 'egg'],
  ['oeuf', 'egg'],
  ['oeufs', 'egg'],
  ['fish', 'fish'],
  ['poisson', 'fish'],
  ['poissons', 'fish'],
  ['shellfish', 'shellfish'],
  ['crustaceans', 'shellfish'],
  ['molluscs', 'shellfish'],
  ['crustaces', 'shellfish'],
  ['mollusques', 'shellfish'],
  ['sesame', 'sesame'],
  ['sesame seeds', 'sesame'],
  ['graines de sesame', 'sesame'],
  ['mustard', 'mustard'],
  ['moutarde', 'mustard'],
  ['sulphites', 'sulphite'],
  ['sulfites', 'sulphite'],
  ['sulphur dioxide and sulphites', 'sulphite'],
  ['anhydride sulfureux et sulfites', 'sulphite'],
]);

function allergenTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[a-z]{2}:/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replaceAll('œ', 'oe')
    .replace(/[-_]/g, ' ')
    .trim();
}

/** Provider terms ("Milk, Nuts" or "en:soybeans") → our enum. Unknown terms go through Hang's keywords. */
export function mapAllergens(terms: string[]): Allergen[] {
  const found = new Set<Allergen>();
  const unknown: string[] = [];
  for (const raw of terms) {
    const term = allergenTerm(raw);
    if (term === '') continue;
    const mapped = ALLERGEN_TERMS.get(term);
    if (mapped) found.add(mapped);
    else unknown.push(term);
  }
  for (const a of detectAllergens(unknown)) found.add(a);
  return ALL_ALLERGENS.filter((a) => found.has(a));
}
