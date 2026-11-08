import 'server-only';
import { z } from 'zod';

const schema = z.object({
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_CLIENT_ID: z.string().min(1),
  AUTH0_CLIENT_SECRET: z.string().min(1),
  AUTH0_SECRET: z.string().min(1),
  APP_BASE_URL: z.string().url().optional(),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_URL_TEST: z.string().optional(),

  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_SEARCH_MODEL: z.string().default('gemini-3.8-flash'),

  DATAANDAPIS_KEY: z.string().min(1),
  OFF_BASE_URL: z.string().url().default('https://world.openfoodfacts.org'),
  OFF_USER_AGENT: z.string().min(1),
  RECIPE_FETCH_USER_AGENT: z.string().min(1),

  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('JBFqnCBsd6RMkjVDRZzb'),
  ELEVENLABS_MODEL_ID: z.string().default('eleven_flash_v2_5'),

  DEFAULT_TZ: z.string().default('America/Vancouver'),
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
  if (process.env.NODE_ENV === 'test') {
    cached = schema.partial().parse(process.env) as Env;
    return cached;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('[env] invalid/missing environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration — see logs above.');
  }
  cached = parsed.data;
  return cached;
}
