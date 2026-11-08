import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  SafeFetchError,
  assertUrlAllowed,
  checkUrlFormat,
  isBlockedIp,
  pinnedLookup,
  safeFetchHtml,
} from './safe-fetch';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.1.2.3',
    '[::1]',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1', // just outside 172.16/12
    '192.167.1.1',
    '203.0.113.7',
    '2606:4700:4700::1111',
    '2001:db8::1',
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('isBlockedIp: extra reserved ranges', () => {
  it.each(['fe90::1', 'febf::1', '100.64.0.1', '100.127.255.254', '198.18.0.1', '224.0.0.1', '255.255.255.255'])(
    'blocks %s',
    (ip) => expect(isBlockedIp(ip)).toBe(true),
  );
  it.each(['100.63.255.255', '100.128.0.1', '8.8.8.8'])('allows %s', (ip) =>
    expect(isBlockedIp(ip)).toBe(false),
  );
});

describe('pinnedLookup (DNS rebinding guard)', () => {
  it('answers the validated address for any hostname, in both callback forms', () => {
    const lookup = pinnedLookup('93.184.216.34', 4);
    lookup('evil.example', { all: true }, (err, addrs) => {
      expect(err).toBeNull();
      expect(addrs).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });
    lookup('evil.example', {}, (err, addr, family) => {
      expect(err).toBeNull();
      expect([addr, family]).toEqual(['93.184.216.34', 4]);
    });
  });
});

describe('checkUrlFormat', () => {
  it.each(['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/', 'javascript:alert(1)', 'notaurl'])(
    'rejects %s',
    (raw) => {
      expect(() => checkUrlFormat(raw)).toThrowError(SafeFetchError);
    },
  );

  it.each(['http://example.com:8080/', 'https://example.com:3000/x', 'http://example.com:22/'])(
    'rejects non-80/443 port %s',
    (raw) => {
      expect(() => checkUrlFormat(raw)).toThrowError(/ports 80\/443/);
    },
  );

  it.each(['https://example.com/recipe', 'http://example.com:80/', 'https://example.com:443/x'])(
    'accepts %s',
    (raw) => {
      expect(checkUrlFormat(raw).hostname).toBe('example.com');
    },
  );

  it('allowPrivate skips the port check for ephemeral test ports', () => {
    expect(checkUrlFormat('http://127.0.0.1:61852/x', { allowPrivate: true }).port).toBe('61852');
    expect(() => checkUrlFormat('http://127.0.0.1:61852/x')).toThrowError(/ports 80\/443/);
  });
});

describe('assertUrlAllowed', () => {
  it('blocks IP literals in private ranges without needing DNS', async () => {
    await expect(assertUrlAllowed('http://127.0.0.1/')).rejects.toThrowError(SafeFetchError);
    await expect(assertUrlAllowed('http://10.1.2.3/x')).rejects.toThrowError(SafeFetchError);
    await expect(assertUrlAllowed('http://169.254.169.254/latest')).rejects.toThrowError(SafeFetchError);
    await expect(assertUrlAllowed('http://[::1]/')).rejects.toThrowError(SafeFetchError);
  });

  it('blocks localhost (resolves to loopback)', async () => {
    await expect(assertUrlAllowed('http://localhost/')).rejects.toThrowError(SafeFetchError);
  });
});

describe('safeFetchHtml against a local fixture server (allowPrivate)', () => {
  let server: Server;
  let base: string;

  async function start(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve));
  });

  it('returns html and the final URL', async () => {
    await start((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<html><body>hi</body></html>');
    });
    const out = await safeFetchHtml(`${base}/r`, { allowPrivate: true });
    expect(out.status).toBe(200);
    expect(out.text).toContain('hi');
    expect(out.finalUrl).toBe(`${base}/r`);
  });

  it('follows redirects and reports the final URL', async () => {
    await start((req, res) => {
      if (req.url === '/a') {
        res.statusCode = 302;
        res.setHeader('location', '/b');
        res.end();
      } else {
        res.setHeader('content-type', 'text/html');
        res.end('final');
      }
    });
    const out = await safeFetchHtml(`${base}/a`, { allowPrivate: true });
    expect(out.text).toBe('final');
    expect(out.finalUrl).toBe(`${base}/b`);
  });

  it('enforces the redirect limit', async () => {
    await start((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', '/loop');
      res.end();
    });
    await expect(safeFetchHtml(`${base}/loop`, { allowPrivate: true, maxRedirects: 2 })).rejects.toThrowError(
      /Too many redirects/,
    );
  });

  it('rejects non-HTML content', async () => {
    await start((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    await expect(safeFetchHtml(`${base}/j`, { allowPrivate: true })).rejects.toThrowError(/non-HTML/);
  });

  it('enforces the body cap', async () => {
    await start((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('x'.repeat(5000));
    });
    await expect(safeFetchHtml(`${base}/big`, { allowPrivate: true, maxBytes: 100 })).rejects.toThrowError(/exceeds/);
  });

  it('maps non-200 to http_error', async () => {
    await start((_req, res) => {
      res.statusCode = 404;
      res.end('nope');
    });
    let err: SafeFetchError | null = null;
    try {
      await safeFetchHtml(`${base}/missing`, { allowPrivate: true });
    } catch (e) {
      err = e as SafeFetchError;
    }
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err?.code).toBe('http_error');
  });

  it('times out slow servers', async () => {
    await start((_req, res) => {
      setTimeout(() => res.end('late'), 500);
    });
    let err: SafeFetchError | null = null;
    try {
      await safeFetchHtml(`${base}/slow`, { allowPrivate: true, timeoutMs: 50 });
    } catch (e) {
      err = e as SafeFetchError;
    }
    expect(err).toBeInstanceOf(SafeFetchError);
    expect(err?.code).toBe('timeout');
  });
});
