import { afterEach, describe, expect, it, vi } from 'vitest';

const VALID = {
  AUTH0_DOMAIN: 'dev-x.us.auth0.com',
  AUTH0_CLIENT_ID: 'id',
  AUTH0_CLIENT_SECRET: 'secret',
  AUTH0_SECRET: 'a'.repeat(64),
  APP_BASE_URL: 'https://mise.example',
  DATABASE_URL: 'postgres://u:p@h:5432/tsdb?sslmode=require',
  GEMINI_API_KEY: 'k',
  DATAANDAPIS_KEY: 'k',
  OFF_USER_AGENT: 'Mise/0.1 (team@example.com)',
  RECIPE_FETCH_USER_AGENT: 'MiseRecipeFetcher/0.1',
  DEFAULT_TZ: 'America/Vancouver',
};

async function loadEnv(vars: Record<string, string | undefined>, nodeEnv: 'test' | 'production' = 'test') {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return (await import('./env')).getEnv;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getEnv strict checks', () => {
  it('accepts a complete production env', async () => {
    const getEnv = await loadEnv(VALID, 'production');
    expect(getEnv().DEFAULT_TZ).toBe('America/Vancouver');
  });

  it('requires APP_BASE_URL in production', async () => {
    const getEnv = await loadEnv({ ...VALID, APP_BASE_URL: undefined }, 'production');
    expect(() => getEnv()).toThrow(/Invalid environment/);
  });

  it('rejects an AUTH0_SECRET shorter than 32 characters', async () => {
    const getEnv = await loadEnv({ ...VALID, AUTH0_SECRET: 'short' });
    expect(() => getEnv()).toThrow(/32 characters/);
  });

  it('rejects a non-postgres DATABASE_URL and DATABASE_URL_TEST', async () => {
    const a = await loadEnv({ ...VALID, DATABASE_URL: 'mysql://x' });
    expect(() => a()).toThrow(/postgres:\/\//);
    const b = await loadEnv({ ...VALID, DATABASE_URL_TEST: 'http://x' });
    expect(() => b()).toThrow(/postgres:\/\//);
  });

  it('rejects an invalid DEFAULT_TZ', async () => {
    const getEnv = await loadEnv({ ...VALID, DEFAULT_TZ: 'Mars/Olympus' });
    expect(() => getEnv()).toThrow(/IANA/);
  });

  it('still tolerates missing variables in tests (partial parse)', async () => {
    const getEnv = await loadEnv({ GEMINI_API_KEY: 'k' });
    expect(getEnv().GEMINI_API_KEY).toBe('k');
  });
});

describe('empty variables', () => {
  it('treats KEY= as unset: dev tolerates it, production reports it as missing', async () => {
    const dev = await loadEnv({ ...VALID, AUTH0_DOMAIN: '', ELEVENLABS_API_KEY: '' });
    expect(dev().AUTH0_DOMAIN).toBeUndefined();
    const prod = await loadEnv({ ...VALID, AUTH0_DOMAIN: '' }, 'production');
    expect(() => prod()).toThrow(/Invalid environment/);
  });
});
