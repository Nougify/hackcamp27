import sql from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let db: 'up' | 'down' = 'up';
  try {
    await sql`SELECT 1`;
  } catch (err) {
    console.error('[health] database check failed:', err instanceof Error ? err.message : 'unknown error');
    db = 'down';
  }
  return Response.json(
    { ok: db === 'up', db, version: process.env.npm_package_version ?? '0.1.0' },
    { status: db === 'up' ? 200 : 503 },
  );
}
