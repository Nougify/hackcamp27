import { describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, readImages, visionUnavailable } from './upload';

function fakeRequest(form: FormData | Error, contentLength?: number): Request {
  return {
    headers: { get: (key: string) => (key === 'content-length' && contentLength !== undefined ? String(contentLength) : null) },
    formData: async () => {
      if (form instanceof Error) throw form;
      return form;
    },
  } as unknown as Request;
}

async function codeOf(result: Awaited<ReturnType<typeof readImages>>): Promise<string> {
  if (result.ok) throw new Error('expected a failure result');
  const body = await result.response.json();
  return body.error.code;
}

describe('readImages', () => {
  it('rejects when content-length exceeds the proxy body cap, before parsing the body', async () => {
    const req = fakeRequest(new Error('should not be read'), 11 * 1024 * 1024);
    const result = await readImages(req, 'photo', 3);
    expect(await codeOf(result)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a body that is not multipart form data', async () => {
    const req = fakeRequest(new Error('bad body'));
    const result = await readImages(req, 'photo', 3);
    expect(await codeOf(result)).toBe('BAD_REQUEST');
  });

  it('rejects when no file is attached', async () => {
    const result = await readImages(fakeRequest(new FormData()), 'photo', 3);
    expect(await codeOf(result)).toBe('BAD_REQUEST');
  });

  it('rejects more files than the given max', async () => {
    const form = new FormData();
    for (let i = 0; i < 4; i++) {
      form.append('photo', new File([new Uint8Array([1, 2, 3])], `p${i}.jpg`, { type: 'image/jpeg' }));
    }
    const result = await readImages(fakeRequest(form), 'photo', 3);
    expect(await codeOf(result)).toBe('BAD_REQUEST');
  });

  it('rejects a file over MAX_IMAGE_BYTES', async () => {
    const form = new FormData();
    form.append('photo', new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' }));
    const result = await readImages(fakeRequest(form), 'photo', 1);
    expect(await codeOf(result)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a disallowed mime type', async () => {
    const form = new FormData();
    form.append('photo', new File([new Uint8Array([1])], 'p.gif', { type: 'image/gif' }));
    const result = await readImages(fakeRequest(form), 'photo', 1);
    expect(await codeOf(result)).toBe('BAD_REQUEST');
  });

  it('base64-encodes accepted photos and returns the original form', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const form = new FormData();
    form.append('photo', new File([bytes], 'p.jpg', { type: 'image/jpeg' }));
    form.append('note', 'hello');
    const result = await readImages(fakeRequest(form), 'photo', 1);
    if (!result.ok) throw new Error('expected success');
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mimeType).toBe('image/jpeg');
    expect(Buffer.from(result.images[0].base64, 'base64')).toEqual(Buffer.from(bytes));
    expect(result.form.get('note')).toBe('hello');
  });
});

describe('visionUnavailable', () => {
  it('logs only the error message (never the raw error) and returns a generic response', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = visionUnavailable(new Error('secret photo bytes leaked here'));
    const body = await res.json();
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.error.message).not.toContain('secret photo bytes');
    expect(spy).toHaveBeenCalledWith('[vision] extraction failed:', 'secret photo bytes leaked here');
    spy.mockRestore();
  });

  it('handles a non-Error throw without crashing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = visionUnavailable('a plain string');
    const body = await res.json();
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(spy).toHaveBeenCalledWith('[vision] extraction failed:', 'unknown error');
    spy.mockRestore();
  });
});
