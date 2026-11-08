import 'server-only';
import { lookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent, fetch, type Response } from 'undici';

export type SafeFetchErrorCode =
  | 'blocked_url'
  | 'timeout'
  | 'too_large'
  | 'bad_content_type'
  | 'http_error'
  | 'network';

export class SafeFetchError extends Error {
  constructor(
    public code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number; // default 5000
  maxBytes?: number; // default 2 MB
  maxRedirects?: number; // default 5
  userAgent?: string; // default RECIPE_FETCH_USER_AGENT
  /** Test-only escape hatch for localhost fixture servers. Never true in prod. */
  allowPrivate?: boolean;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const b = Number(p);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n >>> 0;
}

function inCidr(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** True when the literal IP must never be fetched (SSRF guard, §13). */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (clean.includes(':')) {
    // IPv6: loopback, unspecified, link-local, unique-local, mapped/doc ranges
    if (clean === '::1' || clean === '::') return true;
    const first = clean.split(':')[0]!;
    if (/^fe[89ab]/.test(first) || first === 'fec0') return true; // link-local fe80::/10, site-local
    if (/^(fc|fd)/.test(first)) return true; // unique-local fc00::/7
    if (clean.startsWith('::ffff:')) {
      const v4 = ipv4ToInt(clean.slice('::ffff:'.length));
      if (v4 != null) return isBlockedIp(intToIpv4(v4));
    }
    return false;
  }
  const n = ipv4ToInt(clean);
  if (n == null) return true; // unparseable → block
  return (
    inCidr(n, '10.0.0.0', 8) ||
    inCidr(n, '172.16.0.0', 12) ||
    inCidr(n, '192.168.0.0', 16) ||
    inCidr(n, '127.0.0.0', 8) ||
    inCidr(n, '169.254.0.0', 16) ||
    inCidr(n, '0.0.0.0', 8) ||
    inCidr(n, '100.64.0.0', 10) || // CGNAT (metadata on some clouds)
    inCidr(n, '198.18.0.0', 15) || // benchmarking
    inCidr(n, '224.0.0.0', 4) || // multicast
    inCidr(n, '240.0.0.0', 4) // reserved / broadcast
  );
}

function intToIpv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/**
 * Pure format check: http(s) on port 80/443 only. Throws SafeFetchError(blocked_url).
 * `allowPrivate` (test-only) also skips the port check for ephemeral test ports.
 */
export function checkUrlFormat(raw: string, opts?: { allowPrivate?: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('blocked_url', `Not a valid URL: ${raw.slice(0, 120)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('blocked_url', `Only http(s) URLs may be fetched: ${url.protocol}`);
  }
  const port = url.port;
  if (!opts?.allowPrivate && port !== '' && port !== '80' && port !== '443') {
    throw new SafeFetchError('blocked_url', `Only ports 80/443 may be fetched: ${port}`);
  }
  if (!url.hostname) throw new SafeFetchError('blocked_url', 'URL has no hostname');
  return url;
}

/**
 * Resolves the hostname and rejects private/loopback/link-local/metadata IPs.
 * Re-checked on every redirect hop by `safeFetchHtml`. Returns the validated address
 * so the connection can be pinned to it (no second DNS lookup → no rebinding).
 */
export async function assertUrlAllowed(
  raw: string,
  opts?: { allowPrivate?: boolean },
): Promise<{ url: URL; address: { address: string; family: number } }> {
  const url = checkUrlFormat(raw, { allowPrivate: opts?.allowPrivate });
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname.replace(/^\[(.*)\]$/, '$1'), { all: true });
  } catch {
    throw new SafeFetchError('blocked_url', `Could not resolve host: ${url.hostname}`);
  }
  if (!addresses.length) throw new SafeFetchError('blocked_url', `Could not resolve host: ${url.hostname}`);
  if (!opts?.allowPrivate) {
    for (const a of addresses) {
      if (isBlockedIp(a.address)) {
        throw new SafeFetchError('blocked_url', `Refusing to fetch private/link-local address for ${url.hostname}`);
      }
    }
  }
  return { url, address: addresses[0]! };
}

/** DNS lookup that always answers the already-validated address, whatever the hostname. */
export function pinnedLookup(address: string, family: number): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * SSRF-safe HTML fetch for publisher recipe pages and grounding-redirect
 * resolution (§13). Follows redirects manually (max 5), re-validating every
 * hop. Returns the final URL, status and decoded text.
 */
export async function safeFetchHtml(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const userAgent = opts.userAgent ?? process.env.RECIPE_FETCH_USER_AGENT ?? 'MiseRecipeFetcher/0.1';

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url, address } = await assertUrlAllowed(current, { allowPrivate: opts.allowPrivate });
    // Connect only to the IP we just validated; TLS SNI/cert still use the hostname from the URL.
    const dispatcher = new Agent({ connect: { lookup: pinnedLookup(address.address, address.family) } });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
          headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
        });
      } catch (err) {
        throw new SafeFetchError(
          err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network',
          `Fetch failed for ${url.hostname}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (res.status >= 300 && res.status < 400) {
        if (hop === maxRedirects) throw new SafeFetchError('blocked_url', 'Too many redirects');
        const location = res.headers.get('location');
        if (!location) throw new SafeFetchError('network', 'Redirect without Location header');
        await res.body?.cancel().catch(() => {});
        current = new URL(location, url).toString();
        continue;
      }

      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        throw new SafeFetchError('http_error', `Publisher returned HTTP ${res.status} for ${url.hostname}`);
      }

      const contentType = res.headers.get('content-type');
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        await res.body?.cancel().catch(() => {});
        throw new SafeFetchError('bad_content_type', `Refusing non-HTML content: ${contentType.slice(0, 80)}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new SafeFetchError('network', 'Empty response body');
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new SafeFetchError('too_large', `Response exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      return { finalUrl: url.toString(), status: res.status, contentType, text };
    } finally {
      void dispatcher.close().catch(() => {});
    }
  }
  throw new SafeFetchError('blocked_url', 'Too many redirects');
}
