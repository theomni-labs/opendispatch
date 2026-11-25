// SPDX-License-Identifier: AGPL-3.0-only
// Who did it, for a list of audit events. SERVER ONLY: it calls the data layer with the request context.
// An audit event carries the actor's user id only, and the list of users needs `admin.users_roles`, which the Viewer /
// Auditor and the Change Approver lack, so the names come from `listUserDisplayNames` (names only, open to every role).
//
//   const names = actorNames(ctx, events);                       // in the Server Component
//   <AuditTimeline events={events} names={names} />              // plain data to the client component

import type { Role } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';
import { listUserDisplayNames } from '@/lib/data/users';
import { isWorkerActor } from './system-actor';

const CHUNK = 100; // the data function's limit per call

/** Name and, when the server gives it, role. */
export interface ActorPerson {
  readonly name: string;
  readonly role: Role | null;
}

/** Name and role by user id for every actor in `events`. */
export async function actorPeople(ctx: RequestContext, events: readonly { readonly actor_user_id?: string | null | undefined }[]): Promise<Record<string, ActorPerson>> {
  const ids = [...new Set(events.flatMap((event) => (typeof event.actor_user_id === 'string' && !isWorkerActor(event.actor_user_id) ? [event.actor_user_id] : [])))];
  const people: Record<string, ActorPerson> = {};
  for (let start = 0; start < ids.length; start += CHUNK) {
    for (const person of (await listUserDisplayNames(ctx, ids.slice(start, start + CHUNK))).items) people[person.id] = { name: person.display_name, role: person.role ?? null };
  }
  return people;
}

/** Display names by user id for every actor in `events` (system events and unknown ids are left out). */
export async function actorNames(ctx: RequestContext, events: readonly { readonly actor_user_id?: string | null | undefined }[]): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries(await actorPeople(ctx, events)).map(([id, person]) => [id, person.name]));
}
