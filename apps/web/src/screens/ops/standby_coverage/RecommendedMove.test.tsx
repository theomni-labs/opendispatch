// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { RecommendedMove } from './RecommendedMove';

const env = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/standby-coverage', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ applyMoveAction: env.apply }));

afterEach(() => {
  cleanup();
  env.apply.mockReset();
});

const move = { fromId: 'p1', toId: 'p2', fromName: 'North', toName: 'East', agents: 1, reasonEn: 'More demand' };
const base = { zoneId: 'z1', date: '2026-09-15', canEdit: true } as const;

describe('Recommended move', () => {
  it('offers Open Locations when nothing reaches the uncovered sub-zones', () => {
    inLocale('en', <RecommendedMove {...base} move={null} uncoveredCount={2} locationsHref="/en/admin/locations" />, { module: 'ops.standby_coverage' });
    expect(screen.getByText('No move reaches the uncovered sub-zones')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Locations' }).getAttribute('href')).toBe('/en/admin/locations');
  });

  it('no link for a role that cannot open Locations, none when all is covered', () => {
    inLocale('en', <RecommendedMove {...base} move={null} uncoveredCount={2} locationsHref={null} />, { module: 'ops.standby_coverage' });
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    inLocale('en', <RecommendedMove {...base} move={null} uncoveredCount={0} locationsHref="/en/admin/locations" />, { module: 'ops.standby_coverage' });
    expect(screen.getByText('No move needed')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('after a move is applied and none is left, says so (Arabic)', async () => {
    env.apply.mockResolvedValue({ ok: true, data: {} });
    const view = inLocale('ar', <RecommendedMove {...base} move={move} uncoveredCount={1} locationsHref="/ar/admin/locations" />, { module: 'ops.standby_coverage' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'تطبيق النقل' }));
    });
    await waitFor(() => expect(env.apply).toHaveBeenCalledTimes(1));
    view.rerender(<RecommendedMove {...base} move={null} uncoveredCount={1} locationsHref="/ar/admin/locations" />);
    await waitFor(() => expect(screen.getByText('طُبّق النقل. لا نقل آخر.')).toBeTruthy());
    expect(screen.queryByRole('link')).toBeNull();
  });
});
