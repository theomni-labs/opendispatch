'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Leave Planner writes

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { approveLeaveRequest, createLeaveRequest, declineLeaveRequest } from '@/lib/data/leave';
import { DataError, InvalidInputError } from '@/lib/data/errors';
import type { LeaveRequest } from '@/lib/types';
import type { BulkDecideLeaveInput, CreateLeaveRequestInput, DecideLeaveInput } from './types';

const REVALIDATE = '/ops/leave-planner';
/** Bulk bar's max requests per call. */
const MAX_BULK = 100;

export async function createLeaveRequestAction(input: CreateLeaveRequestInput): Promise<ActionResult<LeaveRequest>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['agentId', 'startDate', 'endDate', 'leaveType']);
      return createLeaveRequest(ctx, {
        agent_id: fields['agentId'],
        start_date: fields['startDate'],
        end_date: fields['endDate'],
        leave_type: fields['leaveType'],
      });
    },
    { revalidate: REVALIDATE },
  );
}

export async function decideLeaveAction(input: DecideLeaveInput): Promise<ActionResult<LeaveRequest>> {
  return runAction(
    async (ctx) => {
      const id = pickText(input, 'requestId') ?? '';
      const { decision } = pickFields(input, ['decision']);
      return decision === 'declined' ? declineLeaveRequest(ctx, id) : approveLeaveRequest(ctx, id);
    },
    { revalidate: REVALIDATE },
  );
}

export interface BulkDecideResult {
  readonly decided: number;
  readonly skipped: number;
}

export async function bulkDecideLeaveAction(input: BulkDecideLeaveInput): Promise<ActionResult<BulkDecideResult>> {
  return runAction(
    async (ctx) => {
      const ids = pickTextList(input, 'requestIds', MAX_BULK);
      const { decision } = pickFields(input, ['decision']);
      if (ids === undefined || ids.length === 0 || (decision !== 'approved' && decision !== 'declined')) {
        throw new InvalidInputError(`Leave requests: name 1 to ${String(MAX_BULK)} requests and a decision.`);
      }
      let decided = 0;
      let skipped = 0;
      for (const id of [...new Set(ids)]) {
        try {
          if (decision === 'declined') await declineLeaveRequest(ctx, id);
          else await approveLeaveRequest(ctx, id);
          decided += 1;
        } catch (error) {
          // A row skipped for cause does not fail
          if (!(error instanceof DataError) || error.code === 'unauthenticated') throw error;
          skipped += 1;
        }
      }
      return { decided, skipped };
    },
    { revalidate: REVALIDATE },
  );
}
