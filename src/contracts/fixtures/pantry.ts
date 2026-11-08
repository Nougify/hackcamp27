import type { Nutrients, PantryItem } from '../domain';
import { daysFromNow, daysToExpiry } from './dates';

function n(partial: Partial<Nutrients>): Nutrients {
  return {
    energyKcal: null,
    proteinG: null,
    carbohydrateG: null,
    fatG: null,
    saturatedFatG: null,
    sugarsG: null,
    fibreG: null,
    sodiumMg: null,
    ...partial,
  };
}

function item(p: {
  id: string;
  name: string;
  normalizedName: string;
  dim: PantryItem['dim'];
  quantityBase: number;
  displayUnit: PantryItem['displayUnit'];
  quantityDisplay: string;
  gramsPerUnit?: number | null;
  densityGPerMl?: number | null;
  expiryInDays?: number | null;
  nutrition: Nutrients;
  allergenTags?: PantryItem['allergenTags'];
}): PantryItem {
  const expiryDate = p.expiryInDays == null ? null : daysFromNow(p.expiryInDays);
  return {
    id: p.id,
    gtin: null,
    name: p.name,
    normalizedName: p.normalizedName,
    brand: null,
    dim: p.dim,
    quantityBase: p.quantityBase,
    displayUnit: p.displayUnit,
    quantityDisplay: p.quantityDisplay,
    gramsPerUnit: p.gramsPerUnit ?? null,
    densityGPerMl: p.densityGPerMl ?? null,
    expiryDate,
    expirySource: expiryDate ? 'manual' : null,
    daysToExpiry: expiryDate ? daysToExpiry(expiryDate) : null,
    nutritionBasis: p.dim === 'count' ? 'unit' : p.dim === 'volume' ? '100ml' : '100g',
    nutrition: p.nutrition,
    perServing: null,
    servingSizeBase: null,
    allergenTags: p.allergenTags ?? [],
    source: 'manual',
    userVerified: true,
    updatedAt: new Date().toISOString(),
  };
}

export const fixturePantry: PantryItem[] = [
  item({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Spinach, baby',
    normalizedName: 'spinach',
    dim: 'mass',
    quantityBase: 200,
    displayUnit: 'g',
    quantityDisplay: '200 g',
    expiryInDays: 1,
    nutrition: n({ energyKcal: 23, proteinG: 2.9, carbohydrateG: 3.6, fatG: 0.4, fibreG: 2.2, sodiumMg: 79 }),
  }),
  item({
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Chicken thigh, boneless',
    normalizedName: 'chicken thigh',
    dim: 'mass',
    quantityBase: 500,
    displayUnit: 'g',
    quantityDisplay: '500 g',
    expiryInDays: 2,
    nutrition: n({ energyKcal: 165, proteinG: 31, carbohydrateG: 0, fatG: 7 }),
  }),
  item({
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Greek yogurt, plain',
    normalizedName: 'greek yogurt',
    dim: 'mass',
    quantityBase: 650,
    displayUnit: 'g',
    quantityDisplay: '650 g',
    expiryInDays: 3,
    nutrition: n({ energyKcal: 59, proteinG: 10, carbohydrateG: 3.6, fatG: 0.4, sugarsG: 3.6 }),
    allergenTags: ['milk'],
  }),
  item({
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Rice, basmati',
    normalizedName: 'rice',
    dim: 'mass',
    quantityBase: 2000,
    displayUnit: 'g',
    quantityDisplay: '2 kg',
    expiryInDays: null,
    nutrition: n({ energyKcal: 130, proteinG: 2.7, carbohydrateG: 28.2, fatG: 0.3 }),
  }),
  item({
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Onion, yellow',
    normalizedName: 'onion',
    dim: 'count',
    quantityBase: 4,
    displayUnit: 'pcs',
    quantityDisplay: '4 pcs',
    gramsPerUnit: 110,
    expiryInDays: 21,
    nutrition: n({ energyKcal: 40, proteinG: 1.1, carbohydrateG: 9.3, fatG: 0.1 }),
  }),
  item({
    id: '00000000-0000-4000-8000-000000000006',
    name: 'Garlic',
    normalizedName: 'garlic',
    dim: 'count',
    quantityBase: 6,
    displayUnit: 'pcs',
    quantityDisplay: '6 cloves',
    gramsPerUnit: 5,
    expiryInDays: 30,
    nutrition: n({ energyKcal: 149, proteinG: 6.4, carbohydrateG: 33.1, fatG: 0.5 }),
  }),
  item({
    id: '00000000-0000-4000-8000-000000000007',
    name: 'Canned tomatoes, diced',
    normalizedName: 'canned tomatoes',
    dim: 'count',
    quantityBase: 2,
    displayUnit: 'pcs',
    quantityDisplay: '2 cans',
    gramsPerUnit: 400,
    expiryInDays: 365,
    nutrition: n({ energyKcal: 32, proteinG: 1.6, carbohydrateG: 7, fatG: 0.3 }),
  }),
  item({
    id: '00000000-0000-4000-8000-000000000008',
    name: 'Lemon',
    normalizedName: 'lemon',
    dim: 'count',
    quantityBase: 3,
    displayUnit: 'pcs',
    quantityDisplay: '3 pcs',
    gramsPerUnit: 100,
    expiryInDays: 14,
    nutrition: n({ energyKcal: 29, proteinG: 1.1, carbohydrateG: 9.3, fatG: 0.3 }),
  }),
  item({
    id: '00000000-0000-4000-8000-000000000009',
    name: 'Eggs, large',
    normalizedName: 'egg',
    dim: 'count',
    quantityBase: 6,
    displayUnit: 'pcs',
    quantityDisplay: '6 pcs',
    gramsPerUnit: 50,
    expiryInDays: 18,
    nutrition: n({ energyKcal: 143, proteinG: 12.6, carbohydrateG: 0.7, fatG: 9.5 }),
    allergenTags: ['egg'],
  }),
  item({
    id: '00000000-0000-4000-8000-00000000000a',
    name: 'Milk, 2%',
    normalizedName: 'milk',
    dim: 'volume',
    quantityBase: 1000,
    displayUnit: 'ml',
    quantityDisplay: '1 L',
    densityGPerMl: 1.03,
    expiryInDays: 5,
    nutrition: n({ energyKcal: 50, proteinG: 3.3, carbohydrateG: 4.8, fatG: 2 }),
    allergenTags: ['milk'],
  }),
  item({
    id: '00000000-0000-4000-8000-00000000000b',
    name: 'Cheddar cheese',
    normalizedName: 'cheddar cheese',
    dim: 'mass',
    quantityBase: 250,
    displayUnit: 'g',
    quantityDisplay: '250 g',
    expiryInDays: 20,
    nutrition: n({ energyKcal: 403, proteinG: 25, carbohydrateG: 1.3, fatG: 33 }),
    allergenTags: ['milk'],
  }),
  item({
    id: '00000000-0000-4000-8000-00000000000c',
    name: 'Bread, whole wheat',
    normalizedName: 'bread',
    dim: 'count',
    quantityBase: 1,
    displayUnit: 'pcs',
    quantityDisplay: '1 loaf',
    gramsPerUnit: 600,
    expiryInDays: 4,
    nutrition: n({ energyKcal: 247, proteinG: 13, carbohydrateG: 41, fatG: 3.4, fibreG: 7 }),
    allergenTags: ['wheat_gluten'],
  }),
];
