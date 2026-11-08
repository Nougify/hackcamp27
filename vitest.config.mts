import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// `vitest run --mode db` (npm run test:db) runs only the *.db.test.ts suites against
// DATABASE_URL_TEST; the default run excludes them so it needs no database.
export default defineConfig(({ mode }) => {
  // DB suites need DATABASE_URL_TEST from .env.local (vitest doesn't load it into process.env).
  if (mode === "db") {
    try {
      process.loadEnvFile(src("./.env.local"));
    } catch {}
  }
  return {
  resolve: { alias: { "@": src("./src"), "server-only": src("./test/stubs/server-only.ts") } },
  test:
    mode === "db"
      ? { include: ["src/**/*.db.test.ts"], env: { MISE_TEST_DB: "1", DATABASE_URL_TEST: process.env.DATABASE_URL_TEST ?? "" } }
      : { include: ["src/**/*.test.{ts,tsx}"], exclude: ["**/node_modules/**", "src/**/*.db.test.ts"] },
  };
});
