'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Assign a reviewer

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { assignRemoteReviewer } from '@/lib/data/remote';
import type { RemoteQueueItem } from '@/lib/types';
import type { AssignReviewerInput } from './types';

const REVALIDATE = '/ops/remote-queue';

export async function assignReviewerAction(input: AssignReviewerInput): Promise<ActionResult<RemoteQueueItem>> {
  return runAction(
    (ctx) => {
      const caseId = pickText(input, 'caseId') ?? '';
      const { agentId } = pickFields(input, ['agentId']);
      return assignRemoteReviewer(ctx, caseId, { agent_id: agentId });
    },
    { revalidate: REVALIDATE },
  );
}
