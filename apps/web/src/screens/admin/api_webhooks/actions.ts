'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the API and Webhooks screen: exactly the data functions of lib/data/system.ts.
//
//   createClient       createApiClient       (returns the key ONCE: see below)
//   revokeClient       revokeApiClient
//   rotateClient       rotateApiClient       (returns the new key ONCE)
//   saveHook           createWebhook / updateWebhook
//   removeHook         deleteWebhook
//   testHook           testWebhook           (LABELLED STUB: nothing is sent)
//   retryDelivery      retryWebhookDelivery  (LABELLED STUB: nothing is sent)
//   saveLimits         updateRateLimits      (STORED, NOT ENFORCED)
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits.
//
// THE KEY. createApiClient returns the secret once; it is not stored anywhere (the data layer keeps its last four
// characters). It travels only in the result of createClient, to the dialog that must be acknowledged: it is never put in a
// URL, a cookie, a log, a store, the audit event (its summary and detail name the client and the scopes only) or the paths this
// action revalidates. A failure returns the data layer's message, which never holds it.

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { ForbiddenError } from '@/lib/data/errors';
import { createApiClient, createWebhook, deleteWebhook, getWebhook, listApiClients, retryWebhookDelivery, revokeApiClient, rotateApiClient, testWebhook, updateRateLimits, updateWebhook } from '@/lib/data/system';
import type { ClientCreated, ClientInput, ClientRevoked, ClientTarget, DeliveryRetried, DeliveryTarget, HookInput, HookSaved, HookTarget, HookTested, LimitsInput, LimitsSaved, Scope } from './types';

const REVALIDATE = '/admin/api-webhooks';
const MAX_EVENTS = 20;

/** A read the write needs first. A role that may not even read is refused by the write itself, so the refusal is audited. */
async function readFirst<T>(read: () => Promise<T>, refuse: () => Promise<unknown>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) await refuse();
    throw error;
  }
}

/** Creates an API client and returns its key, once. */
export async function createClient(input: ClientInput): Promise<ActionResult<ClientCreated>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['name', 'scopes']);
      const created = await createApiClient(ctx, { name: fields.name, scopes: pickTextList(input, 'scopes', MAX_EVENTS) });
      return { id: created.client.id, name: created.client.name, secret: created.secret } satisfies ClientCreated;
    },
    { revalidate: REVALIDATE },
  );
}

/** Revokes an API client: systems that use its key stop working. Cannot be undone. */
export async function revokeClient(input: ClientTarget): Promise<ActionResult<ClientRevoked>> {
  return runAction(
    async (ctx) => {
      const clientId = pickText(input, 'clientId') ?? '';
      // The name is for the toast; a role that cannot read the clients is refused (and audited) by the write itself.
      const found = await readFirst(async () => (await listApiClients(ctx, { limit: 200 })).items.find((client) => client.id === clientId), () => revokeApiClient(ctx, clientId));
      await revokeApiClient(ctx, clientId);
      return { id: clientId, name: found?.name ?? '' } satisfies ClientRevoked;
    },
    { revalidate: REVALIDATE },
  );
}

/** Issues a new key for a client and returns it, once. */
export async function rotateClient(input: ClientTarget): Promise<ActionResult<ClientCreated>> {
  return runAction(
    async (ctx) => {
      const rotated = await rotateApiClient(ctx, pickText(input, 'clientId') ?? '');
      return { id: rotated.client.id, name: rotated.client.name, secret: rotated.secret } satisfies ClientCreated;
    },
    { revalidate: REVALIDATE },
  );
}

function hookBody(input: unknown): Record<string, unknown> {
  const fields = pickFields(input, ['name', 'target_url', 'is_enabled']);
  return { name: fields.name, target_url: fields.target_url, event_types: pickTextList(input, 'event_types', MAX_EVENTS), is_enabled: fields.is_enabled };
}

/** Adds a webhook, or changes one (`hookId`). */
export async function saveHook(input: HookInput): Promise<ActionResult<HookSaved>> {
  return runAction(
    async (ctx) => {
      const hookId = pickText(input, 'hookId');
      const saved = hookId === undefined ? await createWebhook(ctx, hookBody(input)) : await updateWebhook(ctx, hookId, hookBody(input));
      return { id: saved.id, name: saved.name } satisfies HookSaved;
    },
    { revalidate: REVALIDATE },
  );
}

export async function removeHook(input: HookTarget): Promise<ActionResult<{ readonly removed: true }>> {
  return runAction(
    async (ctx) => {
      await deleteWebhook(ctx, pickText(input, 'hookId') ?? '');
      return { removed: true } as const;
    },
    { revalidate: REVALIDATE },
  );
}

/** LABELLED STUB: a scripted test delivery. Nothing is sent; the audit event says so (`stub: true`). */
export async function testHook(input: HookTarget): Promise<ActionResult<HookTested>> {
  return runAction(
    async (ctx) => {
      const hookId = pickText(input, 'hookId') ?? '';
      // The name is for the toast; a role that cannot read the webhook is refused (and audited) by the test itself.
      const name = await readFirst(async () => (await getWebhook(ctx, hookId)).name, () => testWebhook(ctx, hookId));
      const result = await testWebhook(ctx, hookId);
      return { name, delivered: result.delivered, httpStatus: result.http_status } satisfies HookTested;
    },
    { revalidate: REVALIDATE },
  );
}

/** LABELLED STUB: retries a failed delivery by script. Nothing is sent; the audit event says so (`stub: true`). */
export async function retryDelivery(input: DeliveryTarget): Promise<ActionResult<DeliveryRetried>> {
  return runAction(
    async (ctx) => {
      const result = await retryWebhookDelivery(ctx, pickText(input, 'deliveryId') ?? '');
      return { delivered: result.delivered, httpStatus: result.delivery.http_status ?? null, attempts: result.delivery.attempt_count } satisfies DeliveryRetried;
    },
    { revalidate: REVALIDATE },
  );
}

/** Saves the limits per scope. STORED, NOT ENFORCED: nothing in demo mode counts or refuses a request. */
export async function saveLimits(input: LimitsInput): Promise<ActionResult<LimitsSaved>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['limits']);
      const saved = await updateRateLimits(ctx, { limits: Array.isArray(fields.limits) ? fields.limits.map((entry) => pickFields(entry, ['scope', 'requests_per_minute', 'burst'])) : fields.limits });
      return { limits: saved.limits.map((limit) => ({ scope: limit.scope as Scope, requestsPerMinute: limit.requests_per_minute, burst: limit.burst })) } satisfies LimitsSaved;
    },
    { revalidate: REVALIDATE },
  );
}
