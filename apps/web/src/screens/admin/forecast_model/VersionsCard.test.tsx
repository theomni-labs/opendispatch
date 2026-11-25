// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { VersionRow } from './types';
import { VersionsCard } from './VersionsCard';

vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/forecast-model', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ switchVersion: vi.fn() }));

afterEach(cleanup);

const row = (version: string, status: VersionRow['status'], placeholder: boolean, engine: string | null = null): VersionRow => ({ id: version, version, status, trainedAt: null, engine, placeholder });
const versions = [row('seasonal-profile-1', 'active', false, '0.2.0'), row('placeholder-0.2', 'candidate', true), row('placeholder-0.1', 'retired', true)];

function show(engineModel: string | null) {
  return inLocale('en', <DesignSystemProvider><VersionsCard versions={versions} activeVersion={engineModel ?? 'placeholder-0.1'} engineModel={engineModel} canEdit /></DesignSystemProvider>, { module: 'admin.forecast_model' });
}

describe('VersionsCard: placeholder rows while an engine model is active', () => {
  it('disables Make active on every placeholder row, never opens the dialog, and shows the engine version', () => {
    show('seasonal-profile-1');
    const buttons = screen.getAllByRole('button', { name: 'Make active' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(button);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('table')).getByText('0.2.0')).toBeTruthy();
  });
  it('keeps Make active enabled for the placeholders when no engine model is active', () => {
    show(null);
    expect(screen.getAllByRole('button', { name: 'Make active' }).some((b) => b.getAttribute('aria-disabled') === 'true')).toBe(false);
  });
});
