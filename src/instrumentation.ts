// Runs once when the Next.js server starts (not during `next build`).
// SPEC §8: validate the server environment at boot and fail fast. In production getEnv() throws on
// missing or invalid variables and we exit(1), so Docker shows a crashed container instead of a
// half-alive server; in local dev it only warns (see src/lib/env.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('./lib/env');
    try {
      getEnv();
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
      }
      throw err;
    }
  }
}
