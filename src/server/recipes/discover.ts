import 'server-only';
import { geminiGroundedSearch } from '@/lib/gemini/client';
import type { Allergen, DietFlag, PantryItem } from '@/contracts/domain';

export interface DiscoveryContext {
  expiring: PantryItem[]; // daysToExpiry <= 3, soonest first
  alsoAvailable: PantryItem[];
  diets: DietFlag[];
  allergens: Allergen[];
  freeText?: string;
}

/** F6 step 1: drop staples, split expiring (≤3d) from the rest. */
export function buildDiscoveryContext(
  pantry: PantryItem[],
  profile: { diets: DietFlag[]; allergens: Allergen[] },
  freeText?: string,
): DiscoveryContext {
  const usable = pantry.filter((p) => !isStapleName(p.normalizedName));
  return {
    expiring: usable.filter((p) => p.daysToExpiry != null && p.daysToExpiry <= 3),
    alsoAvailable: usable.filter((p) => p.daysToExpiry == null || p.daysToExpiry > 3),
    diets: profile.diets,
    allergens: profile.allergens,
    freeText: freeText?.slice(0, 100) || undefined,
  };
}

const STAPLE_WORDS = ['salt', 'pepper', 'oil', 'water', 'flour'];

export function isStapleName(normalizedName: string): boolean {
  const lower = normalizedName.toLowerCase();
  return STAPLE_WORDS.some((w) => lower === w || lower.endsWith(` ${w}`));
}

/** Discovery prompt (§10.3.2). Diets/allergens steer search; F7 enforces. */
export function buildDiscoveryPrompt(ctx: DiscoveryContext): string {
  const fmt = (p: PantryItem) => `${p.normalizedName}${p.daysToExpiry != null ? ` (${p.daysToExpiry}d)` : ''}`;
  const lines = [
    'You are finding REAL recipes published on the web. Use Google Search.',
    'Find up to 8 distinct recipe pages (not videos, not listicles, not aggregator search pages)',
    'that use several of these ingredients, prioritising the first ones (they expire soonest):',
    `MUST PREFER (expiring): ${ctx.expiring.map(fmt).join(', ') || 'none — use the available list'}`,
    `ALSO AVAILABLE: ${ctx.alsoAvailable.map(fmt).join(', ') || 'none'}`,
  ];
  if (ctx.diets.length > 0 || ctx.allergens.length > 0) {
    lines.push(`DIET: ${ctx.diets.join(', ') || 'none'}. EXCLUDE ALLERGENS: ${ctx.allergens.join(', ') || 'none'}.`);
  }
  if (ctx.freeText) lines.push(`THEME: ${ctx.freeText}`);
  lines.push(
    'Run 2–3 different searches, each anchored on 2–3 of the expiring ingredients.',
    'Return one line per recipe: <title> | <url>. Do not invent URLs.',
  );
  return lines.join('\n');
}

const URL_RE = /https?:\/\/[^\s)>\]"']+/g;

export interface GroundedResult {
  text: string;
  sources: Array<{ uri: string; title: string | null }>;
  webSearchQueries: string[];
  searchEntryPointHtml: string | null;
}

/**
 * Union of grounding-chunk URIs and URLs parsed from the text, deduped.
 * Text URLs are lower trust — both are verified by fetch + parse.
 */
export function collectDiscoveryUrls(result: GroundedResult): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const clean = raw.replace(/[.,;:!?]+$/, '');
    try {
      const u = new URL(clean);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    } catch {
      return;
    }
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  };
  for (const s of result.sources) push(s.uri);
  for (const m of result.text.match(URL_RE) ?? []) push(m);
  return out;
}

export async function discoverRecipeUrls(ctx: DiscoveryContext): Promise<{ urls: string[]; result: GroundedResult }> {
  const result = await geminiGroundedSearch({ prompt: buildDiscoveryPrompt(ctx) });
  return { urls: collectDiscoveryUrls(result), result };
}
