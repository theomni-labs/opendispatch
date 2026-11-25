// SPDX-License-Identifier: AGPL-3.0-only
// Browser side of the chunked upload.

import type { ActionResult } from '@/lib/actions/types';
import { isActionResult } from '@/lib/actions/types';

/** Chunks the api holds after one is sent. */
export interface ChunkSent {
  readonly received: readonly number[];
}

/** @pure This site's route for a chunk. */
export function chunkPath(uploadId: string, index: number): string {
  return `/api/import-uploads/${encodeURIComponent(uploadId)}/chunks/${String(index)}`;
}

/** One slice to this site's route. */
export async function sendImportUploadChunk(uploadId: string, index: number, slice: Blob, signal?: AbortSignal): Promise<ActionResult<ChunkSent>> {
  const res = await fetch(chunkPath(uploadId, index), {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: slice,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (isActionResult(body)) return body as ActionResult<ChunkSent>;
  return { ok: false, code: 'unexpected', message: `The upload answered ${String(res.status)}.` };
}
