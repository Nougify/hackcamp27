import type { Allergen, DietCheck, DietFlag } from '@/contracts/domain';

interface RuleDef {
  keywords: string[];
  /** Line-level exceptions: if any matches, the listed keywords are skipped. */
  exceptions?: Array<{ when: RegExp; skip: string[] }>;
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Allergen keyword map (F7). Also imported read-only by workstream B for
 * `allergenTags` normalization — additive changes only.
 */
export const ALLERGEN_KEYWORDS: Record<Allergen, RuleDef> = {
  peanut: {
    keywords: ['peanut', 'groundnut', 'arachis oil', 'satay', 'peanut butter', 'peanut oil'],
  },
  tree_nut: {
    keywords: [
      'almond',
      'cashew',
      'walnut',
      'pecan',
      'pistachio',
      'hazelnut',
      'macadamia',
      'brazil nut',
      'pine nut',
      'praline',
      'marzipan',
      'nut butter',
      'nut',
      'chestnut',
      'hickory nut',
      'almond flour',
      'almond milk',
    ],
    exceptions: [{ when: /peanut/i, skip: ['nut butter', 'nut'] }],
  },
  sesame: {
    keywords: ['sesame', 'tahini', 'gomasio', "za'atar", 'zaatar', 'sesame oil', 'sesame seed'],
  },
  milk: {
    keywords: [
      'milk',
      'butter',
      'cream',
      'cheese',
      'yogurt',
      'yoghurt',
      'ghee',
      'whey',
      'casein',
      'buttermilk',
      'paneer',
      'dairy',
      'lactose',
      'kefir',
      'curd',
      'mozzarella',
      'cheddar',
      'parmesan',
      'feta',
      'ricotta',
      'brie',
      'gouda',
      'mascarpone',
      'halloumi',
      'burrata',
      'sour cream',
      'cream cheese',
      'cottage cheese',
      'ice cream',
      'custard',
    ],
    exceptions: [
      { when: /(coconut|almond|oat|soy|rice|cashew|hemp)\s+milk/i, skip: ['milk'] },
      { when: /(peanut|almond|cashew|sunflower|cocoa|shea)\s+butter/i, skip: ['butter'] },
      { when: /coconut\s+cream/i, skip: ['cream'] },
      { when: /vegan/i, skip: ['milk', 'butter', 'cream', 'cheese'] },
    ],
  },
  egg: {
    keywords: ['egg', 'mayonnaise', 'mayo', 'meringue', 'aioli', 'egg white', 'egg yolk'],
  },
  fish: {
    keywords: [
      'fish',
      'salmon',
      'tuna',
      'cod',
      'anchovy',
      'fish sauce',
      'worcestershire',
      'sardine',
      'trout',
      'halibut',
      'haddock',
      'tilapia',
      'mackerel',
      'herring',
      'sardines',
      'bass',
      'snapper',
      'sole',
      'flounder',
      'catfish',
      'eel',
      'caviar',
      'roe',
      'seafood',
      'surimi',
    ],
  },
  shellfish: {
    keywords: [
      'shrimp',
      'prawn',
      'crab',
      'lobster',
      'scallop',
      'clam',
      'mussel',
      'oyster',
      'crawfish',
      'crayfish',
      'langoustine',
      'octopus',
      'squid',
      'calamari',
      'abalone',
    ],
  },
  soy: {
    keywords: ['soy', 'soya', 'tofu', 'tempeh', 'edamame', 'miso', 'soy sauce', 'tamari', 'soy milk'],
  },
  wheat_gluten: {
    keywords: [
      'wheat',
      'flour',
      'barley',
      'rye',
      'spelt',
      'semolina',
      'farro',
      'couscous',
      'seitan',
      'malt',
      'bread',
      'pasta',
      'soy sauce',
      'noodle',
      'ramen',
      'udon',
      'soba',
      'breadcrumbs',
      'cracker',
      'pretzel',
      'bagel',
      'bun',
      'tortilla',
      'pastry',
      'cake',
      'cookie',
      'spaghetti',
      'lasagna',
      'lasagne',
      'penne',
      'fusilli',
      'linguine',
      'fettuccine',
      'macaroni',
      'orzo',
      'rigatoni',
      'farfalle',
      'tagliatelle',
      'pappardelle',
      'ravioli',
      'tortellini',
      'gnocchi',
      'dumpling',
      'wonton',
      'panko',
      'bulgur',
      'matzo',
      'crouton',
      'waffle',
      'pancake',
      'muffin',
      'brownie',
      'doughnut',
      'donut',
      'biscuit',
      'scone',
      'crepe',
      'phyllo',
      'pie crust',
    ],
    exceptions: [
      { when: /tamari|gluten[\s-]*free/i, skip: ['soy sauce'] },
      {
        when: /(almond|coconut|rice|chickpea|oat|buckwheat|corn|tapioca|sorghum|millet|quinoa|cassava)\s+flour|gluten[\s-]*free/i,
        skip: ['flour'],
      },
      {
        when: /gluten[\s-]*free/i,
        skip: ['bread', 'pasta', 'noodle', 'breadcrumbs', 'cracker', 'tortilla', 'bun', 'flour', 'spaghetti', 'pancake', 'waffle'],
      },
    ],
  },
  mustard: {
    keywords: ['mustard', 'dijon'],
  },
  sulphite: {
    keywords: ['sulphite', 'sulfite', 'wine', 'dried apricot', 'red wine vinegar', 'white wine'],
  },
};

const MEAT_KEYWORDS = [
  'meat',
  'chicken',
  'beef',
  'pork',
  'lamb',
  'bacon',
  'ham',
  'gelatin',
  'turkey',
  'duck',
  'goose',
  'sausage',
  'pepperoni',
  'salami',
  'prosciutto',
  'chorizo',
  'veal',
  'venison',
  'bison',
  'goat',
  'rabbit',
  'pancetta',
  'lard',
  'hot dog',
  'meatball',
  'ground beef',
  'ground pork',
  'ground turkey',
  'ground chicken',
  'steak',
  'ribs',
  'brisket',
  'meat stock',
  'bone broth',
];

const STOCK_EXCEPTION = /vegetable/i;

/**
 * Diet keyword map (F7). vegetarian/vegan compose the meat + fish + shellfish
 * lists; vegan additionally composes milk + egg + honey.
 */
export const DIET_KEYWORDS: Record<Exclude<DietFlag, 'high_protein'>, RuleDef> = {
  vegetarian: {
    keywords: [...MEAT_KEYWORDS, 'stock', 'broth', ...ALLERGEN_KEYWORDS.fish.keywords, ...ALLERGEN_KEYWORDS.shellfish.keywords],
    exceptions: [{ when: STOCK_EXCEPTION, skip: ['stock', 'broth'] }],
  },
  vegan: {
    keywords: [
      ...MEAT_KEYWORDS,
      'stock',
      'broth',
      ...ALLERGEN_KEYWORDS.fish.keywords,
      ...ALLERGEN_KEYWORDS.shellfish.keywords,
      ...ALLERGEN_KEYWORDS.milk.keywords,
      ...ALLERGEN_KEYWORDS.egg.keywords,
      'honey',
    ],
    exceptions: [
      { when: STOCK_EXCEPTION, skip: ['stock', 'broth'] },
      ...(ALLERGEN_KEYWORDS.milk.exceptions ?? []),
    ],
  },
  gluten_free: ALLERGEN_KEYWORDS.wheat_gluten,
  dairy_free: ALLERGEN_KEYWORDS.milk,
};

export type DietLine = string | { raw: string; normalizedName?: string | null };

function lineTexts(line: DietLine): { raw: string; haystacks: string[] } {
  if (typeof line === 'string') return { raw: line, haystacks: [line] };
  const haystacks = [line.raw];
  if (line.normalizedName) haystacks.push(line.normalizedName);
  return { raw: line.raw, haystacks };
}

function keywordHit(haystack: string, keyword: string): boolean {
  // Word-boundary match, plural-tolerant ("egg" matches "eggs", not "eggplant").
  const re = new RegExp(`\\b${esc(keyword)}s?\\b`, 'i');
  return re.test(haystack);
}

/**
 * Pure, deterministic diet/allergy enforcement (F7) — the ONLY enforcement
 * mechanism. Prompt instructions are a hint only.
 */
export function checkDiet(
  lines: DietLine[],
  profile: { diets: DietFlag[]; allergens: Allergen[] },
): DietCheck {
  const rules: Array<{ rule: DietFlag | Allergen; def: RuleDef }> = [];
  for (const allergen of profile.allergens) {
    rules.push({ rule: allergen, def: ALLERGEN_KEYWORDS[allergen] });
  }
  for (const diet of profile.diets) {
    if (diet === 'high_protein') continue; // soft ranking boost, not a filter
    rules.push({ rule: diet, def: DIET_KEYWORDS[diet] });
  }

  const violations: DietCheck['violations'] = [];
  for (const line of lines) {
    const { raw, haystacks } = lineTexts(line);
    for (const { rule, def } of rules) {
      const skipped = new Set<string>();
      for (const ex of def.exceptions ?? []) {
        if (haystacks.some((h) => ex.when.test(h))) {
          for (const k of ex.skip) skipped.add(k.toLowerCase());
        }
      }
      // Longest keywords first so "soy sauce" reports instead of "soy".
      const sorted = [...def.keywords].sort((a, b) => b.length - a.length);
      for (const keyword of sorted) {
        if (skipped.has(keyword.toLowerCase())) continue;
        if (haystacks.some((h) => keywordHit(h, keyword))) {
          violations.push({ ingredientRaw: raw, rule, matchedKeyword: keyword });
          break; // one violation per rule per line
        }
      }
    }
  }
  return { ok: violations.length === 0, violations };
}
