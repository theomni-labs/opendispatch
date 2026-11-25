// SPDX-License-Identifier: AGPL-3.0-only
// Chunked upload and background steps: Go client.

import type { ImportJob, ImportUploadSession } from '@/lib/types';
import { requireFound } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { idSegment } from './internal/ids';

/** One chunk's bytes, streamed, not buffered. */
export interface ChunkBytes {
  readonly stream: ReadableStream<Uint8Array>;
  readonly length: number;
}

/** Starts a session; returns its chunk size. */
// operationId: createImportUpload
export async function createImportUpload(ctx: RequestContext, body: unknown): Promise<ImportUploadSession> {
  return (await businessFetch<ImportUploadSession>(ctx, '/import-uploads', { method: 'POST', body }))!;
}

// operationId: getImportUpload
export async function getImportUpload(ctx: RequestContext, id: string): Promise<ImportUploadSession> {
  return requireFound(await businessFetch<ImportUploadSession>(ctx, `/import-uploads/${idSegment(id)}`), 'Import upload');
}

/** One chunk; a retry replaces it. */
// operationId: putImportUploadChunk
export async function putImportUploadChunk(ctx: RequestContext, id: string, index: number, bytes: ChunkBytes): Promise<ImportUploadSession> {
  const n = Number.isSafeInteger(index) && index >= 0 && index < 10000 ? index : -1;
  return (await businessFetch<ImportUploadSession>(ctx, `/import-uploads/${idSegment(id)}/chunks/${String(n)}`, { method: 'PUT', bytes }))!;
}

/** Joins the chunks; the job is `uploaded`. */
// operationId: completeImportUpload
export async function completeImportUpload(ctx: RequestContext, id: string): Promise<ImportJob> {
  return (await businessFetch<ImportJob>(ctx, `/import-uploads/${idSegment(id)}/complete`, { method: 'POST' }))!;
}

// operationId: cancelImportUpload
export async function cancelImportUpload(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<undefined>(ctx, `/import-uploads/${idSegment(id)}`, { method: 'DELETE' });
}

/** 202: the step runs on; poll the job. */
// operationId: startImportStep
export async function startImportStep(ctx: RequestContext, id: string, body: unknown): Promise<ImportJob> {
  return (await businessFetch<ImportJob>(ctx, `/imports/${idSegment(id)}/steps`, { method: 'POST', body }))!;
}
