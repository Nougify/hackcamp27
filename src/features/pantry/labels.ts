import type { Allergen, DietFlag, DisplayUnit } from '@/contracts/domain';

// UI labels. Records keyed by the contract unions, so adding an enum value fails to compile here.

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  peanut: 'Peanuts',
  tree_nut: 'Tree nuts',
  sesame: 'Sesame',
  milk: 'Milk',
  egg: 'Eggs',
  fish: 'Fish',
  shellfish: 'Shellfish (crustaceans & molluscs)',
  soy: 'Soy',
  wheat_gluten: 'Wheat & gluten (incl. barley, oats, rye, triticale)',
  mustard: 'Mustard',
  sulphite: 'Sulphites',
};
export const ALLERGENS = Object.keys(ALLERGEN_LABELS) as Allergen[];

export const DIET_LABELS: Record<DietFlag, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  gluten_free: 'Gluten-free',
  dairy_free: 'Dairy-free',
  high_protein: 'High protein',
};
export const DIETS = Object.keys(DIET_LABELS) as DietFlag[];

export const UNIT_LABELS: Record<DisplayUnit, string> = {
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lb',
  ml: 'ml',
  l: 'L',
  tsp: 'tsp',
  tbsp: 'tbsp',
  cup: 'cup',
  fl_oz: 'fl oz',
  pcs: 'pieces',
};
