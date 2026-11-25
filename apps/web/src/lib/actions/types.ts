// SPDX-License-Identifier: AGPL-3.0-only
// The result of a server action. Pure types and one guard: safe in a client file, in a
// server action file and in a test. Server errors are English; the client shows a translated line per code and the
// English detail (`message`) marked lang="en" (patterns/ActionError).

/** The six ways an action can fail. The first five are the data layer's error codes (lib/data/errors.ts). */
export const ACTION_ERROR_CODES = ['unauthenticated', 'forbidden', 'not_found', 'invalid', 'conflict', 'unexpected'] as const;
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

/** A failure the client can show. `reference` is set only for `unexpected`: `ODP-` and 8 hex characters, also in the server log. */
export interface ActionFailure {
  readonly ok: false;
  readonly code: ActionErrorCode;
  /** The data layer's English detail. Never a stack, an input value or a secret. */
  readonly message: string;
  readonly reference?: string;
  // The api's reason code, translated when known
  readonly reason?: string;
}

export interface ActionSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

/** What every server action returns. `data` must be plain (it is serialised to the browser). */
export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

/** What the client shows for a failure: a server failure, or `network` when the call itself did not complete. */
export interface ClientFailure {
  readonly code: ActionErrorCode | 'network';
  readonly message: string;
  readonly reference?: string | undefined;
  readonly reason?: string | undefined;
}

/** True for a value shaped like an ActionResult. The client checks what an action returned before trusting it. */
export function isActionResult(value: unknown): value is ActionResult<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Readonly<Record<string, unknown>>;
  if (record['ok'] === true) return 'data' in record;
  return record['ok'] === false && (ACTION_ERROR_CODES as readonly unknown[]).includes(record['code']) && typeof record['message'] === 'string';
}
