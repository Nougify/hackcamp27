import { describe, expect, it } from 'vitest';
import type { Product, ProductDraft } from '@/contracts/domain';
import { asBarcodeFormat, createReadConfirmer, draftToFormInitial, fitWithin, productToFormInitial } from './pure';

describe('createReadConfirmer', () => {
  it('accepts on the second identical read, once', () => {
    const c = createReadConfirmer();
    expect([c('a'), c('a'), c('a')]).toEqual([false, true, false]);
  });
  it('restarts when the value changes', () => {
    const c = createReadConfirmer();
    expect([c('a'), c('b'), c('a'), c('a')]).toEqual([false, false, false, true]);
  });
});

it('keeps only known barcode formats', () => {
  expect(asBarcodeFormat('upc_e')).toBe('upc_e');
  expect(asBarcodeFormat('qr_code')).toBe('unknown');
});

it('fits an image within the long edge without enlarging', () => {
  expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
});

const product: Product = {
  gtin: '3017620422003',
  name: 'Nutella',
  brand: 'Ferrero',
  imageUrl: null,
  categories: [],
  allergenTags: ['milk'],
  packageQuantity: { value: 400, unit: 'g', text: '400 g' },
  servingSize: { value: 15, unit: 'g', text: '15 g' },
  basis: '100g',
  per100: { energyKcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9 },
  perServing: null,
  source: 'dataandapis',
  attribution: 'Open Food Facts, ODbL',
  fetchedAt: '2026-11-08T00:00:00Z',
};

describe('productToFormInitial', () => {
  it('prefills the quantity from the package', () => {
    expect(productToFormInitial(product)).toMatchObject({ quantity: 400, displayUnit: 'g', nutritionBasis: '100g', servingSizeBase: 15 });
  });
  it('maps counts to pieces and leaves an unknown size blank', () => {
    expect(productToFormInitial({ ...product, packageQuantity: { value: 12, unit: 'count', text: null } }).displayUnit).toBe('pcs');
    expect(productToFormInitial({ ...product, packageQuantity: null, basis: '100ml' })).toMatchObject({ quantity: null, displayUnit: 'ml' });
  });
  it('leaves nutrition empty when the provider has none', () => {
    expect(productToFormInitial({ ...product, per100: { energyKcal: null, proteinG: null, carbohydrateG: null, fatG: null } }).nutrition).toBeNull();
  });
});

const draft: ProductDraft = {
  gtin: null,
  name: 'Oats',
  brand: null,
  packageQuantity: { value: 1, unit: 'kg' },
  servingSize: { value: 40, unit: 'g', text: '1 cup (40 g)' },
  basis: 'serving',
  nutrients: { energyKcal: 150, proteinG: 5, carbohydrateG: 27, fatG: null },
  allergenTags: [],
  source: 'gemini_photo',
};

describe('draftToFormInitial', () => {
  it('converts a per-serving label to per 100 g', () => {
    const { initial, nutritionDropped } = draftToFormInitial(draft);
    expect(initial).toMatchObject({ quantity: 1, displayUnit: 'kg', nutritionBasis: '100g', servingSizeBase: 40 });
    expect(initial.nutrition).toEqual({ energyKcal: 375, proteinG: 12.5, carbohydrateG: 67.5, fatG: null });
    expect(nutritionDropped).toBe(false);
  });
  it('uses per 100 ml for a liquid serving', () => {
    expect(draftToFormInitial({ ...draft, servingSize: { value: 250, unit: 'ml', text: null } }).initial.nutritionBasis).toBe('100ml');
  });
  it('drops per-serving numbers with no serving weight', () => {
    const r = draftToFormInitial({ ...draft, servingSize: null });
    expect(r.initial.nutrition).toBeNull();
    expect(r.nutritionDropped).toBe(true);
  });
  it('passes per-100 labels through', () => {
    expect(draftToFormInitial({ ...draft, basis: '100ml' }).initial).toMatchObject({ nutritionBasis: '100ml', nutrition: { energyKcal: 150 } });
  });
});
