import type { DailyTotals, MealLog } from '../domain';

const today = new Date().toISOString().slice(0, 10);

export const fixtureMealLogs: MealLog[] = [
  {
    id: '00000000-0000-4000-b000-000000000001',
    eatenAt: `${today}T08:00:00.000Z`,
    localDate: today,
    source: 'manual',
    label: 'Greek yogurt with honey',
    servings: 1,
    kcal: 180,
    proteinG: 17,
    carbsG: 12,
    fatG: 4,
    cookingSessionId: null,
    pantryItemId: null,
  },
  {
    id: '00000000-0000-4000-b000-000000000002',
    eatenAt: `${today}T12:30:00.000Z`,
    localDate: today,
    source: 'barcode',
    label: 'Chicken Caesar wrap',
    servings: 1,
    kcal: 520,
    proteinG: 28,
    carbsG: 40,
    fatG: 24,
    cookingSessionId: null,
    pantryItemId: null,
  },
  {
    id: '00000000-0000-4000-b000-000000000003',
    eatenAt: `${today}T18:45:00.000Z`,
    localDate: today,
    source: 'cooking_session',
    label: 'One-Pan Garlic Chicken with Spinach',
    servings: 1,
    kcal: 310,
    proteinG: 38,
    carbsG: 4,
    fatG: 15,
    cookingSessionId: '00000000-0000-4000-a000-000000000001',
    pantryItemId: null,
  },
];

export const fixtureDailyTotals: DailyTotals = {
  date: today,
  kcal: 1010,
  proteinG: 83,
  carbsG: 56,
  fatG: 43,
  entries: 3,
  kcalGoal: 2000,
  proteinGoalG: 120,
};
