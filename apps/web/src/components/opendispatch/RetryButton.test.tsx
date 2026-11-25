// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetryButton } from './RetryButton';
import { inLocale } from './test-utils';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/audit-log', useRouter: () => router }));

afterEach(() => {
  cleanup();
  router.replace.mockReset();
  router.refresh.mockReset();
});

describe('RetryButton', () => {
  it('reloads the page without the ?state= parameter by default (the review page)', () => {
    inLocale('en', <RetryButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(router.replace).toHaveBeenCalledWith('/admin/audit-log');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('does only what the error boundary asks when it is given `onRetry`', () => {
    const onRetry = vi.fn();
    inLocale('ar', <RetryButton onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
