import type { CookingSession, CookSessionView, FinishPreview, FinishRequest, FinishResult, UpdateSessionRequest } from "@/contracts";

// Until Hang's /api/cook routes land, NEXT_PUBLIC_COOK_FIXTURES=true serves contract fixtures.
// ponytail: delete this flag and the fixture branch at integration (SPEC §18.4).
const useFixtures = process.env.NEXT_PUBLIC_COOK_FIXTURES === "true";
const fixtures = () => import("@/contracts/fixtures");

export class ApiRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiRequestError(res.status, body?.error?.message ?? res.statusText);
  }
  return res.json();
}

export async function getSession(id: string): Promise<CookSessionView> {
  if (useFixtures) return (await fixtures()).cookSessionViewFixture;
  return call(`/api/cook/sessions/${id}`);
}

export async function patchSession(id: string, body: UpdateSessionRequest): Promise<CookingSession> {
  if (useFixtures) return { ...(await fixtures()).cookingSessionFixture, ...body } as CookingSession;
  return call(`/api/cook/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function getFinishPreview(id: string, servingsCooked: number): Promise<FinishPreview> {
  if (useFixtures) return (await fixtures()).finishPreviewFixture;
  return call(`/api/cook/sessions/${id}/finish-preview?servingsCooked=${servingsCooked}`);
}

export async function finishSession(id: string, body: FinishRequest): Promise<FinishResult> {
  if (useFixtures) return (await fixtures()).finishResultFixture;
  return call(`/api/cook/sessions/${id}/finish`, { method: "POST", body: JSON.stringify(body) });
}
