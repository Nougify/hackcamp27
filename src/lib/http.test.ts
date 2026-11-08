import { describe, expect, it } from 'vitest';
import { ApiError as GenAIError } from '@google/genai';
import { handleRouteError, ndjsonResponse } from './http';

describe('ndjsonResponse', () => {
  it('streams one JSON object per line', async () => {
    const res = ndjsonResponse<{ n: number }>(async (write) => {
      write({ n: 1 });
      write({ n: 2 });
    });
    expect(await res.text()).toBe('{"n":1}\n{"n":2}\n');
  });

  it('aborts the producer signal when the client cancels, and later writes are ignored', async () => {
    let seenAbort = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const res = ndjsonResponse<{ n: number }>(async (write, signal) => {
      write({ n: 1 });
      await gate;
      seenAbort = signal.aborted;
      write({ n: 2 }); // must not throw after cancel
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(seenAbort).toBe(true);
  });

  it('reports a Gemini 429 as RATE_LIMITED', async () => {
    const quota = new GenAIError({ message: 'quota', status: 429 });
    const res = ndjsonResponse<unknown>(async () => {
      throw quota;
    });
    expect(JSON.parse(await res.text()).error.code).toBe('RATE_LIMITED');
    expect(handleRouteError(quota).status).toBe(429);
    expect(handleRouteError(Object.assign(new Error('x'), { status: 429 })).status).toBe(500);
  });
});
