// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { FallbackPanel } from './FallbackPanel';
import type { FallbackView } from './types';

// The banner names the actual cause.
afterEach(cleanup);

const active = (reason: FallbackView['reason']): FallbackView => ({ active: true, reason, sinceTime: '10:42', timeoutSeconds: 5, count: 3 });

describe('FallbackPanel', () => {
  it.each([
    ['manual', 'Fallback signal sent at 10:42'],
    ['feed_outage', 'Case feed down since 10:42'],
    ['health_check_failed', 'OpenDispatch health check failed at 10:42'],
    ['opendispatch_timeout', 'OpenDispatch missed its decision deadline at 10:42'],
    ['maintenance', 'Maintenance mode since 10:42'],
  ] as const)('names the cause when fallback is active (%s)', (reason, text) => {
    inLocale('en', <FallbackPanel fallback={active(reason)} />, { module: 'ops.live_dispatch_board' });
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/Case feed down/) !== null).toBe(reason === 'feed_outage');
  });

  it('shows the cause in Arabic too', () => {
    inLocale('ar', <FallbackPanel fallback={active('manual')} />, { module: 'ops.live_dispatch_board' });
    expect(screen.getByText('أُرسلت إشارة الرجوع إلى توجيه المشغّل عند 10:42')).toBeTruthy();
  });
});
