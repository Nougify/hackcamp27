import 'server-only';
import { z } from 'zod';

/**
 * Gemini JSON schemas (subset per §10.3.6) paired with Zod validators.
 * Every schema has a `*JsonSchema` (sent to Gemini as `responseSchema`) and
 * a `*Schema` (validates the parsed response in `geminiJson`).
 */

// ── Label extraction (§10.3.3) ──────────────────────────────────────────────

export const labelJsonSchema = {
  type: 'object',
  required: ['is_food_product', 'nutrition_panel_visible', 'basis', 'confidence'],
  properties: {
    is_food_product: { type: 'boolean' },
    name: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] },
    barcode_digits_if_visible: { type: ['string', 'null'] },
    package_quantity_text: { type: ['string', 'null'] },
    package_quantity_value: { type: ['number', 'null'] },
    package_quantity_unit: { type: ['string', 'null'], enum: ['g', 'kg', 'ml', 'l', 'oz', 'lb', 'fl_oz', 'count', null] },
    nutrition_panel_visible: { type: 'boolean' },
    serving_size_text: { type: ['string', 'null'] },
    serving_size_value: { type: ['number', 'null'] },
    serving_size_unit: { type: ['string', 'null'], enum: ['g', 'ml', null] },
    basis: { type: 'string', enum: ['per_serving', 'per_100g', 'per_100ml', 'unknown'] },
    calories_kcal: { type: ['number', 'null'] },
    fat_g: { type: ['number', 'null'] },
    saturated_fat_g: { type: ['number', 'null'] },
    trans_fat_g: { type: ['number', 'null'] },
    carbohydrate_g: { type: ['number', 'null'] },
    fibre_g: { type: ['number', 'null'] },
    sugars_g: { type: ['number', 'null'] },
    protein_g: { type: ['number', 'null'] },
    sodium_mg: { type: ['number', 'null'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: ['string', 'null'] },
  },
} as const;

export const labelSchema = z.object({
  is_food_product: z.boolean(),
  name: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  barcode_digits_if_visible: z.string().nullable().optional(),
  package_quantity_text: z.string().nullable().optional(),
  package_quantity_value: z.number().nullable().optional(),
  package_quantity_unit: z.enum(['g', 'kg', 'ml', 'l', 'oz', 'lb', 'fl_oz', 'count']).nullable().optional(),
  nutrition_panel_visible: z.boolean(),
  serving_size_text: z.string().nullable().optional(),
  serving_size_value: z.number().nullable().optional(),
  serving_size_unit: z.enum(['g', 'ml']).nullable().optional(),
  basis: z.enum(['per_serving', 'per_100g', 'per_100ml', 'unknown']),
  calories_kcal: z.number().nullable().optional(),
  fat_g: z.number().nullable().optional(),
  saturated_fat_g: z.number().nullable().optional(),
  trans_fat_g: z.number().nullable().optional(),
  carbohydrate_g: z.number().nullable().optional(),
  fibre_g: z.number().nullable().optional(),
  sugars_g: z.number().nullable().optional(),
  protein_g: z.number().nullable().optional(),
  sodium_mg: z.number().nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().nullable().optional(),
});
export type LabelExtraction = z.infer<typeof labelSchema>;

export const LABEL_SYSTEM_PROMPT = [
  'Transcribe only values printed on the label. Never estimate or use outside knowledge.',
  'Use null when a value is not legible.',
  'Canadian Nutrition Facts tables are per serving, with the serving size shown in a household measure and in grams. Report the basis accordingly.',
  'Calories are kcal. If only kJ is printed, return null for calories and mention it in notes.',
  'Ignore % Daily Value columns.',
  "If the panel has two columns (as sold / prepared), use 'as sold'.",
].join(' ');

// ── Expiry extraction (§10.3.4) ─────────────────────────────────────────────

export const expiryJsonSchema = {
  type: 'object',
  required: ['date_type', 'year_was_printed', 'ambiguous_order', 'confidence'],
  properties: {
    raw_text: { type: ['string', 'null'] },
    date_type: { type: 'string', enum: ['best_before', 'expiry', 'use_by', 'packaged_on', 'sell_by', 'unknown'] },
    year: { type: ['integer', 'null'] },
    month: { type: ['integer', 'null'] },
    day: { type: ['integer', 'null'] },
    year_was_printed: { type: 'boolean' },
    ambiguous_order: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
} as const;

export const expirySchema = z.object({
  raw_text: z.string().nullable().optional(),
  date_type: z.enum(['best_before', 'expiry', 'use_by', 'packaged_on', 'sell_by', 'unknown']),
  year: z.number().int().nullable().optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
  year_was_printed: z.boolean(),
  ambiguous_order: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type ExpiryExtraction = z.infer<typeof expirySchema>;

export const EXPIRY_SYSTEM_PROMPT = [
  'Canadian dates show the year first (if at all), then month, then day.',
  "Month codes are JA FE MR AL MA JN JL AU SE OC NO DE. Note MA = May and AL = April (French 'avril').",
  'Example: "BB/MA 2026 NO 15" is 2026-11-15. Example: "EXP 11/20/26" is US MM/DD/YY, 2026-11-20.',
  '"PKD" / "packaged on" / "empaqueté le" means packaged_on.',
  'Ignore lot and batch codes.',
  'Always return raw_text.',
].join(' ');

// ── Receipt extraction ──────────────────────────────────────────────────────

export const receiptJsonSchema = {
  type: 'object',
  required: ['items', 'confidence'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'is_food_item'],
        properties: {
          name: { type: 'string' },
          is_food_item: { type: 'boolean' },
          quantity: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], enum: ['g', 'kg', 'ml', 'l', 'oz', 'lb', 'fl_oz', 'count', null] },
        },
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: ['string', 'null'] },
  },
} as const;

export const receiptSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      is_food_item: z.boolean(),
      quantity: z.number().nullable().optional(),
      unit: z.enum(['g', 'kg', 'ml', 'l', 'oz', 'lb', 'fl_oz', 'count']).nullable().optional(),
    }),
  ),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().nullable().optional(),
});
export type ReceiptExtraction = z.infer<typeof receiptSchema>;

export const RECEIPT_SYSTEM_PROMPT = [
  'List every purchased line item printed on this grocery receipt, in the order printed.',
  "Set is_food_item=true for groceries, drinks, snacks and prepared food. Set it false for household goods, " +
    'bags, bottle/can deposits, tax, subtotal, total, tender/change, loyalty points and discount/coupon lines.',
  'Only infer a quantity and unit when the line itself shows an explicit multiplier (e.g. "2 @ $1.99" → quantity 2, unit count, ' +
    'or "1.36 kg @ ...") — otherwise leave both null. Never invent an item that is not printed on the receipt.',
].join(' ');

// ── Adaptation (§10.3.5) ────────────────────────────────────────────────────

export const adaptationJsonSchema = {
  type: 'object',
  required: ['substitutions', 'ingredients', 'stepChanges', 'warnings'],
  properties: {
    substitutions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['missingIngredient', 'substitute', 'pantryItemId', 'reason', 'impact'],
        properties: {
          missingIngredient: { type: 'string' },
          substitute: { type: ['string', 'null'] },
          pantryItemId: { type: ['string', 'null'] },
          quantity: { type: ['string', 'null'] },
          reason: { type: 'string' },
          impact: { type: 'string', enum: ['minimal', 'moderate', 'significant'] },
        },
      },
    },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'changed'],
        properties: { text: { type: 'string' }, changed: { type: 'boolean' } },
      },
    },
    stepChanges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['stepIndex', 'newText'],
        properties: { stepIndex: { type: 'integer' }, newText: { type: 'string' } },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const adaptationSchema = z.object({
  substitutions: z.array(
    z.object({
      missingIngredient: z.string(),
      substitute: z.string().nullable(),
      pantryItemId: z.string().nullable(),
      quantity: z.string().nullable().optional(),
      reason: z.string(),
      impact: z.enum(['minimal', 'moderate', 'significant']),
    }),
  ),
  ingredients: z.array(z.object({ text: z.string(), changed: z.boolean() })),
  stepChanges: z.array(z.object({ stepIndex: z.number().int(), newText: z.string() })),
  warnings: z.array(z.string()),
});
export type AdaptationOutput = z.infer<typeof adaptationSchema>;

export const ADAPT_SYSTEM_PROMPT =
  'Only substitute the listed missing ingredients using pantry items. ' +
  'Never introduce excluded allergens. Do not rewrite unchanged steps.';

// ── Ingredient normalization (F6 step 6, batched fallback) ──────────────────

export const normalizeJsonSchema = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['raw', 'qty', 'unit', 'name', 'dim'],
        properties: {
          raw: { type: 'string' },
          qty: { type: ['number', 'null'] },
          unit: {
            type: ['string', 'null'],
            enum: ['g', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz', 'pcs', null],
          },
          name: { type: ['string', 'null'] },
          dim: { type: ['string', 'null'], enum: ['mass', 'volume', 'count', null] },
        },
      },
    },
  },
} as const;

export const normalizeSchema = z.object({
  items: z.array(
    z.object({
      raw: z.string(),
      qty: z.number().nullable(),
      unit: z.enum(['g', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz', 'pcs']).nullable(),
      name: z.string().nullable(),
      dim: z.enum(['mass', 'volume', 'count']).nullable(),
    }),
  ),
});
export type NormalizeOutput = z.infer<typeof normalizeSchema>;

export const NORMALIZE_SYSTEM_PROMPT =
  'Parse each recipe ingredient line into a quantity, unit, short ingredient name and dimension. ' +
  'Use null for anything not stated. Never invent quantities. Reply with the same lines in the same order.';
