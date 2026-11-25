'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { isActionResult, type ActionResult, type ClientFailure } from '@/lib/actions/types';
import { startStep, stepProgress } from './actions';
import type { StepName, StepView } from './importSteps';

/** How often a running step is asked about. */
export const STEP_POLL_MS = 2000;

export interface ImportStepRun {
  /** The job's step; running while it works. */
  readonly view: StepView | null;
  readonly starting: boolean;
  readonly running: boolean;
  /** A refused start, or the step's failure. */
  readonly error: ClientFailure | null;
  readonly start: (step: StepName, onStarted?: () => void) => void;
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

/** Starts a step, then polls until it ends. */
export function useImportStep(jobId: string | null, initial: StepView | null, onDone: (view: StepView) => void): ImportStepRun {
  const router = useRouter();
  const [view, setView] = useState<StepView | null>(initial);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ClientFailure | null>(null);
  const latest = useRef(onDone);
  useEffect(() => {
    latest.current = onDone;
  });
  // another job, or fresh server data
  const [seen, setSeen] = useState({ jobId, initial });
  if (seen.jobId !== jobId || (seen.initial !== initial && view?.state !== 'running')) {
    setSeen({ jobId, initial });
    setView(initial);
  }
  const running = view?.state === 'running';

  useEffect(() => {
    if (!running || jobId === null) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void call(() => stepProgress({ jobId })).then((r) => {
        if (!live) return;
        if (!r.ok) {
          if (r.code === 'unauthenticated') router.replace('/');
          setView((v) => (v === null ? v : { ...v }));
          return;
        }
        setView(r.data);
        if (r.data.state === 'failed') setError({ code: 'conflict', message: r.data.error ?? '' });
        if (r.data.state !== 'running') latest.current(r.data);
      });
    }, STEP_POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [running, jobId, view, router]);

  const start = useCallback(
    (step: StepName, onStarted?: () => void) => {
      if (jobId === null || starting || running) return;
      setError(null);
      setStarting(true);
      void call(() => startStep({ jobId, step })).then((r) => {
        setStarting(false);
        if (!r.ok) {
          setError(r.code === 'network' ? { code: 'network', message: '' } : { code: r.code, message: r.message, reference: r.reference, reason: r.reason });
          if (r.code === 'unauthenticated') router.replace('/');
          return;
        }
        setView(r.data);
        onStarted?.();
      });
    },
    [jobId, starting, running, router],
  );

  const reset = useCallback(() => setError(null), []);
  return { view, starting, running, error, start, reset };
}
