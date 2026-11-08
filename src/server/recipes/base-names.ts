import 'server-only';
import { z } from 'zod';
import { geminiJson } from '@/lib/gemini/client';
import type { PantryItem, PantryMatch, RecipeIngredient } from '@/contracts/domain';
import { matchWithBaseNames } from './match';
import { normalizeIngredientName } from './parse';

const SYSTEM =
  'For each numbered grocery product or recipe ingredient name, give the generic base ingredient it is. ' +
  'Drop brands, sizes, flavours or varieties that any version could stand in for, and filler like "any", "store-bought" or "your favourite". ' +
  'Keep words that make it a different ingredient. Examples: "Strawberry Jam" → "jam"; "any flavor jam" → "jam"; ' +
  '"Organic 2% Milk" → "milk"; "boneless skinless chicken thighs" → "chicken thigh"; "coconut milk" → "coconut milk"; ' +
  '"rice vinegar" → "rice vinegar"; "peanut butter" → "peanut butter". Reply with every index once, base names in English, lowercase.';

const jsonSchema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'base'],
        properties: { index: { type: 'integer' }, base: { type: 'string' } },
      },
    },
  },
};
const schema = z.object({ items: z.array(z.object({ index: z.number().int(), base: z.string().max(80) })) });

async function requestBaseNames(names: string[]): Promise<Array<string | null>> {
  const { data } = await geminiJson({
    system: SYSTEM,
    text: `Names:\n${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`,
    jsonSchema,
    zod: schema,
    timeoutMs: 8_000,
  });
  const out: Array<string | null> = names.map(() => null);
  for (const { index, base } of data.items) {
    if (index >= 1 && index <= names.length) out[index - 1] = normalizeIngredientName(base) || null;
  }
  return out;
}

// ponytail: per-process cache, cleared when full; persist to a table if Gemini cost or cold starts matter.
// Holds promises so parallel search candidates share one in-flight call per name.
const cache = new Map<string, Promise<string | null>>();
const MAX_CACHE = 5000;

/** Gemini-backed BaseNameFn. Never rejects; a failed call resolves to "unknown" and is retried next time. */
export async function geminiBaseNames(names: string[]): Promise<Map<string, string>> {
  const todo = [...new Set(names)].filter((n) => !cache.has(n));
  if (todo.length > 0) {
    if (cache.size + todo.length > MAX_CACHE) cache.clear();
    const batch = requestBaseNames(todo);
    todo.forEach((n, i) =>
      cache.set(
        n,
        batch.then(
          (b) => b[i] ?? null,
          (err) => {
            if (i === 0) console.warn('[base-names] Gemini call failed:', err instanceof Error ? err.message : err);
            cache.delete(n);
            return null;
          },
        ),
      ),
    );
  }
  const pending = names.map((n) => [n, cache.get(n)] as const);
  const out = new Map<string, string>();
  for (const [n, p] of pending) {
    const b = await p;
    if (b) out.set(n, b);
  }
  return out;
}

/** Pantry matching with the Gemini base-name fallback for ingredients that would otherwise be 'missing'. */
export function matchIngredientsSmart(ingredients: RecipeIngredient[], pantry: PantryItem[]): Promise<PantryMatch[]> {
  return matchWithBaseNames(ingredients, pantry, geminiBaseNames);
}
