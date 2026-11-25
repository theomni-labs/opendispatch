// SPDX-License-Identifier: AGPL-3.0-only
// The worker's fixed actor ids (worker.go)
const WORKER_ACTOR_IDS: ReadonlySet<string> = new Set([
  '00000000-0000-4000-9000-000000000000',
  '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9000-000000000002',
]);

export type AuditActorType = 'user' | 'system' | 'emergency_admin' | 'demo';

/** True for the worker's own fixed user ids. */
export function isWorkerActor(userId: string | null | undefined): boolean {
  return typeof userId === 'string' && WORKER_ACTOR_IDS.has(userId.toLowerCase());
}

/** The actor type to show: a worker event is `system`. */
export function shownActorType(event: { readonly actor_type: AuditActorType; readonly actor_user_id?: string | null | undefined }): AuditActorType {
  return event.actor_type === 'user' && isWorkerActor(event.actor_user_id) ? 'system' : event.actor_type;
}
