'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { isActionResult, type ActionResult, type ClientFailure } from '@/lib/actions/types';
import { sendImportUploadChunk } from '@/lib/data/import-upload-client';
import { bytesDone, sendChunks, type StartedUpload, type StartUploadInput } from './chunkedUpload';
import { cancelUpload, finishUpload, startUpload } from './actions';
import type { UploadOutcome } from './types';

export type UploadPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'uploading' | 'joining'; readonly name: string; readonly size: number; readonly sent: number }
  | { readonly phase: 'failed'; readonly name: string; readonly size: number; readonly sent: number; readonly part: number | null; readonly parts: number; readonly failure: ClientFailure };

export interface ChunkedUpload {
  readonly state: UploadPhase;
  /** A refusal before any chunk is sent. */
  readonly error: ClientFailure | null;
  readonly start: (file: File, input: Omit<StartUploadInput, 'file_name' | 'size'>) => void;
  readonly retry: () => void;
  readonly cancel: () => void;
  readonly reset: () => void;
}

async function call<T>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T> | { readonly ok: false; readonly code: 'network'; readonly message: '' }> {
  try {
    const out: unknown = await run();
    if (isActionResult(out)) return out as ActionResult<T>;
  } catch {
    // the call did not complete
  }
  return { ok: false, code: 'network', message: '' };
}

const failureOf = (r: { code: ClientFailure['code']; message: string; reference?: string | undefined; reason?: string | undefined }): ClientFailure => ({ code: r.code, message: r.message, reference: r.reference, reason: r.reason });

/** Start, send 8 MB slices one by one, join. */
export function useChunkedUpload(onDone: (outcome: UploadOutcome) => void, onCancelled: () => void): ChunkedUpload {
  const router = useRouter();
  const [state, setState] = useState<UploadPhase>({ phase: 'idle' });
  const [error, setError] = useState<ClientFailure | null>(null);
  const file = useRef<File | null>(null);
  const plan = useRef<StartedUpload | null>(null);
  const done = useRef(new Set<number>());
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({ onDone, onCancelled });
  useEffect(() => {
    latest.current = { onDone, onCancelled };
  });
  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async () => {
    const f = file.current;
    const p = plan.current;
    if (f === null || p === null) return;
    const controller = new AbortController();
    abort.current = controller;
    const base = { name: f.name, size: f.size };
    setState({ phase: 'uploading', ...base, sent: bytesDone(done.current, p.chunkSize, f.size) });
    const sent = await sendChunks(f, p, done.current, (i, slice, signal) => sendImportUploadChunk(p.uploadId, i, slice, signal), controller.signal, (bytes) => setState({ phase: 'uploading', ...base, sent: bytes }));
    if (controller.signal.aborted) return;
    if (!sent.ok) {
      if (!sent.aborted) {
        setState({ phase: 'failed', ...base, sent: bytesDone(done.current, p.chunkSize, f.size), part: sent.index, parts: p.chunkCount, failure: sent.failure });
        if (sent.failure.code === 'unauthenticated') router.replace('/');
      }
      return;
    }
    setState({ phase: 'joining', ...base, sent: f.size });
    const job = await call(() => finishUpload({ uploadId: p.uploadId }));
    if (controller.signal.aborted) return;
    if (!job.ok) {
      setState({ phase: 'failed', ...base, sent: f.size, part: null, parts: p.chunkCount, failure: failureOf(job) });
      return;
    }
    file.current = null;
    plan.current = null;
    setState({ phase: 'idle' });
    latest.current.onDone(job.data);
  }, [router]);

  const start = useCallback(
    (f: File, input: Omit<StartUploadInput, 'file_name' | 'size'>) => {
      setError(null);
      file.current = f;
      done.current = new Set();
      setState({ phase: 'uploading', name: f.name, size: f.size, sent: 0 });
      void (async () => {
        const started = await call(() => startUpload({ ...input, file_name: f.name, size: f.size }));
        if (!started.ok) {
          setState({ phase: 'idle' });
          setError(failureOf(started));
          if (started.code === 'unauthenticated') router.replace('/');
          return;
        }
        plan.current = started.data;
        for (const i of started.data.received) done.current.add(i);
        await run();
      })();
    },
    [router, run],
  );

  const retry = useCallback(() => void run(), [run]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    const p = plan.current;
    file.current = null;
    plan.current = null;
    setState({ phase: 'idle' });
    if (p !== null) void call(() => cancelUpload({ uploadId: p.uploadId }));
    latest.current.onCancelled();
  }, []);

  const reset = useCallback(() => setError(null), []);
  return { state, error, start, retry, cancel, reset };
}
