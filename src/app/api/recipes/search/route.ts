import { z } from 'zod';
import { requireUser } from '@/lib/current-user';
import { checkRateLimit } from '@/lib/rate-limit';
import { RateLimitedError } from '@/lib/errors';
import { handleRouteError, jsonErrorFromZod, ndjsonResponse } from '@/lib/http';
import type { RecipeSearchEvent } from '@/contracts/api';
import type { Allergen, DietFlag, RecipeCandidate } from '@/contracts/domain';
import { buildDiscoveryContext } from '@/server/recipes/discover';
import { collectDiscoveryUrls, discoverRecipeUrls } from '@/server/recipes/discover';
import { extractRecipe } from '@/server/recipes/extract';
import { processExtracted } from '@/server/recipes/pipeline';
import { computeScores } from '@/server/recipes/score';
import { SafeFetchError, safeFetchHtml } from '@/server/recipes/safe-fetch';
import {
  discoveryCacheKey,
  getDiscoveryCache,
  persistOriginal,
  setDiscoveryCache,
} from '@/server/recipes/store';
import { getProfileFilters, listPantryForMatching } from '@/server/recipes/pantry-view';

export const runtime = 'nodejs';

const bodySchema = z.object({
  mustUsePantryItemIds: z.array(z.string().uuid()).optional(),
  freeText: z.string().max(100).optional(),
  maxResults: z.number().int().min(1).max(10).default(6),
  extraDiets: z.array(z.enum(['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'high_protein'])).optional(),
});

const CONCURRENCY = 5;
const MAX_URLS = 12;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonErrorFromZod(parsed.error); // bad bodies don't spend rate-limit tokens
    const body = parsed.data;
    const limit = checkRateLimit(user.id, 'recipes/search');
    if (!limit.ok) throw new RateLimitedError('Too many recipe searches', limit.retryAfterMs);

    return ndjsonResponse<RecipeSearchEvent>(async (write, signal) => {
      write({ type: 'status', stage: 'searching', message: 'Finding recipes for your expiring ingredients…' });

      const profile = await getProfileFilters(user.id);
      const diets = [...new Set([...profile.diets, ...(body.extraDiets ?? [])])] as DietFlag[];
      const allergens = profile.allergens as Allergen[];
      const pantry = await listPantryForMatching(user.id, profile.tz);

      const mustUseIds =
        body.mustUsePantryItemIds ?? pantry.filter((p) => p.daysToExpiry != null && p.daysToExpiry <= 3).map((p) => p.id);
      const ctx = buildDiscoveryContext(pantry, { diets, allergens }, body.freeText);
      if (body.mustUsePantryItemIds) {
        ctx.expiring = pantry.filter((p) => mustUseIds.includes(p.id));
        ctx.alsoAvailable = pantry.filter((p) => !mustUseIds.includes(p.id));
      }

      const cacheKey = discoveryCacheKey({
        expiring: ctx.expiring.map((p) => p.normalizedName),
        diets,
        allergens,
        freeText: body.freeText,
      });
      let urls = await getDiscoveryCache(user.id, cacheKey);
      const cached = urls != null;
      if (!urls) {
        const discovered = await discoverRecipeUrls(ctx);
        urls = collectDiscoveryUrls(discovered.result).slice(0, MAX_URLS);
        await setDiscoveryCache(user.id, cacheKey, urls).catch(() => {});
        if (discovered.result.searchEntryPointHtml) {
          write({ type: 'search_suggestions', html: discovered.result.searchEntryPointHtml });
        }
      }

      if (urls.length === 0) {
        write({ type: 'done', total: 0, excludedCount: 0, cached });
        return;
      }

      write({ type: 'status', stage: 'fetching', message: `Checking ${urls.length} recipes…` });

      const seenCanonical = new Set<string>();
      let shown = 0;
      let reserved = 0; // result slots claimed synchronously, so parallel workers can't overshoot maxResults
      let excludedCount = 0;
      let next = 0;
      const stop = () => reserved >= body.maxResults || signal.aborted;

      const worker = async () => {
        while (next < urls.length && !stop()) {
          const url = urls[next++]!;
          try {
            const fetched = await safeFetchHtml(url);
            const extracted = await extractRecipe(fetched.text, fetched.finalUrl);
            if (!extracted) {
              excludedCount++;
              write({ type: 'excluded', url, reason: 'no_recipe_markup' });
              continue;
            }
            if (seenCanonical.has(extracted.canonicalUrl)) {
              excludedCount++;
              write({ type: 'excluded', url, reason: 'duplicate' });
              continue;
            }
            seenCanonical.add(extracted.canonicalUrl);
            const outcome = await processExtracted(extracted, { pantry, diets, allergens });
            if (outcome.kind === 'excluded') {
              excludedCount++;
              write({ type: 'excluded', url, reason: outcome.reason, detail: outcome.detail });
              continue;
            }
            if (stop()) return;
            reserved++; // claim the slot before awaiting
            let emitted = false;
            try {
              const persisted = await persistOriginal(user.id, extracted, outcome.ingredients);
              const [score] = computeScores(
                [
                  {
                    ingredients: outcome.ingredients,
                    matches: outcome.matches,
                    proteinPerServingG: outcome.nutrition.perServing.proteinG,
                  },
                ],
                { highProtein: diets.includes('high_protein') },
              );
              const candidate: RecipeCandidate = {
                recipeId: persisted.recipeId,
                title: extracted.title,
                source: {
                  url: extracted.canonicalUrl,
                  siteName: extracted.siteName,
                  author: extracted.author,
                  retrievedAt: new Date().toISOString(),
                  extractionMethod: extracted.extractionMethod,
                },
                totalMin: extracted.times.totalMin,
                servings: extracted.servings,
                score: score!,
                usesExpiring: outcome.usesExpiring,
                matches: outcome.matches,
                nutrition: outcome.nutrition,
              };
              shown++;
              emitted = true;
              write({ type: 'candidate', candidate });
            } finally {
              if (!emitted) reserved--; // persist failed: free the slot for another URL
            }
          } catch (err) {
            excludedCount++;
            if (err instanceof SafeFetchError && err.code === 'blocked_url') {
              write({ type: 'excluded', url, reason: 'blocked_url', detail: err.message });
            } else {
              write({
                type: 'excluded',
                url,
                reason: 'fetch_failed',
                detail: err instanceof Error ? err.message.slice(0, 200) : 'fetch failed',
              });
            }
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker()));
      write({ type: 'done', total: shown, excludedCount, cached });
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
