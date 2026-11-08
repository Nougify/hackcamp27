import 'server-only';
import postgres from 'postgres';
import { getEnv } from './env';

const env = getEnv();

/**
 * One small pool per long-lived Node process (SPEC.md §3.1) — Tiger's free
 * tier excludes connection pooling, and postgres.js connects lazily on first
 * query, so constructing this at module load does not open a connection.
 *
 * `MISE_TEST_DB=1` (set by `npm run test:db`) points at DATABASE_URL_TEST,
 * a Tiger fork — never production.
 */
const url =
  process.env.MISE_TEST_DB === '1' ? (env.DATABASE_URL_TEST ?? '') : (env.DATABASE_URL ?? '');

/**
 * Type parsing (shared by every workstream):
 *   numeric (1700), int8 (20) → JS number (contracts use `number`; our values fit in 2^53)
 *   date (1082)               → 'YYYY-MM-DD' string, never a Date (a Date would shift by the TZ)
 *   timestamptz               → Date (postgres.js default); call .toISOString() for contracts
 * Serializers match postgres.js defaults: numbers/strings as text; a Date for a `date` column is
 * written as its UTC day, as postgres.js v4 does. Callers may still wrap values in Number().
 */
const asText = (x: unknown) => String(x);
const toNumber = (x: string) => Number(x);

const sql = postgres(url, {
  max: env.DB_POOL_MAX ?? 5,
  ssl: 'require',
  types: {
    numericAsNumber: { to: 1700, from: [1700], serialize: asText, parse: toNumber },
    int8AsNumber: { to: 20, from: [20], serialize: asText, parse: toNumber },
    dateAsIsoString: {
      to: 1082,
      from: [1082],
      serialize: (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x)),
      parse: (x: string) => x,
    },
  },
});

export default sql;
