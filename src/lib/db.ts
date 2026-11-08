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

const sql = postgres(url, {
  max: env.DB_POOL_MAX ?? 5,
  ssl: 'require',
});

export default sql;
