import 'server-only';
import type { ProductLookupResponse, ProviderAttempt } from '@/contracts/api';
import type { Product } from '@/contracts/domain';
import { getEnv } from '@/lib/env';
import { fetchDataAndApis } from './dataandapis';
import { buildProduct, mergeProviders } from './normalize';
import { fetchOpenFoodFacts } from './openfoodfacts';
import type { ProviderResult } from './provider';
import { getCachedProduct, logLookups, missedByBothProviders, upsertProduct, type LookupLogRow } from './repo';

// SPEC F2: cache → negative cache → dataandapis → Open Food Facts → upsert. Dependencies are
// injected so the chain can be tested without a database or network.

export type LookupOutcome = Exclude<ProductLookupResponse, { status: 'invalid_barcode' }>;
type Provider = 'dataandapis' | 'openfoodfacts';

export interface LookupDeps {
  getCached: (gtin: string) => Promise<{ product: Product; fresh: boolean } | null>;
  missedByBoth: (gtin: string) => Promise<boolean>;
  log: (rows: LookupLogRow[]) => Promise<void>;
  upsert: (product: Product, raw: unknown) => Promise<void>;
  dataandapis: (code: string) => Promise<ProviderResult>;
  openfoodfacts: (code: string) => Promise<ProviderResult>;
}

const attempt = (provider: Provider, r: ProviderResult): ProviderAttempt => ({
  provider,
  result: r.result,
  ...(r.httpStatus !== undefined ? { httpStatus: r.httpStatus } : {}),
  ms: r.ms,
});

const skipped = (provider: Provider): ProviderAttempt => ({ provider, result: 'skipped', ms: 0 });

function logRow(gtin: string, provider: Provider, r: ProviderResult): LookupLogRow {
  return { gtin, provider, status: r.result, httpStatus: r.httpStatus ?? null, latencyMs: r.ms };
}

export function createLookup(deps: LookupDeps) {
  async function run(gtin: string, lookupCode: string): Promise<LookupOutcome> {
    const started = performance.now();
    const cached = await deps.getCached(gtin);
    const cacheMs = Math.round(performance.now() - started);
    if (cached?.fresh) {
      return { status: 'found', product: cached.product, cached: true, attempts: [{ provider: 'cache', result: 'hit', ms: cacheMs }] };
    }

    const cacheAttempt: ProviderAttempt = { provider: 'cache', result: 'miss', ms: cacheMs };
    if (await deps.missedByBoth(gtin)) {
      const attempts = [cacheAttempt, skipped('dataandapis'), skipped('openfoodfacts')];
      return cached ? { status: 'found', product: cached.product, cached: true, attempts } : { status: 'not_found', gtin, attempts };
    }

    const dna = await deps.dataandapis(lookupCode);
    const needsOff = dna.result !== 'hit' || !dna.data.servingSize || !dna.data.packageQuantity;
    const off = needsOff ? await deps.openfoodfacts(lookupCode) : null;

    const rows = [logRow(gtin, 'dataandapis', dna), ...(off ? [logRow(gtin, 'openfoodfacts', off)] : [])];
    for (const row of rows) {
      if (row.status === 'error') console.error('[products] provider error', { gtin, provider: row.provider, httpStatus: row.httpStatus });
    }
    // The log feeds the negative cache and quota monitoring; losing a row must not lose the answer.
    await deps.log(rows).catch((err: unknown) => console.error('[products] could not log lookup', err));

    const attempts = [cacheAttempt, attempt('dataandapis', dna), off ? attempt('openfoodfacts', off) : skipped('openfoodfacts')];
    const offHit = off?.result === 'hit' ? off : null;

    if (dna.result === 'hit' || offHit) {
      const source = dna.result === 'hit' ? 'dataandapis' : 'openfoodfacts';
      const data = dna.result === 'hit' ? mergeProviders(dna.data, offHit?.data ?? null) : offHit!.data;
      const product = buildProduct(gtin, source, data, new Date());
      await deps.upsert(product, {
        ...(dna.result === 'hit' ? { dataandapis: dna.raw } : {}),
        ...(offHit ? { openfoodfacts: offHit.raw } : {}),
      });
      return { status: 'found', product, cached: false, attempts };
    }

    // A stale product beats "not found" when the refresh failed or came back empty.
    if (cached) return { status: 'found', product: cached.product, cached: true, attempts };
    return { status: 'not_found', gtin, attempts };
  }

  const inFlight = new Map<string, Promise<LookupOutcome>>();

  /** Concurrent lookups of one GTIN in this process share a promise, so tokens aren't spent twice. */
  return function lookup(gtin: string, lookupCode: string): Promise<LookupOutcome> {
    const existing = inFlight.get(gtin);
    if (existing) return existing;
    const promise = run(gtin, lookupCode).finally(() => inFlight.delete(gtin));
    inFlight.set(gtin, promise);
    return promise;
  };
}

export const lookupProduct = createLookup({
  getCached: getCachedProduct,
  missedByBoth: missedByBothProviders,
  log: logLookups,
  upsert: upsertProduct,
  dataandapis: (code) => fetchDataAndApis(code, getEnv().DATAANDAPIS_KEY ?? ''),
  openfoodfacts: (code) => fetchOpenFoodFacts(code, { baseUrl: getEnv().OFF_BASE_URL, userAgent: getEnv().OFF_USER_AGENT ?? '' }),
});
