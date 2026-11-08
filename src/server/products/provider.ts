import 'server-only';
import type { Nutrients, Product } from '@/contracts/domain';
import type { PackageQuantity, ServingSize } from './parse';

export const PROVIDER_TIMEOUT_MS = 4000;
/** Both providers serve the Open Food Facts dataset (§10.1), so the attribution is the same. */
export const ATTRIBUTION = 'Open Food Facts, ODbL';

export interface ProviderProduct {
  name: string;
  brand: string | null;
  imageUrl: string | null;
  categories: string[];
  allergenTags: Product['allergenTags'];
  packageQuantity: PackageQuantity | null;
  servingSize: ServingSize | null;
  per100: Nutrients;
  /** Per-serving values as printed by the provider, when it has any. */
  perServing: Nutrients | null;
}

export type ProviderResult =
  | { result: 'hit'; data: ProviderProduct; raw: unknown; httpStatus: number; ms: number }
  | { result: 'miss'; httpStatus?: number; ms: number }
  | { result: 'error'; httpStatus?: number; ms: number };

/** The parsed outcome of one HTTP response, before timing is attached. */
export type ParsedResponse = { result: 'hit'; data: ProviderProduct } | { result: 'miss' } | { result: 'error' };

/** GET with the provider timeout. A network failure, timeout or unreadable 2xx body is an `error`. */
export async function fetchProvider(
  url: string,
  headers: Record<string, string>,
  parse: (status: number, body: unknown) => ParsedResponse,
): Promise<ProviderResult> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  let httpStatus: number | undefined;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS), cache: 'no-store' });
    httpStatus = res.status;
    const text = await res.text();
    let body: unknown = null;
    let unreadable = false;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      unreadable = true;
    }
    // A 2xx we can't read says nothing about whether the product exists, so it can't be a miss.
    if (unreadable && res.ok) return { result: 'error', httpStatus, ms: ms() };
    const parsed = parse(res.status, body);
    if (parsed.result === 'hit') return { result: 'hit', data: parsed.data, raw: body, httpStatus, ms: ms() };
    return { result: parsed.result, httpStatus, ms: ms() };
  } catch {
    return { result: 'error', httpStatus, ms: ms() };
  }
}
