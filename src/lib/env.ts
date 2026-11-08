import 'server-only';
import { z } from 'zod';

const PG_URL = /^postgres(ql)?:\/\//;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const schema = z.object({
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_SECRET: z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)'),
  APP_BASE_URL: z.string().url().optional(),

  DATABASE_URL: z.string().regex(PG_URL, 'must be a postgres:// connection string'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_URL_TEST: z.string().regex(PG_URL, 'must be a postgres:// connection string').optional(),

  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().min(1).catch('global'), // blank line in .env also falls back; gemini-3.8-flash is global-only
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_SEARCH_MODEL: z.string().default('gemini-3.8-flash'),

  DATAANDAPIS_KEY: z.string().min(1),
  OFF_BASE_URL: z.string().url().default('https://world.openfoodfacts.org'),
  OFF_USER_AGENT: z.string().min(1),
  RECIPE_FETCH_USER_AGENT: z.string().min(1),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('JBFqnCBsd6RMkjVDRZzb'),
  ELEVENLABS_MODEL_ID: z.string().default('eleven_flash_v2_5'),

  DEFAULT_TZ: z.string().refine(isValidTimeZone, 'must be an IANA time zone').default('America/Vancouver'),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Validates server env vars with Zod and fails fast. Skipped during `vitest`
 * (NODE_ENV=test) so pure unit tests don't need every production secret —
 * anything that actually calls an external API should mock its own env reads.
 */
export function getEnv(): Env {
  if (cached) return cached;
  // `KEY=` (empty, as in .env.example) means unset, not an invalid empty string.
  const source = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  // `next build` imports route modules without runtime secrets; validate at request time instead.
  if (process.env.NODE_ENV === 'test' || process.env.NEXT_PHASE === 'phase-production-build') {
    cached = schema.partial().parse(source) as Env;
    return cached;
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success && process.env.NODE_ENV !== 'production') {
    // Local dev without every key: warn and run; features needing a missing key fail on use.
    console.warn('[env] missing env vars (dev only, not fatal):', Object.keys(parsed.error.flatten().fieldErrors).join(', '));
    cached = schema.partial().parse(source) as Env;
    return cached;
  }
  if (!parsed.success) {
    console.error('[env] invalid/missing environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration — see logs above.');
  }
  if (process.env.NODE_ENV === 'production' && !parsed.data.APP_BASE_URL) {
    console.error('[env] invalid/missing environment variables: { APP_BASE_URL: [ "is required in production" ] }');
    throw new Error('Invalid environment configuration — see logs above.');
  }
  cached = parsed.data;
  return cached;
}
