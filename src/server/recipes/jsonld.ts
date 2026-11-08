import type { Nutrients } from '@/contracts/domain';

export interface PublisherTimes {
  prepMin: number | null;
  cookMin: number | null;
  totalMin: number | null;
}

export interface JsonLdRecipe {
  title: string;
  author: string | null;
  ingredients: string[];
  steps: string[];
  servings: number;
  servingsDefaulted: boolean;
  yieldRaw: string | null;
  times: PublisherTimes;
  nutrition: Nutrients | null;
  declaredDiet: string[];
  pageUrl: string | null; // JSON-LD `url`, for canonicalization
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function typeIncludes(node: { '@type'?: unknown }, want: string): boolean {
  const t = node['@type'];
  if (typeof t === 'string') return t.toLowerCase() === want.toLowerCase();
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === want.toLowerCase());
  return false;
}

/** Walk arrays and @graph to find the first schema.org Recipe node. */
export function findRecipeNode(doc: unknown): Record<string, unknown> | null {
  const stack: unknown[] = [doc];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      continue;
    }
    if (cur && typeof cur === 'object') {
      const obj = cur as Record<string, unknown>;
      if (typeIncludes(obj, 'Recipe')) return obj;
      if (obj['@graph'] !== undefined) stack.push(obj['@graph']);
    }
  }
  return null;
}

function textOf(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  return null;
}

function authorOf(v: unknown): string | null {
  if (typeof v === 'string') return textOf(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = authorOf(item);
      if (t) return t;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    const name = (v as Record<string, unknown>).name;
    if (typeof name === 'string') return textOf(name);
  }
  return null;
}

/**
 * `recipeInstructions` normalization (§10.4): a string becomes one step per
 * paragraph, HowToStep[] becomes their text, HowToSection is flattened.
 */
export function normalizeInstructions(v: unknown): string[] {
  if (typeof v === 'string') {
    return v
      .split(/\n{2,}|\r\n{2,}/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }
  const out: string[] = [];
  for (const item of asArray(v)) {
    if (typeof item === 'string') {
      const t = item.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeIncludes(obj, 'HowToSection')) {
        out.push(...normalizeInstructions(obj.itemListElement));
      } else if (typeof obj.text === 'string') {
        const t = (obj.text as string).replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      } else if (typeof obj.name === 'string' && !typeIncludes(obj, 'HowToStep')) {
        // Some publishers put the step in `name` only.
        const t = (obj.name as string).replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      }
    }
  }
  return out;
}

/** Yield: first integer in recipeYield; default 4 when unparseable (§10.4). */
export function parseYield(v: unknown): { servings: number; defaulted: boolean; raw: string | null } {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return { servings: v, defaulted: false, raw: String(v) };
  if (Array.isArray(v) && v.length > 0) return parseYield(v[0]);
  if (typeof v === 'string') {
    const m = v.match(/\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n) && n > 0) return { servings: n, defaulted: false, raw: v };
    }
    return { servings: 4, defaulted: true, raw: v };
  }
  return { servings: 4, defaulted: true, raw: null };
}

/** ISO-8601 duration (PT1H15M) → whole minutes. Returns null when unparseable. */
export function parseIsoDuration(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m || m[0] === 'P' || m[0] === 'PT') return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const mins = Number(m[3] ?? 0);
  const secs = Number(m[4] ?? 0);
  if (![days, hours, mins, secs].every(Number.isFinite)) return null;
  return Math.round(days * 1440 + hours * 60 + mins + secs / 60);
}

function parseAmount(text: string): { value: number; unit: string } | null {
  const m = text.trim().match(/([\d,.]+)\s*([a-zA-Zµ]*)/);
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[2]!.toLowerCase() };
}

/**
 * Publisher `nutrition` (per serving, §10.4 / F10). `calories` may be
 * "150 calories", "150 kcal" or "630 kJ" (kJ is converted).
 */
export function parsePublisherNutrition(v: unknown): Nutrients | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const n = v as Record<string, unknown>;
  const get = (key: string): string | null => {
    const val = n[key];
    if (typeof val === 'number' && Number.isFinite(val)) return String(val);
    if (typeof val === 'string') return val;
    return null;
  };
  const calRaw = get('calories');
  let kcal: number | null = null;
  if (calRaw) {
    const parsed = parseAmount(calRaw);
    if (parsed) kcal = /kj\b|kilojoule/.test(calRaw.toLowerCase()) ? parsed.value / 4.184 : parsed.value;
  }
  const grams = (key: string): number | null => {
    const raw = get(key);
    if (!raw) return null;
    const parsed = parseAmount(raw);
    if (!parsed) return null;
    if (parsed.unit === 'mg') return parsed.value / 1000;
    if (parsed.unit === 'µg' || parsed.unit === 'ug' || parsed.unit === 'mcg') return parsed.value / 1e6;
    return parsed.value;
  };
  const sodiumMg = (() => {
    const raw = get('sodiumContent');
    if (!raw) return null;
    const parsed = parseAmount(raw);
    if (!parsed) return null;
    if (parsed.unit === 'g') return parsed.value * 1000;
    return parsed.value;
  })();
  if (kcal == null && grams('proteinContent') == null && grams('carbohydrateContent') == null && grams('fatContent') == null) {
    return null;
  }
  return {
    energyKcal: kcal == null ? null : Math.round(kcal * 10) / 10,
    proteinG: grams('proteinContent'),
    carbohydrateG: grams('carbohydrateContent'),
    fatG: grams('fatContent'),
    saturatedFatG: grams('saturatedFatContent'),
    sugarsG: grams('sugarContent'),
    fibreG: grams('fiberContent'),
    sodiumMg,
  };
}

const LD_JSON_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Extracts every JSON-LD block from the HTML (tolerates a trailing comma). */
export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  LD_JSON_RE.lastIndex = 0;
  for (;;) {
    const m = LD_JSON_RE.exec(html);
    if (!m) break;
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      try {
        out.push(JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')));
      } catch {
        // Broken block — skip it.
      }
    }
  }
  return out;
}

/**
 * Hand-rolled JSON-LD fallback extractor (§10.4). Returns null when the page
 * carries no usable schema.org Recipe.
 */
export function extractJsonLdRecipe(html: string): JsonLdRecipe | null {
  for (const block of extractJsonLdBlocks(html)) {
    const node = findRecipeNode(block);
    if (!node) continue;
    const title = textOf(node.name);
    const ingredients = asArray(node.recipeIngredient).map(textOf).filter((s): s is string => s != null);
    const steps = normalizeInstructions(node.recipeInstructions);
    if (!title || ingredients.length === 0 || steps.length === 0) continue;
    const yieldInfo = parseYield(node.recipeYield);
    const declaredDiet = asArray(node.suitableForDiet)
      .map((d) => (typeof d === 'string' ? d : null))
      .filter((d): d is string => d != null);
    return {
      title,
      author: authorOf(node.author),
      ingredients,
      steps,
      servings: yieldInfo.servings,
      servingsDefaulted: yieldInfo.defaulted,
      yieldRaw: yieldInfo.raw,
      times: {
        prepMin: parseIsoDuration(node.prepTime),
        cookMin: parseIsoDuration(node.cookTime),
        totalMin: parseIsoDuration(node.totalTime),
      },
      nutrition: parsePublisherNutrition(node.nutrition),
      declaredDiet,
      pageUrl: textOf(node.url),
    };
  }
  return null;
}
