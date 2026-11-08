import type { AdaptedRecipe, OriginalRecipe, PantryMatch, RecipeCandidate, RecipeScore } from '../domain';

const retrievedAt = new Date().toISOString();

export const fixtureOriginalRecipe1: OriginalRecipe = {
  kind: 'original',
  recipeId: '00000000-0000-4000-9000-000000000001',
  variantId: '00000000-0000-4000-9001-000000000001',
  title: 'One-Pan Garlic Chicken with Spinach',
  source: {
    url: 'https://example-recipes.test/garlic-chicken-spinach',
    siteName: 'Example Recipes',
    author: 'Jamie Cook',
    retrievedAt,
    extractionMethod: 'jsonld',
  },
  servings: 4,
  yieldRaw: '4 servings',
  ingredients: [
    { raw: '4 boneless, skinless chicken thighs', qty: 4, unit: 'pcs', name: 'chicken thigh', normalizedName: 'chicken thigh', dim: 'count', qtyBase: 4, isStaple: false, flags: [] },
    { raw: '4 cups baby spinach', qty: 4, unit: 'cup', name: 'spinach', normalizedName: 'spinach', dim: 'volume', qtyBase: 946.35, isStaple: false, flags: [] },
    { raw: '3 cloves garlic, minced', qty: 3, unit: 'pcs', name: 'garlic', normalizedName: 'garlic', dim: 'count', qtyBase: 3, isStaple: false, flags: [] },
    { raw: '1 lemon, juiced', qty: 1, unit: 'pcs', name: 'lemon', normalizedName: 'lemon', dim: 'count', qtyBase: 1, isStaple: false, flags: [] },
    { raw: '2 tbsp olive oil', qty: 2, unit: 'tbsp', name: 'olive oil', normalizedName: 'olive oil', dim: 'volume', qtyBase: 29.57, isStaple: true, flags: [] },
    { raw: 'Salt and pepper, to taste', qty: null, unit: null, name: 'salt and pepper', normalizedName: 'salt and pepper', dim: null, qtyBase: null, isStaple: true, flags: ['negligible'] },
  ],
  steps: [
    { index: 0, text: 'Season chicken thighs with salt and pepper.', timerSeconds: null },
    { index: 1, text: 'Heat olive oil in a large skillet over medium-high heat and sear the chicken 6 minutes per side.', timerSeconds: 360 },
    { index: 2, text: 'Add garlic and cook for 1 minute, then stir in spinach until wilted.', timerSeconds: 60 },
    { index: 3, text: 'Squeeze lemon juice over the pan and serve.', timerSeconds: null },
  ],
  times: { prepMin: 10, cookMin: 20, totalMin: 30 },
  declaredDiet: [],
};

export const fixtureOriginalRecipe2: OriginalRecipe = {
  kind: 'original',
  recipeId: '00000000-0000-4000-9000-000000000002',
  variantId: '00000000-0000-4000-9001-000000000002',
  title: 'Simple Buttermilk Pancakes',
  source: {
    url: 'https://example-recipes.test/buttermilk-pancakes',
    siteName: 'Example Recipes',
    author: 'Jamie Cook',
    retrievedAt,
    extractionMethod: 'jsonld',
  },
  servings: 2,
  yieldRaw: '2 servings',
  ingredients: [
    { raw: '2 cups buttermilk', qty: 2, unit: 'cup', name: 'buttermilk', normalizedName: 'buttermilk', dim: 'volume', qtyBase: 473.18, isStaple: false, flags: [] },
    { raw: '2 eggs', qty: 2, unit: 'pcs', name: 'egg', normalizedName: 'egg', dim: 'count', qtyBase: 2, isStaple: false, flags: [] },
    { raw: '1 tsp salt', qty: 1, unit: 'tsp', name: 'salt', normalizedName: 'salt', dim: 'volume', qtyBase: 4.93, isStaple: true, flags: [] },
    { raw: '2 tbsp vegetable oil', qty: 2, unit: 'tbsp', name: 'vegetable oil', normalizedName: 'vegetable oil', dim: 'volume', qtyBase: 29.57, isStaple: true, flags: [] },
  ],
  steps: [
    { index: 0, text: 'Whisk the eggs and buttermilk together.', timerSeconds: null },
    { index: 1, text: 'Heat oil in a skillet over medium heat.', timerSeconds: null },
    { index: 2, text: 'Pour 1/4 cup batter per pancake and cook 2 minutes per side.', timerSeconds: 120 },
  ],
  times: { prepMin: 5, cookMin: 10, totalMin: 15 },
  declaredDiet: [],
};

export const fixtureAdaptedRecipe2: AdaptedRecipe = {
  kind: 'ai_adapted',
  label: 'AI-adapted',
  recipeId: fixtureOriginalRecipe2.recipeId,
  variantId: '00000000-0000-4000-9002-000000000002',
  basedOnVariantId: fixtureOriginalRecipe2.variantId,
  substitutions: [
    {
      missingIngredient: '2 cups buttermilk',
      substitute: 'Greek yogurt, thinned with a splash of water',
      pantryItemId: '00000000-0000-4000-8000-000000000003',
      quantity: '2 cups (thinned)',
      reason: 'Greek yogurt has similar acidity and fat content to buttermilk',
      impact: 'minimal',
    },
  ],
  ingredients: [
    {
      text: '2 cups Greek yogurt, thinned with a splash of water',
      changed: true,
      parsed: { raw: '2 cups Greek yogurt, thinned with a splash of water', qty: 2, unit: 'cup', name: 'greek yogurt', normalizedName: 'greek yogurt', dim: 'volume', qtyBase: 473.18, isStaple: false, flags: [] },
    },
    { text: '2 eggs', changed: false, parsed: fixtureOriginalRecipe2.ingredients[1]! },
    { text: '1 tsp salt', changed: false, parsed: fixtureOriginalRecipe2.ingredients[2]! },
    { text: '2 tbsp vegetable oil', changed: false, parsed: fixtureOriginalRecipe2.ingredients[3]! },
  ],
  steps: [
    { index: 0, text: 'Whisk the eggs and thinned Greek yogurt together.', timerSeconds: null, changed: true },
    { index: 1, text: 'Heat oil in a skillet over medium heat.', timerSeconds: null, changed: false },
    { index: 2, text: 'Pour 1/4 cup batter per pancake and cook 2 minutes per side.', timerSeconds: 120, changed: false },
  ],
  warnings: ['Batter may be slightly thicker than with real buttermilk; thin with extra water if needed.'],
  model: 'gemini-3.8-flash',
  generatedAt: retrievedAt,
};

const matches1: PantryMatch[] = [
  { ingredientIndex: 0, status: 'have', pantryItemId: '00000000-0000-4000-8000-000000000002', pantryItemName: 'Chicken thigh, boneless', daysToExpiry: 2 },
  { ingredientIndex: 1, status: 'have', pantryItemId: '00000000-0000-4000-8000-000000000001', pantryItemName: 'Spinach, baby', daysToExpiry: 1 },
  { ingredientIndex: 2, status: 'have', pantryItemId: '00000000-0000-4000-8000-000000000006', pantryItemName: 'Garlic', daysToExpiry: 30 },
  { ingredientIndex: 3, status: 'have', pantryItemId: '00000000-0000-4000-8000-000000000008', pantryItemName: 'Lemon', daysToExpiry: 14 },
  { ingredientIndex: 4, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
  { ingredientIndex: 5, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
];

const matches2: PantryMatch[] = [
  { ingredientIndex: 0, status: 'missing', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
  { ingredientIndex: 1, status: 'have', pantryItemId: '00000000-0000-4000-8000-000000000009', pantryItemName: 'Eggs, large', daysToExpiry: 18 },
  { ingredientIndex: 2, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
  { ingredientIndex: 3, status: 'staple', pantryItemId: null, pantryItemName: null, daysToExpiry: null },
];

const score1: RecipeScore = { coverage: 1, expiryScore: 1, missingCount: 0, proteinPerServingG: 38, score: 0.85 };
const score2: RecipeScore = { coverage: 0.5, expiryScore: 0.06, missingCount: 1, proteinPerServingG: 7, score: 0.171 };

export const fixtureRecipeCandidate1: RecipeCandidate = {
  recipeId: fixtureOriginalRecipe1.recipeId,
  title: fixtureOriginalRecipe1.title,
  source: fixtureOriginalRecipe1.source,
  totalMin: fixtureOriginalRecipe1.times.totalMin,
  servings: fixtureOriginalRecipe1.servings,
  score: score1,
  usesExpiring: [
    { pantryItemId: '00000000-0000-4000-8000-000000000001', name: 'Spinach, baby', daysToExpiry: 1 },
    { pantryItemId: '00000000-0000-4000-8000-000000000002', name: 'Chicken thigh, boneless', daysToExpiry: 2 },
  ],
  matches: matches1,
  nutrition: {
    perServing: { energyKcal: 310, proteinG: 38, carbohydrateG: 4, fatG: 15 },
    coveragePct: 100,
    basedOn: 4,
    total: 4,
    estimatedFields: [],
  },
};

export const fixtureRecipeCandidate2: RecipeCandidate = {
  recipeId: fixtureOriginalRecipe2.recipeId,
  title: fixtureOriginalRecipe2.title,
  source: fixtureOriginalRecipe2.source,
  totalMin: fixtureOriginalRecipe2.times.totalMin,
  servings: fixtureOriginalRecipe2.servings,
  score: score2,
  usesExpiring: [],
  matches: matches2,
  nutrition: {
    perServing: { energyKcal: 180, proteinG: 7, carbohydrateG: 3, fatG: 9 },
    coveragePct: 50,
    basedOn: 1,
    total: 2,
    estimatedFields: ['ingredient 1: buttermilk has no pantry match'],
  },
};
