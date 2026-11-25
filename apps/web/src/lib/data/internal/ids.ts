// SPDX-License-Identifier: AGPL-3.0-only
// Checks ids that come from the caller.

import { InvalidInputError } from '../errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a string that is a UUID. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * The id, or InvalidInputError (code `invalid`) when it is not a UUID string. `what` names the record in the message
 * ("City", "Roster"). The message never repeats the value: it may be huge or hostile.
 */
export function requireId(id: unknown, what: string): string {
  if (!isId(id)) throw new InvalidInputError(`${what}: the id must be a UUID.`);
  return id;
}

/** A path segment: a non-UUID becomes one Go refuses. */
export function idSegment(id: unknown): string {
  return isId(id) ? id : 'not-an-id';
}
