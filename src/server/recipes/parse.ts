import 'server-only';
import { geminiJson } from '@/lib/gemini/client';
import { NORMALIZE_SYSTEM_PROMPT, normalizeJsonSchema, normalizeSchema } from '@/lib/gemini/schemas';
import { parseUnit, toBase } from '@/lib/units';
import type { DisplayUnit, RecipeIngredient, UnitDim } from '@/contracts/domain';

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const NEGLIGIBLE_RE = /\b(to taste|to serve|as needed|for garnish|for serving|pinch|a dash|dash)\b/i;

const DESCRIPTORS = new Set([
  'boneless',
  'skinless',
  'fresh',
  'chopped',
  'minced',
  'diced',
  'sliced',
  'grated',
  'shredded',
  'large',
  'small',
  'medium',
  'baby',
  'ripe',
  'raw',
  'cooked',
  'frozen',
  'thawed',
  'drained',
  'rinsed',
  'packed',
  'softened',
  'melted',
  'divided',
  'optional',
  'peeled',
  'seeded',
  'cored',
  'trimmed',
  'crushed',
  'ground',
  'whole',
  'juiced',
  'zested',
  'beaten',
  'whisked',
  'sifted',
  'toasted',
  'roasted',
  'grilled',
  'boiled',
  'steamed',
  'sauteed',
  'sautéed',
  'marinated',
  'seasoned',
  'warmed',
  'chilled',
]);

const STAPLE_NAMES = new Set(['salt', 'pepper', 'oil', 'water', 'sugar']);

export function isStapleIngredient(normalizedName: string): boolean {
  const lower = normalizedName.toLowerCase().trim();
  if (STAPLE_NAMES.has(lower)) return true;
  return [...STAPLE_NAMES].some((s) => lower.endsWith(` ${s}`));
}

/** Drops comma segments that are pure preparation notes, keeping the rest. */
export function stripDescriptorSegments(s: string): string {
  const segments = s
    .split(',')
    .map((seg) => seg.trim())
    .filter(Boolean);
  const kept = segments.filter((seg) => {
    const words = seg
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(Boolean);
    return words.length > 0 && !words.every((w) => DESCRIPTORS.has(w));
  });
  return (kept.length > 0 ? kept : segments).join(' ');
}

/** Lowercase, strip descriptors and parentheticals, naive singularize. */
export function normalizeIngredientName(name: string): string {
  let s = stripDescriptorSegments(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter((w) => w && !DESCRIPTORS.has(w));
  s = words.join(' ');
  // Naive singularization on the last word.
  return s.replace(/\b(\w+)$/, (_m, last: string) => {
    if (last.endsWith('ies') && last.length > 4) return last.slice(0, -3) + 'y';
    if (/(ches|shes|xes|zes|sses)$/.test(last) && last.length > 4) return last.slice(0, -2);
    if (last.endsWith('oes') && last.length > 4) return last.slice(0, -2); // tomatoes → tomato
    if (last.endsWith('s') && !last.endsWith('ss') && last.length > 3) return last.slice(0, -1);
    return last;
  });
}

function parseNumberToken(token: string): number | null {
  const t = token.trim().replace(/,$/, '');
  if (UNICODE_FRACTIONS[t] != null) return UNICODE_FRACTIONS[t];
  // Mixed number "1 1/2" is handled by the caller; here: "1/2", "1.5", "1,5", "2".
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const denom = Number(frac[2]);
    if (denom === 0) return null;
    return Number(frac[1]) / denom;
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const CONTAINERS = new Set([
  'can',
  'cans',
  'tin',
  'tins',
  'jar',
  'jars',
  'bottle',
  'bottles',
  'package',
  'packages',
  'pack',
  'packs',
  'packet',
  'packets',
  'bag',
  'bags',
  'box',
  'boxes',
  'bunch',
  'bunches',
  'head',
  'heads',
  'stalk',
  'stalks',
  'slice',
  'slices',
  'clove',
  'cloves',
  'piece',
  'pieces',
  'strip',
  'strips',
]);

/** Qty without a known unit counts as pieces ("1 lemon" → 1 count). */
export function parseIngredientLine(raw: string): RecipeIngredient {
  const base: RecipeIngredient = {
    raw,
    qty: null,
    unit: null,
    name: null,
    normalizedName: null,
    dim: null,
    qtyBase: null,
    isStaple: false,
    flags: [],
  };
  const text = raw.trim();
  if (!text) return { ...base, flags: ['parse_failed'] };

  if (NEGLIGIBLE_RE.test(text) && !/^\s*\d/.test(text)) {
    const name = normalizeIngredientName(text);
    return { ...base, qty: 0, name: name || text, normalizedName: name || null, isStaple: true, flags: ['negligible'] };
  }

  const tokens = text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/);
  let qty: number | null = null;
  let rest = tokens;

  // Leading quantity: "2", "1/2", "½", "1 1/2", "2-3" (midpoint).
  const first = parseNumberToken(tokens[0] ?? '');
  if (first != null) {
    qty = first;
    rest = tokens.slice(1);
    // Mixed number: "1 1/2 cups".
    if (rest.length > 0 && /^\d+\/\d+$/.test(rest[0] ?? '')) {
      const f = parseNumberToken(rest[0]!);
      if (f != null) {
        qty += f;
        rest = rest.slice(1);
      }
    }
  } else {
    const range = (tokens[0] ?? '').match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
    if (range) {
      qty = (Number(range[1]) + Number(range[2])) / 2;
      rest = tokens.slice(1);
    } else {
      const uni = tokens[0] ?? '';
      if (UNICODE_FRACTIONS[uni] != null) {
        qty = UNICODE_FRACTIONS[uni];
        rest = tokens.slice(1);
      }
    }
  }

  let unit: DisplayUnit | null = null;
  if (rest.length > 0) {
    const candidate = parseUnit((rest[0] ?? '').replace(/,$/, ''));
    if (candidate) {
      unit = candidate;
      rest = rest.slice(1);
    } else if (qty != null && CONTAINERS.has((rest[0] ?? '').toLowerCase().replace(/,$/, ''))) {
      unit = 'pcs';
      rest = rest.slice(1);
    }
  }

  // Drop comma segments that are pure preparation notes ("boneless, skinless
  // chicken thighs" → "skinless chicken thighs"; "1 lemon, juiced" → "lemon").
  const name = stripDescriptorSegments(rest.join(' '))
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) {
    if (qty == null && unit == null) return { ...base, flags: ['parse_failed'] };
    // Qty with no name (e.g. "2") — keep matchable-by-nothing but convertible.
    const converted = unit ? toBase(qty ?? 0, unit) : qty != null ? { dim: 'count' as UnitDim, qtyBase: qty } : null;
    return {
      ...base,
      qty,
      unit,
      dim: converted?.dim ?? null,
      qtyBase: converted?.qtyBase ?? null,
      flags: ['parse_failed'],
    };
  }

  const normalizedName = normalizeIngredientName(name);
  const converted =
    qty == null ? null : unit ? toBase(qty, unit) : { dim: 'count' as UnitDim, qtyBase: qty };
  return {
    raw,
    qty,
    unit,
    name,
    normalizedName: normalizedName || null,
    dim: converted?.dim ?? null,
    qtyBase: converted?.qtyBase ?? null,
    isStaple: isStapleIngredient(normalizedName),
    flags: [],
  };
}

/** Deterministic parse of every line. Displayed text is always `raw`. */
export function parseRecipeIngredients(raws: string[]): RecipeIngredient[] {
  return raws.map(parseIngredientLine);
}

export interface NormalizedLine {
  raw: string;
  qty: number | null;
  unit: DisplayUnit | null;
  name: string | null;
  dim: UnitDim | null;
}

/**
 * One batched Gemini call for lines the deterministic parser failed on
 * (F6 step 6). Returns a map from raw line → normalized fields.
 */
export async function normalizeWithGemini(raws: string[]): Promise<Map<string, NormalizedLine>> {
  const out = new Map<string, NormalizedLine>();
  if (raws.length === 0) return out;
  const text = `Parse these recipe ingredient lines:\n${raws.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
  const { data } = await geminiJson({
    system: NORMALIZE_SYSTEM_PROMPT,
    text,
    jsonSchema: normalizeJsonSchema,
    zod: normalizeSchema,
  });
  for (const item of data.items) {
    out.set(item.raw, { raw: item.raw, qty: item.qty, unit: item.unit, name: item.name, dim: item.dim });
  }
  return out;
}

/** Applies Gemini normalization results onto already-parsed ingredients. */
export function applyNormalizedLines(
  parsed: RecipeIngredient[],
  normalized: Map<string, NormalizedLine>,
): RecipeIngredient[] {
  return parsed.map((ing) => {
    if (!ing.flags.includes('parse_failed')) return ing;
    const n = normalized.get(ing.raw);
    if (!n || !n.name) return ing;
    const normalizedName = normalizeIngredientName(n.name);
    const converted =
      n.qty == null || n.unit == null
        ? n.qty != null
          ? { dim: 'count' as UnitDim, qtyBase: n.qty }
          : null
        : toBase(n.qty, n.unit);
    return {
      ...ing,
      qty: n.qty,
      unit: n.unit,
      name: n.name,
      normalizedName,
      dim: converted?.dim ?? n.dim ?? null,
      qtyBase: converted?.qtyBase ?? null,
      isStaple: isStapleIngredient(normalizedName),
      flags: [],
    };
  });
}
