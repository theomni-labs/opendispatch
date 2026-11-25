// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { HeaderActions, RunButton } from './HeaderActions';

const env = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/service-level-simulator', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ runSimulationAction: env.run }));

afterEach(() => {
  cleanup();
  env.run.mockReset();
});

describe('Service-Level Simulator header', () => {
  it('puts Export in the More menu, as "Export results"', async () => {
    inLocale('en', <HeaderActions canEdit hasInputs rosterId="r" runDate="2026-09-12" policy="nearest" />, { module: 'ops.service_level_simulator' });
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Export results' })).toBeTruthy();
  });

  it('the finish toast counts the zones replayed, in Arabic too', async () => {
    env.run.mockResolvedValue({ ok: true, data: { id: 'run-1', zones_replayed: 3 } });
    inLocale('ar', <RunButton canEdit hasInputs rosterId="r" runDate="2026-09-12" policy="nearest" />, { module: 'ops.service_level_simulator' });
    fireEvent.click(screen.getByRole('button', { name: 'تشغيل المحاكاة' }));
    await waitFor(() => expect(screen.getByText('أُعيد تشغيل 3 مناطق')).toBeTruthy());
  });

  it('the empty-state Run is disabled with no inputs', () => {
    inLocale('en', <RunButton canEdit hasInputs={false} rosterId="" runDate="" policy="nearest" variant="secondary" />, { module: 'ops.service_level_simulator' });
    const button = screen.getByRole('button', { name: 'Run simulation' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(env.run).not.toHaveBeenCalled();
  });
});
