'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Data Sources and Integrations screen: exactly the data functions named here.
//
//   testFeed, testAllFeeds     testIntegration            (LABELLED STUB: nothing is sent; the answer is scripted from the stored health)
//   switchFeed                 updateIntegration          (is_enabled)
//   changeStage, allToShadow   setZoneStage               (one call per zone: "all zones to shadow" is N calls, each audited)
//   saveFallback               updateLiveAssignmentSettings
//   saveSuggestions            updateLiveAssignmentSettings
//   sendSignal                 sendFallbackSignal         (fallback or resume, with a reason)
//   setMaintenance             setMaintenanceMode
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. A feed is an
// `integrationId`, a zone a `zoneId`. Where an action must read first (Test all, All zones to shadow), a caller who may not even
// read lets the write run on an id that names nothing, so its own permission check refuses and audits it instead of
// failing earlier with nothing written. (tools/rules/context-rules.test.ts scans this file for those names.)
//
// Guardrail 11 (no automatic stage without shadow results and a tested fallback) is NOT enforced by setZoneStage yet;
// the operator fallback rule holds: nothing here removes the customer's dispatch as the fallback.

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { DataError, ForbiddenError, NotFoundError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { listZoneStages, sendFallbackSignal, setMaintenanceMode } from '@/lib/data/dispatch';
import { setZoneStage, updateLiveAssignmentSettings } from '@/lib/data/settings';
import { listIntegrations, testIntegration, updateIntegration } from '@/lib/data/system';
import type { AllShadowResult, AllToShadow, DispatchSuggestions, FallbackChanged, FallbackSettings, FeedSwitch, FeedTarget, FeedTestResult, MaintenanceSwitch, SignalRequest, StageChange, StageChanged, TestAllResult } from './types';

const REVALIDATE = '/admin/data-sources';
/** An id that names nothing: it stands in when the caller may not read, so the write refuses and audits itself. */
const NO_ID = '00000000-0000-4000-8000-000000000000';
/** An answer slower than this is called slow (the scripted degraded feed answers in 1,800 ms or more). */
const SLOW_MS = 1000;

/** The read; a Go refusal denies the write. */
async function readOrDeny<T>(read: () => Promise<T>, deny: () => Promise<unknown>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) await deny();
    throw error;
  }
}

/** The write; an id that names nothing is fine. */
async function unlessMissing(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
}

const textOrNull = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
};

/** One feed, tested. The scripted agent of the data layer answers from the stored health. */
export async function testFeed(input: FeedTarget): Promise<ActionResult<FeedTestResult>> {
  return runAction(
    async (ctx) => {
      const integrationId = pickText(input, 'integrationId') ?? '';
      const result = await testIntegration(ctx, integrationId);
      return { integrationId, ok: result.ok, latencyMs: result.latency_ms } satisfies FeedTestResult;
    },
    { revalidate: REVALIDATE },
  );
}

/** Tests every feed that is switched on, one call each (each audited). Off feeds are left alone, as the mockup does. */
export async function testAllFeeds(): Promise<ActionResult<TestAllResult>> {
  return runAction(
    async (ctx) => {
      const feeds = (await readOrDeny(() => listIntegrations(ctx, { limit: 200 }), () => testIntegration(ctx, NO_ID))).items;
      let answered = 0;
      let slow = 0;
      let failed = 0;
      let tested = 0;
      for (const feed of feeds.filter((f) => f.is_enabled)) {
        tested += 1;
        const result = await testIntegration(ctx, feed.id);
        if (!result.ok) failed += 1;
        else if ((result.latency_ms ?? 0) >= SLOW_MS) slow += 1;
        else answered += 1;
      }
      return { tested, answered, slow, failed } satisfies TestAllResult;
    },
    { revalidate: REVALIDATE },
  );
}

export async function switchFeed(input: FeedSwitch): Promise<ActionResult<{ integrationId: string; enabled: boolean }>> {
  return runAction(
    async (ctx) => {
      const integrationId = pickText(input, 'integrationId') ?? '';
      const enabled = pickFields(input, ['enabled'])['enabled'];
      const saved = await updateIntegration(ctx, integrationId, { is_enabled: enabled });
      return { integrationId, enabled: saved.is_enabled };
    },
    { revalidate: REVALIDATE },
  );
}

/** Sets the live-assignment stage of one zone. Guardrail 11 is not enforced yet; the data layer accepts the change. */
export async function changeStage(input: StageChange): Promise<ActionResult<StageChanged>> {
  return runAction(
    async (ctx) => {
      const zoneId = pickText(input, 'zoneId') ?? '';
      const saved = await setZoneStage(ctx, zoneId, { stage: pickText(input, 'stage'), reason: textOrNull(pickText(input, 'reason')) });
      return { zoneId, stage: saved.stage } satisfies StageChanged;
    },
    { revalidate: REVALIDATE },
  );
}

/**
 * Every zone that is not in shadow goes to shadow, one data call each. A refusal for one zone is counted and the rest go on; a
 * refusal that concerns the caller (no session, no permission) stops at the first zone, so a viewer leaves one `denied` event.
 */
export async function allToShadow(input: AllToShadow): Promise<ActionResult<AllShadowResult>> {
  return runAction(
    async (ctx) => {
      const reason = textOrNull(pickText(input, 'reason'));
      const stages = (await readOrDeny(() => listZoneStages(ctx, { limit: 200 }), () => setZoneStage(ctx, NO_ID, { stage: 'shadow', reason }))).items;
      let changed = 0;
      let failed = 0;
      const pending = stages.filter((s) => s.stage !== 'shadow');
      // Nothing to change: Go still says who may.
      if (pending.length === 0) await unlessMissing(() => setZoneStage(ctx, NO_ID, { stage: 'shadow', reason }));
      for (const stage of pending) {
        try {
          await setZoneStage(ctx, stage.zone_id, { stage: 'shadow', reason });
          changed += 1;
        } catch (error) {
          if (!(error instanceof DataError) || error.code === 'forbidden' || error.code === 'unauthenticated') throw error;
          failed += 1;
        }
      }
      return { changed, failed } satisfies AllShadowResult;
    },
    { revalidate: REVALIDATE },
  );
}

/** The fallback timeout (1 to 300 s) and the decision deadline (50 to 30,000 ms). */
export async function saveFallback(input: FallbackSettings): Promise<ActionResult<FallbackSettings>> {
  return runAction(
    async (ctx) => {
      const saved = await updateLiveAssignmentSettings(ctx, { fallback_timeout_seconds: pickFields(input, ['timeoutSeconds'])['timeoutSeconds'], decision_deadline_ms: pickFields(input, ['deadlineMs'])['deadlineMs'] });
      return { timeoutSeconds: saved.fallback_timeout_seconds, deadlineMs: saved.decision_deadline_ms ?? 2000 } satisfies FallbackSettings;
    },
    { revalidate: REVALIDATE },
  );
}

/** Waiting spots, their drive cap and the prayer penalty (advisory, never an assignment). */
export async function saveSuggestions(input: DispatchSuggestions): Promise<ActionResult<DispatchSuggestions>> {
  return runAction(
    async (ctx) => {
      const picked = pickFields(input, ['reposition', 'maxMoveKm', 'prayerPenalty']);
      const saved = await updateLiveAssignmentSettings(ctx, {
        dispatch_reposition: picked['reposition'],
        dispatch_reposition_max_move_km: picked['maxMoveKm'],
        dispatch_prayer_penalty: picked['prayerPenalty'],
      });
      return { reposition: saved.dispatch_reposition ?? false, maxMoveKm: saved.dispatch_reposition_max_move_km ?? 5, prayerPenalty: saved.dispatch_prayer_penalty ?? false } satisfies DispatchSuggestions;
    },
    { revalidate: REVALIDATE },
  );
}

/** Tells the customer's system to assign until told otherwise (`fallback`), or hands control back (`resume`). A reason is written. */
export async function sendSignal(input: SignalRequest): Promise<ActionResult<FallbackChanged>> {
  return runAction(
    async (ctx) => {
      const state = await sendFallbackSignal(ctx, pickFields(input, ['signal', 'reason']));
      return { state: state.state } satisfies FallbackChanged;
    },
    { revalidate: REVALIDATE },
  );
}

/** Maintenance mode: the case feed answers "busy, retry" and the customer's dispatch assigns. */
export async function setMaintenance(input: MaintenanceSwitch): Promise<ActionResult<FallbackChanged>> {
  return runAction(
    async (ctx: RequestContext) => {
      const state = await setMaintenanceMode(ctx, { enabled: pickFields(input, ['enabled'])['enabled'] });
      return { state: state.state } satisfies FallbackChanged;
    },
    { revalidate: REVALIDATE },
  );
}
