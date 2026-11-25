// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale, readableText } from '@/components/opendispatch/test-utils';
import { sparkPaths } from './EffectSpark';
import { RequestDrawer } from './RequestDrawer';
import { RequestsTable } from './RequestsTable';
import { noteOf } from './types';
import type { RequestRowView } from './view';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/leave-planner', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ decideLeaveAction: vi.fn(), bulkDecideLeaveAction: vi.fn() }));

afterEach(cleanup);

const row: RequestRowView = {
  id: 'r1',
  name: 'Omar Al-Bariri',
  code: 'SVR-RD-N-025',
  kind: 'field',
  zoneCode: 'RD-N',
  startDate: '2026-09-16',
  endDate: '2026-09-19',
  startLabel: '16 Sep 2026',
  endLabel: '19 Sep 2026',
  days: 4,
  leaveType: 'annual',
  status: 'declined',
  requestedLabel: '28 Aug 2026',
  decidedLabel: '29 Aug 2026',
  note: 'Coverage is already thin',
  own: false,
  canDecide: false,
  effect: { chip: 'gaps', newGapIntervals: 34, daysAffected: 4, requiredByDay: [9.8, 10.2, 9.8, 8.8], plannedByDay: [8.4, 8.4, 8.4, 8.4], dayLabels: ['16', '17', '18', '19'] },
};

describe('Leave Planner effect', () => {
  it('marks the Effect column Illustrative and draws the spark', () => {
    const { container } = inLocale('en', <RequestsTable rows={[row]} canEdit={false} pageSize={10} page={undefined} />, { module: 'ops.leave_planner' });
    const header = screen.getByText('Effect').closest('th');
    expect(header?.textContent).toContain('Illustrative');
    expect(container.querySelectorAll('svg[aria-label="Required staffing against planned coverage"] path')).toHaveLength(2);
  });

  it('writes the drawer summary from the numbers, in Arabic too', () => {
    inLocale('ar', <RequestDrawer row={row} canEdit={false} />, { module: 'ops.leave_planner' });
    const text = readableText(document.body);
    expect(text).toContain('ينخفض عدد المندوبين المناوبين بمندوب واحد في 4 أيام');
    expect(text).toContain('ملاحظة');
    expect(hasLatinLetters(text, [row.name, row.code, 'RD-N', 'Coverage is already thin', '16 Sep 2026', '19 Sep 2026', '28 Aug 2026', '29 Aug 2026'])).toBe(false);
  });

  it('shows the Note row and the summary in English', () => {
    inLocale('en', <RequestDrawer row={row} canEdit={false} />, { module: 'ops.leave_planner' });
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.getByText('Coverage is already thin')).toBeTruthy();
    expect(screen.getByText('Staffing falls by one on 4 days; 34 intervals drop below required')).toBeTruthy();
  });

  it('noteOf prefers the decision note and skips blanks', () => {
    expect(noteOf({ note: 'Family', decision_note: 'Thin' })).toBe('Thin');
    expect(noteOf({ note: ' Family ', decision_note: '  ' })).toBe('Family');
    expect(noteOf({ note: null })).toBeNull();
  });

  it('sparkPaths: one scale, a single day as a flat line, none when empty', () => {
    expect(sparkPaths([], [], 64, 24)).toBeNull();
    const one = sparkPaths([5], [4], 64, 24);
    expect(one?.required).toBe('M3.0 3.0L61.0 3.0');
    expect(one?.planned).toBe('M3.0 21.0L61.0 21.0');
  });
});
