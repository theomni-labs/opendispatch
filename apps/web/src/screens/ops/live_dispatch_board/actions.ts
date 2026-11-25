'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Live Dispatch writes

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { acceptRecommendation, controlReplay, overrideAssignment, simulateFeedOutage } from '@/lib/data/dispatch';
import type { Assignment, FallbackState, ReplayState } from '@/lib/types';

const REVALIDATE = '/ops/live-dispatch-board';

export interface AcceptInput {
  readonly caseId: string;
  readonly agentId: string;
}

export interface OverrideInput {
  readonly caseId: string;
  readonly agentId: string;
  readonly reasonCode: string;
  readonly note: string | null;
}

export interface ReplayToggleInput {
  readonly playing: boolean;
}

export interface OutageToggleInput {
  readonly active: boolean;
}

export async function accept(input: AcceptInput): Promise<ActionResult<Assignment>> {
  return runAction(
    async (ctx) => {
      const caseId = pickText(input, 'caseId') ?? '';
      const agentId = pickText(input, 'agentId');
      return await acceptRecommendation(ctx, caseId, { agent_id: agentId });
    },
    { revalidate: REVALIDATE },
  );
}

export async function override(input: OverrideInput): Promise<ActionResult<Assignment>> {
  return runAction(
    async (ctx) => {
      const caseId = pickText(input, 'caseId') ?? '';
      const { agentId, reasonCode, note } = pickFields(input, ['agentId', 'reasonCode', 'note']);
      return await overrideAssignment(ctx, caseId, { agent_id: agentId, reason_code: reasonCode, note });
    },
    { revalidate: REVALIDATE },
  );
}

/** Pause or resume the replay clock (a denial is audited). */
export async function toggleReplay(input: ReplayToggleInput): Promise<ActionResult<ReplayState>> {
  return runAction(
    async (ctx) => {
      const playing = pickFields(input, ['playing'])['playing'];
      return await controlReplay(ctx, { action: playing === true ? 'play' : 'pause' });
    },
    { revalidate: REVALIDATE },
  );
}

/** Simulates the case feed going down, or coming back. */
export async function toggleOutage(input: OutageToggleInput): Promise<ActionResult<FallbackState>> {
  return runAction(
    async (ctx) => {
      const active = pickFields(input, ['active'])['active'];
      return await simulateFeedOutage(ctx, { feed: 'case_feed', active });
    },
    { revalidate: REVALIDATE },
  );
}
