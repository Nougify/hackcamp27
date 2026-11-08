import type { ApiError, CreatePantryItemRequest, ListPantryResponse, UpdateMeRequest, UpdatePantryItemRequest } from '@/contracts/api';
import type { PantryItem, UserProfile } from '@/contracts/domain';

// Browser-side client for Workstream B routes. Throws ApiClientError with the server's message.

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new ApiClientError('Unexpected response from the server', res.status, null);
  }
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    throw new ApiClientError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? null, err?.details);
  }
  return data as T;
}

export const pantryApi = {
  list: (opts: { sort?: 'expiry' | 'name'; includeEmpty?: boolean } = {}) =>
    api<ListPantryResponse>(
      `/api/pantry?sort=${opts.sort ?? 'expiry'}&includeEmpty=${opts.includeEmpty ? 'true' : 'false'}`,
    ),
  create: (body: CreatePantryItemRequest) => api<PantryItem>('/api/pantry', { method: 'POST', json: body }),
  update: (id: string, body: UpdatePantryItemRequest) =>
    api<PantryItem>(`/api/pantry/${encodeURIComponent(id)}`, { method: 'PATCH', json: body }),
  remove: (id: string) => api<{ ok: true }>(`/api/pantry/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restock: (id: string) => api<PantryItem>(`/api/pantry/${encodeURIComponent(id)}/restock`, { method: 'POST', json: {} }),
};

export const meApi = {
  get: () => api<UserProfile>('/api/me'),
  update: (body: UpdateMeRequest) => api<UserProfile>('/api/me', { method: 'PATCH', json: body }),
  deleteAll: () => api<{ ok: true }>('/api/me', { method: 'DELETE' }),
};
