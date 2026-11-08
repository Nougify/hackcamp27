import 'server-only';
import { normalizeIngredientName } from '@/server/recipes/parse';

// SPEC F5: pantry_items.normalized_name is computed server-side and must match the
// normalizedName that recipe matching computes for ingredient lines. So pantry names go
// through the SAME function as recipe ingredients (Hang's normalizeIngredientName, read-only),
// after stripping the two things only product names have:
//   - the product's brand (each comma-separated phrase of `brand`, as whole words)
//   - package-size text ("400 g", "2 x 500 ml", "12 ct", the EU estimated sign "e"/"℮")
// Team decision 2026-11-08: no marketing-adjective stripping.

const BOUNDARY_START = '(?<![\\p{L}\\p{N}])';
const BOUNDARY_END = '(?![\\p{L}\\p{N}])';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SIZE_UNIT = '(?:kg|g|mg|ml|cl|dl|l|fl\\.?\\s*oz|oz|lbs?|ct|pcs|pc|pk|pack|count)';
const NUM = '\\d+(?:[.,]\\d+)?';
const PACKAGE_SIZE_RE = new RegExp(
  `${BOUNDARY_START}${NUM}\\s*(?:x\\s*${NUM}\\s*)?${SIZE_UNIT}\\.?(?:\\s*(?:e|℮)${BOUNDARY_END})?${BOUNDARY_END}`,
  'giu',
);

/** Removes brand phrases and package sizes from a product name. Never returns undefined; may return ''. */
export function stripBrandAndSize(name: string, brand?: string | null): string {
  let s = name.replace(/℮/g, ' ');
  for (const phrase of (brand ?? '').split(',').map((b) => b.trim()).filter(Boolean)) {
    s = s.replace(new RegExp(`${BOUNDARY_START}${escapeRe(phrase)}(?:'s)?${BOUNDARY_END}`, 'giu'), ' ');
  }
  s = s.replace(PACKAGE_SIZE_RE, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * normalized_name for a pantry item: brand and size stripped, then recipe normalization
 * (lowercase, descriptors like fresh/chopped removed, naive singular).
 * Falls back to normalizing the full name when stripping leaves nothing ("Nutella" by Nutella).
 */
export function normalizePantryName(name: string, brand?: string | null): string {
  const stripped = normalizeIngredientName(stripBrandAndSize(name, brand));
  if (stripped) return stripped;
  const full = normalizeIngredientName(name);
  return full || name.trim().toLowerCase();
}
