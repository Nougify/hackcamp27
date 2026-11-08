// Runs once when the Next.js server starts (not during `next build`).
// SPEC §8: validate the server environment at boot. In production getEnv() throws on missing or
// invalid variables, so the server fails fast instead of on the first request; in local dev it
// only warns (see src/lib/env.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./lib/env');
    getEnv();
  }
}
