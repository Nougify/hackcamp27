# Mise

Hands-free pantry-to-plate cooking app: scan groceries, find real recipes that fit the pantry and diet, cook by gesture or voice, track nutrition. Next.js 16 App Router, React 19, TypeScript, Auth0, Tiger Data (Postgres/TimescaleDB via postgres.js), Gemini, MediaPipe, ElevenLabs.

@AGENTS.md

Next 16 uses `src/proxy.ts`, not `middleware.ts`.

Source of truth, highest first: `src/contracts/**`, then `SPEC.md`, then comments. If the contracts and SPEC disagree, the contracts win; raise the mismatch with a human. Workstream task lists: `jerry.md` (A, cook mode), `johnny.md` (B, pantry and nutrition), `hang.md` (C, recipes and cooking backend). Ownership by path: SPEC §3.2.

## Commands
Node >= 22. Definition of done: typecheck, lint and test all pass.

```bash
npm run dev
npm run typecheck   # next typegen + tsc --noEmit
npm run lint
npm test            # unit tests, no network or database; excludes *.db.test.ts
npm run test:db     # migrates DATABASE_URL_TEST, then runs *.db.test.ts
npm run migrate     # applies db/migrations/*.sql to DATABASE_URL
npm run build
```

- Run one test file with `npx vitest run <path>`.
- `DATABASE_URL_TEST` must be a Tiger fork, never production.
- SPEC §14.1 lists `test:e2e`, but no such script exists yet.
- Local config lives in `.env.local` (template: `.env.example`). Never print its values.
- Without `AUTH0_DOMAIN`, non-production runs skip auth and act as a demo user (`src/lib/auth0.ts`).

## Layout
- `src/app`: pages in `(app)/`, route handlers in `api/`.
- `src/server`: server-side domain logic by area (`pantry`, `products`, `vision`, `nutrition`, `recipes`, `diet`, `cook`).
- `src/features`: client components and hooks (`cook`, `gesture`, `voice`, `scan`, `pantry`, `nutrition`, `recipes`).
- `src/contracts`: shared domain and API types, plus fixtures.
- `src/lib`: env, db, auth, HTTP helpers, units, GTIN, rate limiting, Gemini client.
- `src/components/ui`: shared UI kit. Use it before adding new primitives.

## Code conventions
- Route handlers follow `src/app/api/meals/route.ts`: `runtime = 'nodejs'`, `requireUser()` first inside `try`, Zod-validate input, respond with `jsonOk`/`jsonError`, and `catch (err) { return handleRouteError(err); }`. Check malformed path ids with `isUuid`.
- Rate-limit costly routes with `checkRateLimit(userId, route)` from `@/lib/rate-limit`.
- Database: `import sql from '@/lib/db'`. Types are parsed centrally: `numeric`/`int8` to number, `date` to a `'YYYY-MM-DD'` string, `timestamptz` to `Date`.
- Every query on user data filters by `user_id`. Another user's id returns 404, not 403.
- `requireUser()` returns identity and `tz` only. Diets, allergens and onboarding state come from `src/server/pantry/profile.ts`.
- Read validated config with `getEnv()` from `@/lib/env`. Secrets never use `NEXT_PUBLIC_`.
- Modules that touch the database, secrets or server-side APIs start with `import 'server-only'`.
- Fetch third-party recipe pages only through `src/server/recipes/safe-fetch.ts` (SSRF protection).
- Unit tests sit next to the code as `*.test.ts`; tests that need a database are `*.db.test.ts`.

## Product rules (SPEC §12, §13)
- Treat Gemini output as untrusted: validate it with Zod, verify ids, and re-check allergens in code.
- Nothing from Gemini reaches the database without a user tap. AI-generated or transformed content carries a visible badge; publisher content carries attribution.
- Every gesture has a tap and a keyboard equivalent. Colour is never the only signal.
- Camera frames and label or expiry photos are never stored.

## Changing shared files (SPEC §18.5)
- `src/contracts/**`, `db/migrations/**`, `src/lib/**` and `src/components/ui/**` are frozen. Stop and ask a human. Changes go in one small additive commit titled `contract: …`.
- Add a new numbered migration (`000N_*.sql`) rather than editing an existing one.
- Do not edit `package.json` or the lockfile as part of feature work. Dependency changes go through the team's designated owner.

# Team workflow (Entire + Claude Code)

This repo uses Entire. Commits capture the Claude session as a checkpoint automatically. Run `entire agent-help` for exact CLI flags.

## Branches and trails
- Never commit to `main`. Work on a feature branch: `git switch main && git pull && git switch -c <name>/<feature>`.
- Each feature gets one trail: `entire trail create --title "<feature>"` (skip if the branch already has one: `entire trail list --project gh/nougify`).
- Keep features small; merge every few hours.

## Before pushing
1. Run `entire review general` (local Claude Code reviewers, verdict posted to the trail; the profile name is required when run non-interactively). This uses the user's Claude plan, not Entire billing. For a stacked branch, pass `--base <parent-branch>`.
2. Fix or report every finding it raises before pushing.
3. Commit, then `git push origin <branch>`.

## Finishing a feature
- `entire trail ready <number>` to request review. A teammate approves (`entire trail approve hackcamp27/<n>`) and merges (`entire trail merge hackcamp27/<n>`).
- After someone else merges, sync: `entire trail update-branch` or `git pull origin main`.

## Gotchas
- `entire review` is a labs command: `entire agent-help review` errors, so use `entire review --help` for its flags.
- `entire trail show` with no args returns 403; pass the number: `entire trail show <n> --project gh/nougify`.
- "project gh/nougify does not exist or is not visible" means the logged-in account lacks project access; a teammate has to grant it.
- In Git Bash, prefix `entire api` calls with `MSYS_NO_PATHCONV=1`.
- Ask the user before `entire enable/disable/clean/login` or granting project access.
