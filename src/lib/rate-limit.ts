/**
 * In-memory per-user token bucket. Good enough for a single long-lived Node
 * process on one VPS (see SPEC.md §3.1) — would need a shared store (Redis)
 * behind a load balancer.
 */

export const RATE_LIMITS = {
  'recipes/search': 6,
  'recipes/adapt': 6,
  'vision': 10,
  tts: 60,
  'products/lookup': 30,
} as const;

export type RateLimitRoute = keyof typeof RATE_LIMITS;

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export function checkRateLimit(userId: string, route: RateLimitRoute, now = Date.now()): RateLimitResult {
  const limitPerMinute = RATE_LIMITS[route];
  const key = `${userId}:${route}`;
  const refillPerMs = limitPerMinute / 60_000;

  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { tokens: limitPerMinute, lastRefillMs: now };
  const elapsedMs = Math.max(0, now - bucket.lastRefillMs);
  bucket.tokens = Math.min(limitPerMinute, bucket.tokens + elapsedMs * refillPerMs);
  bucket.lastRefillMs = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { ok: true, retryAfterMs: 0 };
  }

  buckets.set(key, bucket);
  const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillPerMs);
  return { ok: false, retryAfterMs };
}
