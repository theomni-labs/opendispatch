'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useToast } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from '@/i18n/navigation';
import { isActionResult, type ActionResult, type ClientFailure } from '@/lib/actions/types';
import { errorTitleKey } from './ActionError';

// The client half of every write. Wrap a server action (its `actions.ts` returns an ActionResult):
//
//   const invite = useAdminAction(inviteUser, {
//     successTitle: t('toast.invited'),
//     successDescription: (user) => t('toast.invitedDesc', { name: user.display_name }),
//     onSuccess: (user) => showUser(user.id),
//   });
//   <ActionError error={invite.error} onDismiss={invite.reset} />       // inline Alert, in the form or dialog
//   <Button loading={invite.pending} onClick={() => invite.run({ ... })}>
//
// What it does: the call runs inside a transition (`pending`, and the page keeps responding); a success shows a toast
// with a translated line (`patterns.action.saved` when the caller gives none) and calls `onSuccess`; a failure is kept as
// `error` for <ActionError> (a translated line per code, the server's English detail marked lang="en"), or shown as a toast
// with `failureToast`; `unauthenticated` also sends the person to the start page. A call that does not complete (the
// network, a 413) is the client-only code `network`. It never reads or sends a role, customer or context: an action takes
// what the person typed and builds its own context on the server.

export interface UseAdminActionOptions<T> {
  /** Toast title on success, in the reader's language. Default: "Saved". */
  readonly successTitle?: string | ((data: T) => string) | undefined;
  /** A line under the title: text, or an element (a translated line and the server's English detail). */
  readonly successDescription?: ReactNode | ((data: T) => ReactNode) | undefined;
  /** No toast on success (the caller shows its own feedback). */
  readonly quiet?: boolean | undefined;
  readonly onSuccess?: ((data: T) => void) | undefined;
  readonly onFailure?: ((failure: ClientFailure) => void) | undefined;
  /** Show a failure as a toast instead of leaving it in `error` (a row action with no form to hold an Alert). */
  readonly failureToast?: boolean | undefined;
}

export interface AdminAction<A extends readonly unknown[]> {
  /** Starts the action. Ignored while one is running. */
  readonly run: (...args: A) => void;
  readonly pending: boolean;
  readonly error: ClientFailure | null;
  /** Clears `error` (a dismiss button, or when the dialog closes). */
  readonly reset: () => void;
}

const resolve = <T, R>(value: R | ((data: T) => R), data: T): R => (typeof value === 'function' ? (value as (data: T) => R)(data) : value);
const present = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false && node !== '';

export function useAdminAction<A extends readonly unknown[], T>(action: (...args: A) => Promise<ActionResult<T>>, options: UseAdminActionOptions<T> = {}): AdminAction<A> {
  const t = useTranslations('patterns.action');
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ClientFailure | null>(null);

  // The latest options and action, so `run` keeps one identity while the caller's closures change every render.
  const latest = useRef({ action, options, t, toast, router });
  useEffect(() => {
    latest.current = { action, options, t, toast, router };
  });
  const running = useRef(false);

  const run = useCallback((...args: A) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    startTransition(async () => {
      const { action: call } = latest.current;
      let result: ActionResult<T> | undefined;
      try {
        const returned: unknown = await call(...args);
        if (isActionResult(returned)) result = returned as ActionResult<T>;
      } catch {
        // The call itself did not complete: the network, a body over the limit, a server that restarted.
      }
      // Read again: the caller's texts may have changed while the call ran (a language switch).
      const { options: opts, t: text, toast: notify, router: nav } = latest.current;
      running.current = false;
      if (result?.ok === true) {
        if (opts.quiet !== true) {
          const description = opts.successDescription === undefined ? undefined : resolve<T, ReactNode>(opts.successDescription, result.data);
          notify({ title: opts.successTitle === undefined ? text('saved') : resolve(opts.successTitle, result.data), ...(present(description) ? { description } : {}), tone: 'success' });
        }
        opts.onSuccess?.(result.data);
        return;
      }
      const failure: ClientFailure = result === undefined ? { code: 'network', message: '' } : { code: result.code, message: result.message, reference: result.reference, ...(result.reason === undefined ? {} : { reason: result.reason }) };
      if (opts.failureToast === true) notify({ title: text(errorTitleKey(failure)), tone: 'danger' });
      else setError(failure);
      opts.onFailure?.(failure);
      if (failure.code === 'unauthenticated') nav.replace('/');
    });
  }, []);

  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}
