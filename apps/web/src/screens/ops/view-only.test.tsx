// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { ApprovalActions } from './field_planner/ApprovalActions';
import type { ApprovalBarView } from './field_planner/view';
import { AssignDrawer } from './remote_queue/AssignDrawer';
import { HeaderActions as SimulatorHeader } from './service_level_simulator/HeaderActions';

// A screen showing the "View only" badge must not offer an enabled write action.
const env = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, writes: vi.fn() }));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/x', useRouter: () => env.router }));
vi.mock('./service_level_simulator/actions', () => ({ runSimulationAction: env.writes }));
vi.mock('./field_planner/actions', () => ({ approveRosterAction: env.writes, rejectRosterAction: env.writes, publishRosterAction: env.writes }));
vi.mock('./remote_queue/actions', () => ({ assignReviewerAction: env.writes }));

afterEach(() => {
  cleanup();
  env.writes.mockReset();
  for (const fn of Object.values(env.router)) fn.mockReset();
});

const approval: ApprovalBarView = {
  status: 'approved',
  submittedByName: null,
  submittedByIsMe: false,
  submittedDate: null,
  approvedByName: null,
  approvedByIsMe: false,
  approvedDate: null,
  publishedDate: null,
  canApprove: false,
  canReject: false,
  canSubmit: false,
  canPublish: true,
  approveReason: 'approved',
  rejectReason: 'approved',
  submitReason: 'notDraft',
  publishReason: null,
};

function expectGated(name: string) {
  const button = screen.getByRole('button', { name });
  expect(button.getAttribute('aria-disabled'), name).toBe('true');
  fireEvent.click(button);
}

describe('view-only access: write actions are disabled and never act', () => {
  it('Service-Level Simulator: Run simulation', () => {
    inLocale('en', <SimulatorHeader canEdit={false} hasInputs rosterId="r" runDate="2026-09-01" policy="nearest" />, { module: 'ops.service_level_simulator' });
    expectGated('Run simulation');
    expect(env.writes).not.toHaveBeenCalled();
  });

  it('Field Planner: Publish stays disabled for a view-only person', () => {
    inLocale('en', <ApprovalActions rosterId="ro" approval={approval} canEdit={false} />, { module: 'ops.field_planner' });
    expectGated('Publish (stub)');
    expect(env.writes).not.toHaveBeenCalled();
  });

  it('Remote Queue: Assign in a drawer opened from the address', () => {
    const target = { caseId: 'c', caseNumber: 'C-1', zoneCode: 'Z1', waitLabel: '3 min', candidates: [] };
    inLocale('en', <AssignDrawer target={target} canEdit={false} />, { module: 'ops.remote_queue' });
    expectGated('Assign reviewer');
    expect(env.writes).not.toHaveBeenCalled();
  });
});
