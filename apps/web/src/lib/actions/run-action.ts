// SPDX-License-Identifier: AGPL-3.0-only
// The server side of every write. NOT a 'use server' file: an `actions.ts` imports it.
//
//   'use server';
//   export async function inviteUser(input: InviteInput): Promise<ActionResult<User>> {
//     return runAction((ctx) => createUser(ctx, pickFields(input, ['email', 'display_name', 'assigned_role', 'zone_ids'])),
//       { revalidate: '/admin/users-roles' });
//   }
//
// `runAction` builds the request context on the server, awaits the audited data
// function, and turns what happens into an ActionResult:
//   - the data layer's five errors keep their code and their English message (the client translates the code);
//   - anything else is `unexpected`: a reference `ODP-` + 8 hex characters, logged on the server with the error's name
//     and stack frames only, never its message (a message can hold an input value) and never the input itself;
//   - on success the paths in `revalidate` are refreshed in both languages, so the page shows the change.
// `fn` receives the context; an action never takes one, nor a customer, user, role, zone scope or install mode, as an
// argument (tools/rules/context-rules.test.ts scans every 'use server' file).

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { routing } from '@/i18n/routing';
import { requireRequestContext } from '@/lib/data/context';
import { DataError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import type { ActionResult } from './types';

export interface RunActionOptions {
  /** Public paths without the locale (`/admin/users-roles`) to refresh after a successful write, in every language. */
  readonly revalidate?: string | readonly string[] | undefined;
}

/** `ODP-` and 8 upper-case hex characters, the form the sign-in message page also uses. */
export function newReference(): string {
  return `ODP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** The stack frames of an error without its first line (the message), so a log line cannot carry an input value. */
function framesOf(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return '';
  return error.stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, 6)
    .join('\n');
}

function logUnexpected(reference: string, error: unknown, what: string): void {
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[opendispatch] ${what} ${reference}: ${name}\n${framesOf(error)}`);
}

function pathsOf(revalidate: RunActionOptions['revalidate']): string[] {
  const list = revalidate === undefined ? [] : typeof revalidate === 'string' ? [revalidate] : [...revalidate];
  return list.flatMap((path) => (path.startsWith('/') && !path.includes('?') ? routing.locales.map((locale) => `/${locale}${path}`) : []));
}

export async function runAction<T>(fn: (ctx: RequestContext) => T | Promise<T>, options: RunActionOptions = {}): Promise<ActionResult<T>> {
  let data: T;
  try {
    const ctx = await requireRequestContext();
    data = await fn(ctx);
  } catch (error) {
    if (error instanceof DataError) return { ok: false, code: error.code, message: error.message, ...(error.reason === undefined ? {} : { reason: error.reason }) };
    const reference = newReference();
    logUnexpected(reference, error, 'action failed');
    return { ok: false, code: 'unexpected', message: 'Something went wrong.', reference };
  }
  // The write is done. A refresh that fails must not turn a saved change into an error.
  for (const path of pathsOf(options.revalidate)) {
    try {
      revalidatePath(path);
    } catch (error) {
      logUnexpected(newReference(), error, `revalidation of ${path} failed`);
    }
  }
  return { ok: true, data };
}
