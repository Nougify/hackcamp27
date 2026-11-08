import 'server-only';
import { auth0, authDisabled } from './auth0';
import sql from './db';
import { UnauthorizedError } from './errors';

export interface AppUser {
  id: string;
  auth0Sub: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  tz: string;
}

interface UserRow {
  id: string;
  auth0_sub: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  tz: string;
}

/** Local dev without Auth0 (see `authDisabled`); same id as main's old placeholder. */
const DEV_USER: AppUser = {
  id: '00000000-0000-4000-8000-000000000001',
  auth0Sub: 'dev|local',
  email: 'demo@mise.local',
  displayName: 'Demo cook',
  avatarUrl: null,
  tz: 'America/Vancouver',
};

/**
 * First line of every route handler (SPEC.md §7). Upserts the Auth0 session's
 * `sub` into `users` (never merges by email — SPEC.md §5.2) and returns our
 * own user row. Throws UnauthorizedError, caught by `handleRouteError`.
 */
export async function requireUser(): Promise<AppUser> {
  if (authDisabled) return DEV_USER;
  const session = await auth0.getSession();
  if (!session) throw new UnauthorizedError('No active session');

  const rows = await sql<UserRow[]>`
    INSERT INTO users (auth0_sub, email, display_name, avatar_url)
    VALUES (${session.user.sub}, ${session.user.email ?? null}, ${session.user.name ?? null}, ${session.user.picture ?? null})
    ON CONFLICT (auth0_sub) DO UPDATE SET
      last_seen_at = now(),
      email = COALESCE(EXCLUDED.email, users.email),
      display_name = COALESCE(users.display_name, EXCLUDED.display_name),
      avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url)
    RETURNING id, auth0_sub, email, display_name, avatar_url, tz
  `;
  const row = rows[0];
  if (!row) throw new Error('requireUser: upsert returned no row');

  return {
    id: row.id,
    auth0Sub: row.auth0_sub,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    tz: row.tz,
  };
}
