// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { CaseDrawer } from './CaseDrawer';
import type { CaseCardView } from './types';

afterEach(cleanup);

const recommended: CaseCardView = {
  caseId: 'c2',
  caseNumber: 'RD-260913-00245',
  zoneCode: 'RD-N',
  time: '10:42',
  parties: 2,
  stage: 'recommend',
  pick: { name: 'Reem Al-Jumiri', label: 'opendispatch_pick' },
  eta: { kind: 'eta', time: '10:46' },
  classification: { handling: 'remote', rule: 'Minor, photos: remote eligible', source: 'rules' },
  canDecide: true,
  recommendedAgentId: 's1',
};

const overridden: CaseCardView = {
  caseId: 'c5',
  caseNumber: 'RD-260913-00241',
  zoneCode: 'RD-C',
  time: '10:36',
  parties: 3,
  stage: 'shadow',
  pick: { name: 'Faisal Al-Tamahi', source: 'manual' },
  eta: { kind: 'eta', time: '10:57' },
  reason: { kind: 'reassigned_from', name: 'Adel Al-Ghaari' },
  canDecide: false,
};

function open(target: CaseCardView, progress?: 'assigned' | 'enroute' | 'onscene', locale: 'en' | 'ar' = 'en', disabledReason: string | null = null) {
  const handlers = { onClose: vi.fn(), onAccept: vi.fn(), onOverride: vi.fn(), onAi: vi.fn() };
  inLocale(locale, <CaseDrawer target={target} progress={progress} disabledReason={disabledReason} {...handlers} />, { module: 'ops.live_dispatch_board' });
  return handlers;
}

describe('CaseDrawer', () => {
  it('shows the recommendation with Accept and Override, the handling with its rule and the stage', () => {
    const h = open(recommended);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('OpenDispatch pick')).toBeTruthy();
    expect(within(dialog).getByText('ETA 10:46')).toBeTruthy();
    expect(within(dialog).getByText('2 parties')).toBeTruthy();
    expect(within(dialog).getByText('Remote')).toBeTruthy();
    expect(within(dialog).getByText('inferred')).toBeTruthy();
    expect(within(dialog).getByText('Minor, photos: remote eligible')).toBeTruthy();
    expect(dialog.querySelector('[data-stage="recommend"]')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /Accept/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Override/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Suggested by AI/ }));
    expect([h.onAccept.mock.calls.length, h.onOverride.mock.calls.length, h.onAi.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it('gates Accept and Override for a view-only role', () => {
    const h = open(recommended, undefined, 'en', 'View only for this role');
    const accept = screen.getByRole('button', { name: /Accept/ });
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(accept);
    expect(h.onAccept).not.toHaveBeenCalled();
  });

  it('shows a reassignment: the source, who it came from, no decision buttons, and the history', () => {
    open(overridden, 'enroute');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Manual')).toBeTruthy();
    expect(within(dialog).getByText('En route')).toBeTruthy();
    expect(within(dialog).getByText(/Reassigned from/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Accept/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'History' }));
    const titles = within(dialog).getAllByText(/^(Registered|Assigned|Overridden|En route)$/).map((n) => n.textContent);
    expect(titles).toEqual(['En route', 'Overridden', 'Assigned', 'Registered']);
  });

  it('reads in Arabic with the right plural for the parties', () => {
    open(overridden, 'assigned', 'ar');
    expect(screen.getByRole('dialog').textContent).toContain('3 أطراف');
  });
});
