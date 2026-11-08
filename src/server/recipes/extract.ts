import 'server-only';
import * as cheerio from 'cheerio';
import { getScraper, scrapeRecipe } from 'recipe-scrapers';
import type { Nutrients, RecipeSource } from '@/contracts/domain';
import { extractJsonLdRecipe, parseIsoDuration, parsePublisherNutrition, parseYield } from './jsonld';

export interface ExtractedRecipe {
  title: string;
  author: string | null;
  siteName: string;
  canonicalUrl: string;
  ingredients: string[];
  steps: string[];
  servings: number;
  servingsDefaulted: boolean;
  yieldRaw: string | null;
  times: { prepMin: number | null; cookMin: number | null; totalMin: number | null };
  publisherNutrition: Nutrients | null;
  declaredDiet: string[];
  extractionMethod: RecipeSource['extractionMethod'];
}

/**
 * Step-timer parsing (F11): lower bound of a range, compound durations
 * summed ("1 hour 15 minutes"). Returns whole seconds or null.
 */
export function parseTimerSeconds(text: string): number | null {
  const re =
    /(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/gi;
  let total = 0;
  let found = false;
  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    // Skip bare "m"/"s" single letters unless clearly a duration ("5m" ok, "5 m" ambiguous — accept anyway).
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    const unit = m[3]!.toLowerCase();
    const mult = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
    // Guard: "5 m" with a space and single letter is likely meters, not minutes.
    if ((unit === 'm' || unit === 's') && /\s/.test(m[0].slice(String(m[1]).length, String(m[1]).length + 1))) {
      // "5 m" — treat as meters, skip. "5m" is fine.
      if (m[0].includes(' ')) continue;
    }
    total += value * mult;
    found = true;
  }
  return found ? Math.round(total) : null;
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Canonical URL: `<link rel=canonical>` → JSON-LD `url` → final URL (§10.3.2).
 * Never returns a vertexaisearch redirect.
 */
export function canonicalizeUrl(html: string, jsonLdUrl: string | null, finalUrl: string): string {
  try {
    const $ = cheerio.load(html);
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical) {
      const abs = new URL(canonical, finalUrl).toString();
      if (isHttpUrl(abs) && !abs.includes('vertexaisearch')) return abs;
    }
  } catch {
    // fall through
  }
  if (jsonLdUrl && isHttpUrl(jsonLdUrl) && !jsonLdUrl.includes('vertexaisearch')) {
    try {
      return new URL(jsonLdUrl, finalUrl).toString();
    } catch {
      // fall through
    }
  }
  return finalUrl;
}

function siteNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Translate recipe-scrapers' flat nutrient strings into our parser's keys. */
function publisherNutritionFromScraper(nutrients: Record<string, string>): Nutrients | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(nutrients)) lower[k.toLowerCase().trim()] = v;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) if (lower[k] != null) return lower[k];
    return undefined;
  };
  return parsePublisherNutrition({
    calories: pick('calories', 'energy', 'energy-kcal'),
    proteinContent: pick('protein', 'proteincontent'),
    carbohydrateContent: pick('carbohydrate', 'carbohydrates', 'carbs', 'total carbohydrate'),
    fatContent: pick('fat', 'total fat', 'fatcontent'),
    saturatedFatContent: pick('saturated fat', 'saturatedfat', 'saturatedfatcontent'),
    sugarContent: pick('sugar', 'sugars', 'sugarscontent'),
    fiberContent: pick('fiber', 'fibre', 'dietary fiber'),
    sodiumContent: pick('sodium', 'sodiumcontent'),
  });
}

function hasHostScraper(url: string): boolean {
  try {
    getScraper(url, { wildMode: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract-first-with-scrapeRecipe, JSON-LD-fallback pipeline (F6 step 5).
 * Returns null when the page carries no usable recipe markup.
 */
export async function extractRecipe(html: string, finalUrl: string): Promise<ExtractedRecipe | null> {
  const jsonLd = extractJsonLdRecipe(html);

  try {
    const host = new URL(finalUrl).hostname;
    const scraped = await scrapeRecipe(html, finalUrl, {
      wildMode: true,
      fallbackDescription: `Recipe from ${host}`,
      fallbackImage: `https://${host}/favicon.ico`,
    });
    const ingredients = scraped.ingredients.flatMap((g) => g.items.map((i) => i.value.trim()).filter(Boolean));
    const steps = scraped.instructions.flatMap((g) => g.items.map((i) => i.value.trim()).filter(Boolean));
    if (scraped.title.trim() && ingredients.length > 0 && steps.length > 0) {
      const yieldInfo = parseYield(scraped.yields);
      return {
        title: scraped.title.trim(),
        author: scraped.author?.trim() || jsonLd?.author || null,
        siteName: scraped.siteName?.trim() || siteNameFromUrl(finalUrl),
        canonicalUrl: canonicalizeUrl(html, jsonLd?.pageUrl ?? null, scraped.canonicalUrl || finalUrl),
        ingredients,
        steps,
        servings: yieldInfo.servings,
        servingsDefaulted: yieldInfo.defaulted,
        yieldRaw: yieldInfo.raw,
        times: {
          prepMin: scraped.prepTime ?? jsonLd?.times.prepMin ?? null,
          cookMin: scraped.cookTime ?? jsonLd?.times.cookMin ?? null,
          totalMin: scraped.totalTime ?? jsonLd?.times.totalMin ?? null,
        },
        publisherNutrition: publisherNutritionFromScraper(scraped.nutrients) ?? jsonLd?.nutrition ?? null,
        declaredDiet: jsonLd?.declaredDiet ?? [],
        extractionMethod: jsonLd ? 'jsonld' : hasHostScraper(finalUrl) ? 'site-scraper' : 'microdata',
      };
    }
  } catch {
    // Fall through to the JSON-LD extractor.
  }

  if (jsonLd) {
    return {
      title: jsonLd.title,
      author: jsonLd.author,
      siteName: siteNameFromUrl(finalUrl),
      canonicalUrl: canonicalizeUrl(html, jsonLd.pageUrl, finalUrl),
      ingredients: jsonLd.ingredients,
      steps: jsonLd.steps,
      servings: jsonLd.servings,
      servingsDefaulted: jsonLd.servingsDefaulted,
      yieldRaw: jsonLd.yieldRaw,
      times: jsonLd.times,
      publisherNutrition: jsonLd.nutrition,
      declaredDiet: jsonLd.declaredDiet,
      extractionMethod: 'jsonld',
    };
  }
  return null;
}

export { parseIsoDuration };
