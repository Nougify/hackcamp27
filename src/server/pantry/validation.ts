import { z } from 'zod';
import type { Allergen, DietFlag, DisplayUnit } from '@/contracts/domain';
import type { CreatePantryItemRequest, UpdateMeRequest, UpdatePantryItemRequest } from '@/contracts/api';
import { isDisplayUnit } from '@/lib/units';
import { ALL_ALLERGENS } from './allergens';
import { isIsoDate } from './dates';

// Zod schemas for Workstream B request bodies (SPEC §7, §13). Typed against the contracts with
// `satisfies`-style checks below, so a contract change breaks compilation here.

export const DIET_FLAGS = ['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'high_protein'] as const satisfies readonly DietFlag[];

const dietFlag = z.enum(DIET_FLAGS);
const allergen = z.enum(ALL_ALLERGENS as [Allergen, ...Allergen[]]);
const displayUnit = z.string().refine(isDisplayUnit, 'unknown unit') as unknown as z.ZodType<DisplayUnit>;
const isoDate = z.string().refine(isIsoDate, 'must be a real date (YYYY-MM-DD)');
const nonNegative = z.number().finite().min(0);
const positive = z.number().finite().gt(0);

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Unique values, order kept. */
const uniq = <T>(xs: T[]) => [...new Set(xs)];

export const updateMeSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    tz: z.string().refine(isValidTimeZone, 'must be an IANA time zone').optional(),
    dailyKcalGoal: z.number().int().min(1).max(20_000).nullable().optional(),
    dailyProteinGoalG: z.number().finite().min(0).max(1_000).nullable().optional(),
    diets: z.array(dietFlag).max(DIET_FLAGS.length).transform(uniq).optional(),
    allergens: z.array(allergen).max(ALL_ALLERGENS.length).transform(uniq).optional(),
    pastBestBeforeGraceDays: z.number().int().min(0).max(14).optional(),
    completeOnboarding: z.boolean().optional(),
  })
  .strict();

const nutrients = z
  .object({
    energyKcal: nonNegative.nullable(),
    proteinG: nonNegative.nullable(),
    carbohydrateG: nonNegative.nullable(),
    fatG: nonNegative.nullable(),
    saturatedFatG: nonNegative.nullable().optional(),
    sugarsG: nonNegative.nullable().optional(),
    fibreG: nonNegative.nullable().optional(),
    sodiumMg: nonNegative.nullable().optional(),
  })
  .strict();

const NAME_MAX = 120;

const pantryFields = {
  name: z.string().trim().min(1, 'name is required').max(NAME_MAX),
  brand: z.string().trim().max(NAME_MAX).nullable().optional(),
  quantity: nonNegative,
  displayUnit,
  gramsPerUnit: positive.max(100_000).nullable().optional(),
  densityGPerMl: positive.max(25).nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
  expirySource: z.enum(['photo', 'manual']).nullable().optional(),
  expiryRawText: z.string().trim().max(200).nullable().optional(),
  nutritionBasis: z.enum(['100g', '100ml', 'unit']),
  nutrition: nutrients.nullable().optional(),
  servingSizeBase: positive.max(100_000).nullable().optional(),
  allergenTags: z.array(allergen).max(ALL_ALLERGENS.length).optional(),
  userVerified: z.boolean(),
};

/** expiry_date and expiry_source are both set or both null (DB CHECK). */
function expiryConsistent(v: { expiryDate?: string | null; expirySource?: string | null }) {
  if (v.expiryDate === undefined && v.expirySource === undefined) return true;
  return (v.expiryDate ?? null) === null ? (v.expirySource ?? null) === null : (v.expirySource ?? null) !== null;
}
const EXPIRY_MSG = { message: 'expiryDate and expirySource must be set together', path: ['expirySource'] };

export const createPantryItemSchema = z
  .object({
    ...pantryFields,
    quantity: positive,
    gtin: z.string().trim().max(20).nullable().optional(),
    source: z.enum(['dataandapis', 'openfoodfacts', 'gemini_photo', 'manual']),
  })
  .strict()
  .refine(expiryConsistent, EXPIRY_MSG);

export const updatePantryItemSchema = z
  .object({
    ...Object.fromEntries(Object.entries(pantryFields).map(([k, v]) => [k, v.optional()])),
    adjustReason: z.enum(['manual_adjust', 'discard']).optional(),
  } as { [K in keyof typeof pantryFields]: z.ZodOptional<(typeof pantryFields)[K]> } & {
    adjustReason: z.ZodOptional<z.ZodEnum<{ manual_adjust: 'manual_adjust'; discard: 'discard' }>>;
  })
  .strict()
  .refine(expiryConsistent, EXPIRY_MSG)
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });

export type CreatePantryItemInput = z.infer<typeof createPantryItemSchema>;
export type UpdatePantryItemInput = z.infer<typeof updatePantryItemSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

// Compile-time: parsed inputs stay assignable to the contract request types.
type Assert<T extends true> = T;
export type _CreateMatches = Assert<CreatePantryItemInput extends CreatePantryItemRequest ? true : false>;
export type _UpdateMatches = Assert<UpdatePantryItemInput extends UpdatePantryItemRequest ? true : false>;
export type _MeMatches = Assert<UpdateMeInput extends UpdateMeRequest ? true : false>;
