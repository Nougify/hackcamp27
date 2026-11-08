import "server-only";

// PLACEHOLDER until Johnny's Auth0 requireUser lands (jerry.md Hour 0).
// Johnny replaces this file wholesale; keep callers to `const user = await requireUser()`.
export async function requireUser(): Promise<{ id: string; email: string | null }> {
  return { id: "00000000-0000-4000-8000-000000000001", email: "demo@mise.local" };
}
