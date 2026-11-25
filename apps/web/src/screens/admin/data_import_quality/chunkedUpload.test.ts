// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { bytesDone, chunkRange, IMPORT_FILE_MAX_BYTES, sendChunks, type SendChunk } from './chunkedUpload';

const ok = (received: number[] = []) => ({ ok: true as const, data: { received } });

describe('chunked upload: slicing', () => {
  it('cuts a file into fixed chunks with a short last one', () => {
    expect(chunkRange(0, 8, 20)).toEqual([0, 8]);
    expect(chunkRange(1, 8, 20)).toEqual([8, 16]);
    expect(chunkRange(2, 8, 20)).toEqual([16, 20]);
    expect(bytesDone(new Set([0, 2]), 8, 20)).toBe(12);
  });

  it('takes 1 GB at most, in 128 chunks of 8 MiB', () => {
    expect(IMPORT_FILE_MAX_BYTES).toBe(2 ** 30);
    expect(chunkRange(127, 8 * 2 ** 20, IMPORT_FILE_MAX_BYTES)).toEqual([127 * 8 * 2 ** 20, IMPORT_FILE_MAX_BYTES]);
  });
});

describe('chunked upload: the send loop', () => {
  const file = new Blob(['abcdefghijklmnopqrst']);
  const plan = { chunkSize: 8, chunkCount: 3 };

  it('sends every chunk in order as its exact slice and reports the bytes held', async () => {
    const seen: [number, string][] = [];
    const send: SendChunk = async (i, slice) => {
      seen.push([i, await slice.text()]);
      return ok();
    };
    const progress = vi.fn();
    const done = new Set<number>();
    expect(await sendChunks(file, plan, done, send, new AbortController().signal, progress)).toEqual({ ok: true });
    expect(seen).toEqual([[0, 'abcdefgh'], [1, 'ijklmnop'], [2, 'qrst']]);
    expect(progress.mock.calls.map((c) => c[0])).toEqual([8, 16, 20]);
    expect([...done]).toEqual([0, 1, 2]);
  });

  it('stops at a refused chunk and a retry sends only what is missing', async () => {
    const send = vi.fn<SendChunk>().mockResolvedValueOnce(ok()).mockResolvedValueOnce({ ok: false, code: 'invalid', message: 'chunk 1 is shorter' });
    const done = new Set<number>();
    const first = await sendChunks(file, plan, done, send, new AbortController().signal, () => undefined);
    expect(first).toEqual({ ok: false, aborted: false, index: 1, failure: { code: 'invalid', message: 'chunk 1 is shorter', reference: undefined, reason: undefined } });
    send.mockResolvedValue(ok());
    expect(await sendChunks(file, plan, done, send, new AbortController().signal, () => undefined)).toEqual({ ok: true });
    expect(send.mock.calls.map((c) => c[0])).toEqual([0, 1, 1, 2]);
  });

  it('a network failure is the failed chunk, code network', async () => {
    const send = vi.fn<SendChunk>().mockRejectedValue(new TypeError('fetch failed'));
    expect(await sendChunks(file, plan, new Set(), send, new AbortController().signal, () => undefined)).toMatchObject({ ok: false, aborted: false, index: 0, failure: { code: 'network' } });
  });

  it('a cancel stops before the next chunk', async () => {
    const controller = new AbortController();
    const send = vi.fn<SendChunk>().mockImplementation(async () => {
      controller.abort();
      return ok();
    });
    expect(await sendChunks(file, plan, new Set(), send, controller.signal, () => undefined)).toEqual({ ok: false, aborted: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
