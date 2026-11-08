import type { Product } from '../domain';

export const fixtureProduct: Product = {
  gtin: '0009800895776',
  name: 'Greek Yogurt, Plain',
  brand: 'Astro',
  imageUrl: null,
  categories: ['dairy', 'yogurts'],
  allergenTags: ['milk'],
  packageQuantity: { value: 650, unit: 'g', text: '650 g' },
  servingSize: { value: 100, unit: 'g', text: '100 g' },
  basis: '100g',
  per100: {
    energyKcal: 59,
    proteinG: 10,
    carbohydrateG: 3.6,
    fatG: 0.4,
    saturatedFatG: 0.1,
    sugarsG: 3.6,
    fibreG: 0,
    sodiumMg: 36,
  },
  perServing: null,
  source: 'openfoodfacts',
  attribution: 'Open Food Facts, ODbL',
  fetchedAt: new Date().toISOString(),
};
