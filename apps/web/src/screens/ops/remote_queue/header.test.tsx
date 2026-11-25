// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { HeaderActions, RefreshButton } from './HeaderActions';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/remote-queue', useRouter: () => router }));

afterEach(cleanup);

describe('Remote Queue header and empty action', () => {
  it('puts Export in the More menu, as "Export queue"', async () => {
    inLocale('en', <HeaderActions firstWaitingCaseId="c1" canEdit />, { module: 'ops.remote_queue' });
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Export queue' })).toBeTruthy();
  });

  it('Refresh asks the server again, in both languages', () => {
    inLocale('en', <RefreshButton />, { module: 'ops.remote_queue' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    cleanup();
    inLocale('ar', <RefreshButton />, { module: 'ops.remote_queue' });
    expect(screen.getByRole('button', { name: 'تحديث' })).toBeTruthy();
  });
});
