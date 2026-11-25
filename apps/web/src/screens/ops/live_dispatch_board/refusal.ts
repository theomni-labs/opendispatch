// SPDX-License-Identifier: AGPL-3.0-only
import type { ClientFailure } from '@/lib/actions/types';

// A refused Accept: plain words, then the code

export interface Refusal {
  /** taken: the case already has an assignment. */
  readonly plain: 'taken' | 'other';
  /** The server's line with its code, or empty. */
  readonly detail: string;
}

export function refusalOf(failure: ClientFailure): Refusal {
  const detail = failure.code === 'unexpected' || failure.code === 'network' ? '' : failure.message;
  return { plain: failure.code === 'conflict' && failure.message.startsWith('ALREADY_ASSIGNED') ? 'taken' : 'other', detail };
}
