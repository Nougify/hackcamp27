import { convertBetween } from '@/lib/units';
import type { PantryItem, PantryMatch, RecipeIngredient } from '@/contracts/domain';

const SYNONYMS: Record<string, string[]> = {
  'green onion': ['scallion', 'spring onion'],
  chickpea: ['garbanzo', 'garbanzo bean'],
  coriander: ['cilantro', 'coriander leaf'], // one entry: a second key would overwrite the alias
  eggplant: ['aubergine'],
  zucchini: ['courgette'],
  'bell pepper': ['capsicum', 'sweet pepper'],
  arugula: ['rocket'],
  'romaine lettuce': ['cos lettuce'],
  shrimp: ['prawn'],
  'ground beef': ['minced beef', 'beef mince'],
  'powdered sugar': ['icing sugar', "confectioners' sugar"],
  'heavy cream': ['double cream', 'whipping cream'],
  'all-purpose flour': ['plain flour'],
  yogurt: ['yoghurt'],
  'green bean': ['string bean', 'french bean'],
  'snap pea': ['sugar snap pea'],
  'chili pepper': ['chilli', 'chile'],
};

const aliasToCanonical = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(SYNONYMS)) {
  aliasToCanonical.set(canonical, canonical);
  for (const a of aliases) aliasToCanonical.set(a, canonical);
}

function canonical(name: string): string {
  return aliasToCanonical.get(name.toLowerCase().trim()) ?? name.toLowerCase().trim();
}

function tokens(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[\s-]+/).filter(Boolean));
}

/**
 * Token-subset match: one name's tokens contain the other's ("chicken thigh"
 * ⊂ "boneless chicken thighs"). Needs ≥2 shared tokens to avoid "rice" ⊂
 * "rice vinegar" false positives.
 */
function tokenSubsetMatch(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const contained = shared === Math.min(ta.size, tb.size);
  return contained && (shared >= 2 || (ta.size === 1 && tb.size === 1));
}

function usablePantry(pantry: PantryItem[]): PantryItem[] {
  return pantry
    .filter((p) => p.quantityBase > 0 && (p.daysToExpiry == null || p.daysToExpiry >= 0))
    .sort((a, b) => (a.daysToExpiry ?? 9999) - (b.daysToExpiry ?? 9999)); // FEFO
}

function namesMatch(ingredientName: string, pantryName: string): boolean {
  const ing = ingredientName.toLowerCase().trim();
  const pan = pantryName.toLowerCase().trim();
  if (!ing || !pan) return false;
  if (ing === pan) return true;
  if (canonical(ing) === canonical(pan)) return true;
  return tokenSubsetMatch(ing, pan);
}

function hasEnough(ing: RecipeIngredient, item: PantryItem): boolean {
  if (ing.qtyBase == null || ing.dim == null) return true; // name-only: can't verify
  if (ing.dim === item.dim) return item.quantityBase >= ing.qtyBase;
  const needInPantryDim = convertBetween(ing.qtyBase, ing.dim, item.dim, {
    gramsPerUnit: item.gramsPerUnit,
    densityGPerMl: item.densityGPerMl,
  });
  if (needInPantryDim == null) return true; // uncomparable → still 'have'; planner flags it
  return item.quantityBase >= needInPantryDim;
}

/**
 * Matches parsed ingredients against the pantry (F6). Exact normalizedName,
 * then synonyms, then token-subset; ties go to the soonest-expiring row.
 */
export function matchIngredients(ingredients: RecipeIngredient[], pantry: PantryItem[]): PantryMatch[] {
  const usable = usablePantry(pantry);
  return ingredients.map((ing, ingredientIndex) => {
    if (ing.isStaple) {
      return { ingredientIndex, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null };
    }
    const name = ing.normalizedName ?? ing.name;
    if (!name) {
      return { ingredientIndex, status: 'missing', pantryItemId: null, pantryItemName: null, daysToExpiry: null };
    }
    const hit = usable.find((item) => namesMatch(name, item.normalizedName));
    if (!hit) {
      return { ingredientIndex, status: 'missing', pantryItemId: null, pantryItemName: null, daysToExpiry: null };
    }
    const status = hasEnough(ing, hit) ? 'have' : 'insufficient';
    return {
      ingredientIndex,
      status,
      pantryItemId: hit.id,
      pantryItemName: hit.name,
      daysToExpiry: hit.daysToExpiry,
    };
  });
}
