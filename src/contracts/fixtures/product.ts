// Fixture: Open Food Facts product (Greek yogurt) matching the pantry yogurt gtin.
import type { Product } from '@/contracts';

export const productFixture: Product = {
  gtin: '5201054012345',
  name: '0% Greek Strained Yogurt',
  brand: 'Fage',
  imageUrl: 'https://images.openfoodfacts.org/images/products/520/105/401/2345/front_en.100.400.jpg',
  categories: ['Dairies', 'Fermented foods', 'Fermented milk products', 'Yogurts', 'Greek yogurts'],
  allergenTags: ['milk'],
  packageQuantity: { value: 500, unit: 'g', text: '500 g' },
  servingSize: { value: 170, unit: 'g', text: '170 g' },
  basis: '100g',
  per100: {
    energyKcal: 59,
    proteinG: 10,
    carbohydrateG: 3.6,
    fatG: 0.5,
    saturatedFatG: 0.3,
    sugarsG: 3.6,
    fibreG: 0,
    sodiumMg: 36,
  },
  perServing: {
    energyKcal: 100,
    proteinG: 17,
    carbohydrateG: 6.1,
    fatG: 0.9,
    saturatedFatG: 0.5,
    sugarsG: 6.1,
    fibreG: 0,
    sodiumMg: 61,
  },
  source: 'openfoodfacts',
  attribution: 'Open Food Facts, ODbL',
  fetchedAt: '2026-11-06T18:30:00Z',
};
