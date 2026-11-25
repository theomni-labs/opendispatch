// SPDX-License-Identifier: AGPL-3.0-only
import { getAssistantStatus, type AssistantStatus } from '@/lib/data/assistant';
import type { RequestContext } from '@/lib/data/guard';

// Server side: may the role use it, is it on

export interface AssistantAvailability {
  readonly configured: boolean;
  readonly ruleDraft: boolean;
  readonly explain: readonly AssistantStatus['features']['explain'][number][];
  readonly ask: boolean;
  readonly importMapping: boolean;
  readonly importIssues: boolean;
  readonly eventNotice: boolean;
  readonly scenarioDraft: boolean;
  readonly handover: boolean;
  readonly alertsDigest: boolean;
}

/** Null when the api cannot say: the feature is then hidden. */
export async function assistantAvailability(ctx: RequestContext): Promise<AssistantAvailability | null> {
  try {
    const status = await getAssistantStatus(ctx);
    return { configured: status.configured, ruleDraft: status.features.rule_draft, explain: status.features.explain, ask: status.features.ask, importMapping: status.features.import_mapping === true, importIssues: status.features.import_issues === true, eventNotice: status.features.event_notice === true, scenarioDraft: status.features.scenario_draft === true, handover: status.features.handover === true, alertsDigest: status.features.alerts_digest === true };
  } catch {
    return null;
  }
}
