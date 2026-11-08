import { describe, expect, it } from 'vitest';
import { ndjsonResponse } from './http';

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
});
