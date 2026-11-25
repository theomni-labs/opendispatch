// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { OverrideDrawer } from './OverrideDrawer';

const actions = vi.hoisted(() => ({ createOverrideAction: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('./actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams(), usePathname: () => '/ops/field-planner' }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/field-planner', useRouter: () => router }));

afterEach(() => {
  cleanup();
  actions.createOverrideAction.mockReset();
});

const options = {
  assignments: [{ id: 'a1', label: 'Adel Al-Qadami · Day A' }],
  availableAgents: [{ id: 's2', code: 'SYN 2', name: 'Basma Al-Harbi' }],
  vehicles: [{ id: 'v1', code: 'V1', name: 'RD 1001' }],
  shiftPatterns: [{ id: 'p1', code: 'DAY-A', name: 'Day A' }],
};

const open = () => {
  inLocale('en', <OverrideDrawer rosterId="r1" zoneLabel="Riyadh Central" date="14 Sept 2026" options={options} disabledReason={null} />, { module: 'ops.field_planner' });
  fireEvent.click(screen.getByRole('button', { name: 'Add override' }));
  return screen.getByRole('dialog');
};

describe('Add override drawer', () => {
  it('shows no error before anything is touched', () => {
    const drawer = open();
    expect(within(drawer).queryByText('Choose an agent')).toBeNull();
    expect(within(drawer).queryByRole('alert')).toBeNull();
  });

  it('says what is missing once the agent field is left empty, and Submit sends nothing', () => {
    const drawer = open();
    fireEvent.blur(within(drawer).getByLabelText(/^New agent/));
    expect(within(drawer).getByText('Choose an agent')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Submit override' }));
    expect(actions.createOverrideAction).not.toHaveBeenCalled();
  });
});
