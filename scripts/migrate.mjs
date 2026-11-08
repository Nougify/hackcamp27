#!/usr/bin/env node
// Applies db/migrations/*.sql in filename order against DATABASE_URL
// (or DATABASE_URL_TEST with --test). Tracks applied versions in
// schema_migrations. Each file runs in its own transaction.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

const useTest = process.argv.includes('--test');
const url = useTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
if (!url) {
  console.error(`[migrate] missing ${useTest ? 'DATABASE_URL_TEST' : 'DATABASE_URL'}`);
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'db', 'migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

const sql = postgres(url, { max: 1, ssl: 'require', onnotice: () => {} });

await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const applied = new Set((await sql`SELECT version FROM schema_migrations`).map((r) => r.version));

for (const file of files) {
  if (applied.has(file)) {
    console.log(`[migrate] skip ${file} (already applied)`);
    continue;
  }
  const body = await readFile(path.join(dir, file), 'utf8');
  console.log(`[migrate] apply ${file} ...`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`INSERT INTO schema_migrations (version) VALUES (${file})`;
  });
  console.log(`[migrate] applied ${file}`);
}

await sql.end();
console.log('[migrate] done');
