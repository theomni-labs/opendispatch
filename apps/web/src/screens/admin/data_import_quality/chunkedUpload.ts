// SPDX-License-Identifier: AGPL-3.0-only
// Chunked upload: slicing and the send loop (pure).

import type { ActionResult, ClientFailure } from '@/lib/actions/types';
import type { UploadSource } from './types';

/** The largest file the screen sends: 1 GB. */
export const IMPORT_FILE_MAX_BYTES = 1_073_741_824;

export interface StartUploadInput {
  readonly file_name: string;
  readonly size: number;
  readonly mapping_version: string;
  readonly data_source?: UploadSource;
}

export interface StartedUpload {
  readonly uploadId: string;
  readonly chunkSize: number;
  readonly chunkCount: number;
  readonly received: readonly number[];
}

export interface UploadTarget {
  readonly uploadId: string;
}

/** Byte range [start, end) of chunk `index`. */
export function chunkRange(index: number, chunkSize: number, size: number): readonly [number, number] {
  const start = index * chunkSize;
  return [start, Math.min(size, start + chunkSize)];
}

/** Bytes held: the sum of the chunks in `done`. */
export function bytesDone(done: ReadonlySet<number>, chunkSize: number, size: number): number {
  let n = 0;
  for (const i of done) {
    const [a, b] = chunkRange(i, chunkSize, size);
    n += Math.max(0, b - a);
  }
  return n;
}

export type SendChunk = (index: number, slice: Blob, signal: AbortSignal) => Promise<ActionResult<{ readonly received: readonly number[] }>>;

export type ChunkRun = { readonly ok: true } | { readonly ok: false; readonly aborted: true } | { readonly ok: false; readonly aborted: false; readonly index: number; readonly failure: ClientFailure };

/** Sends missing chunks; stops at a failure. */
export async function sendChunks(file: Blob, plan: Pick<StartedUpload, 'chunkSize' | 'chunkCount'>, done: Set<number>, send: SendChunk, signal: AbortSignal, onProgress: (bytes: number) => void): Promise<ChunkRun> {
  for (let i = 0; i < plan.chunkCount; i++) {
    if (done.has(i)) continue;
    if (signal.aborted) return { ok: false, aborted: true };
    const [a, b] = chunkRange(i, plan.chunkSize, file.size);
    let result: Awaited<ReturnType<SendChunk>>;
    try {
      result = await send(i, file.slice(a, b), signal);
    } catch {
      if (signal.aborted) return { ok: false, aborted: true };
      return { ok: false, aborted: false, index: i, failure: { code: 'network', message: '' } };
    }
    if (!result.ok) return { ok: false, aborted: false, index: i, failure: { code: result.code, message: result.message, reference: result.reference, reason: result.reason } };
    done.add(i);
    onProgress(bytesDone(done, plan.chunkSize, file.size));
  }
  return { ok: true };
}
