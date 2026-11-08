import type { CookingSession } from '../domain';
import { fixtureOriginalRecipe1 } from './recipes';

export const fixtureCookingSession: CookingSession = {
  id: '00000000-0000-4000-a000-000000000001',
  recipeId: fixtureOriginalRecipe1.recipeId,
  variantId: fixtureOriginalRecipe1.variantId,
  variantKind: 'original',
  status: 'in_progress',
  currentStep: 1,
  servingsPlanned: 4,
  startedAt: new Date().toISOString(),
  finishedAt: null,
};
