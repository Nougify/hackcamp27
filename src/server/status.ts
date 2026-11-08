import { getEnv } from '@/lib/env';
import sql from '@/lib/db';

export type CheckStatus = 'up' | 'down' | 'configured' | 'not_configured';
export interface Check {
  name: string;
  label: string;
  status: CheckStatus;
  ms?: number;
  detail?: string;
}
export interface StatusResult {
  checks: Check[];
  checkedAt: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; error?: unknown }> {
  const start = performance.now();
  try {
    await fn();
    return { ms: Math.round(performance.now() - start) };
  } catch (error) {
    return { ms: Math.round(performance.now() - start), error };
  }
}

async function checkDatabase(): Promise<Check> {
  const { ms, error } = await timed(() => sql`SELECT 1`);
  if (error) {
    console.error('[status] database check failed:', error instanceof Error ? error.message : 'unknown error');
    return { name: 'database', label: 'Tiger / Postgres', status: 'down', ms };
  }
  return { name: 'database', label: 'Tiger / Postgres', status: 'up', ms };
}

/** Any HTTP response (even 404/401) proves the host is reachable, without spending API quota. */
async function checkReachable(name: string, label: string, url: string): Promise<Check> {
  const { ms, error } = await timed(() => fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000), cache: 'no-store' }));
  if (error) {
    return { name, label, status: 'down', ms, detail: error instanceof Error ? error.message : 'unreachable' };
  }
  return { name, label, status: 'up', ms };
}

function checkConfigured(name: string, label: string, value: string | undefined): Check {
  return { name, label, status: value ? 'configured' : 'not_configured' };
}

/** Live checks against the DB and every third-party service, for the /status diagnostics page. */
export async function getStatusChecks(): Promise<StatusResult> {
  const env = getEnv();

  const [database, auth0, dataandapis, openFoodFacts] = await Promise.all([
    checkDatabase(),
    env.AUTH0_DOMAIN
      ? checkReachable('auth0', 'Auth0', `https://${env.AUTH0_DOMAIN}/.well-known/openid-configuration`)
      : Promise.resolve<Check>({ name: 'auth0', label: 'Auth0', status: 'not_configured' }),
    checkReachable('dataandapis', 'dataandapis.com', 'https://api-barcode-lookup.dataandapis.com/'),
    checkReachable('open_food_facts', 'Open Food Facts', env.OFF_BASE_URL ?? 'https://world.openfoodfacts.org'),
  ]);

  const checks: Check[] = [
    database,
    auth0,
    checkConfigured('vertex_ai', 'Gemini (Vertex AI)', env.GOOGLE_CLOUD_PROJECT),
    dataandapis,
    openFoodFacts,
    checkConfigured('elevenlabs', 'ElevenLabs', env.ELEVENLABS_API_KEY),
  ];

  return { checks, checkedAt: new Date().toISOString() };
}
