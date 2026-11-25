// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '../test-utils';
import { HandoverCard } from './HandoverCard';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/live-dispatch-board', useRouter: () => router }));

const meta = { provider: 'fake', model: 'fake-1', duration_ms: 3800, suggestion: true, illustrative: true, data_source: 'SYNTHETIC' };
const handover = vi.fn();
const alerts = vi.fn();

afterEach(() => {
  cleanup();
  handover.mockReset();
  alerts.mockReset();
});

const open = () => fireEvent.click(screen.getByRole('button', { name: /Open|فتح/ }));
const summarise = () => screen.getAllByRole('button', { name: /Summarise|لخّص/ }).at(-1)!;

describe('HandoverCard', () => {
  it('says why when the assistant is off, and never calls it', () => {
    inLocale('en', <HandoverCard handoverAction={handover} alertsAction={alerts} configured={false} alertsDigest unread={3} />);
    open();
    expect(summarise().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Assistant not configured').length).toBeGreaterThan(0);
    fireEvent.click(summarise());
    expect(handover).not.toHaveBeenCalled();
  });

  it('asks for the chosen window and shows the lines, labels and window', async () => {
    handover.mockResolvedValue({
      ok: true,
      data: { ...meta, window_hours: 12, window_from: '2026-09-13T00:00:00+03:00', window_to: '2026-09-13T10:42:00+03:00', text: '69 cases registered.\n4 manual overrides.', answer_path: 'checked', sent: '{"cases":69}' },
    });
    inLocale('en', <HandoverCard handoverAction={handover} alertsAction={alerts} configured alertsDigest unread={3} />);
    open();
    fireEvent.click(screen.getByRole('radio', { name: '12 h' }));
    fireEvent.click(summarise());
    await screen.findByText(/69 cases registered\./);
    expect(handover).toHaveBeenCalledWith({ window_hours: 12, locale: 'en' });
    expect(screen.getByText('Suggestion')).toBeTruthy();
    expect(screen.getByText(/00:00 – 10:42/)).toBeTruthy();
    expect(screen.queryByText('Answer not verified; figures shown instead.')).toBeNull();
  });

  it('says when only the figures are shown', async () => {
    handover.mockResolvedValue({ ok: true, data: { ...meta, window_hours: 8, window_from: '2026-09-13T02:42:00+03:00', window_to: '2026-09-13T10:42:00+03:00', text: 'ملخّص.', answer_path: 'fallback_summary', sent: '{}' } });
    inLocale('ar', <HandoverCard handoverAction={handover} alertsAction={alerts} configured alertsDigest unread={0} />);
    open();
    fireEvent.click(summarise());
    await screen.findByText('تعذّر التحقق من الإجابة؛ تُعرض الأرقام بدلًا منها.');
    expect(handover).toHaveBeenCalledWith({ window_hours: 8, locale: 'ar' });
  });

  it('groups unread alerts worst first and summarises them', async () => {
    alerts.mockResolvedValue({
      ok: true,
      data: { ...meta, unread: 3, groups: [{ category: 'integration', severity: 'critical', count: 1, latest_at: 'x' }, { category: 'roster', severity: 'info', count: 2, latest_at: 'x' }], text: '3 unread alerts.', answer_path: 'checked', sent: '{}' },
    });
    inLocale('en', <HandoverCard handoverAction={handover} alertsAction={alerts} configured alertsDigest unread={3} />);
    open();
    fireEvent.click(screen.getByRole('tab', { name: /Alerts/ }));
    fireEvent.click(summarise());
    await screen.findByText('3 unread alerts.');
    expect(alerts).toHaveBeenCalledWith({ locale: 'en' });
    expect(screen.getByText('Integration')).toBeTruthy();
    expect(screen.getByText('Critical')).toBeTruthy();
    expect(screen.getByText('Roster')).toBeTruthy();
  });

  it('shows the empty state when nothing is unread', async () => {
    alerts.mockResolvedValue({ ok: true, data: { ...meta, unread: 0, groups: [], text: '', answer_path: 'checked', sent: '' } });
    inLocale('en', <HandoverCard handoverAction={handover} alertsAction={alerts} configured alertsDigest unread={0} />);
    open();
    fireEvent.click(screen.getByRole('tab', { name: /Alerts/ }));
    fireEvent.click(summarise());
    await screen.findByText('No unread alerts');
  });

  it('copies the summary', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    handover.mockResolvedValue({ ok: true, data: { ...meta, window_hours: 8, window_from: '2026-09-13T02:42:00+03:00', window_to: '2026-09-13T10:42:00+03:00', text: 'Line one.', answer_path: 'checked', sent: '{}' } });
    inLocale('en', <HandoverCard handoverAction={handover} alertsAction={alerts} configured alertsDigest={false} unread={0} />);
    open();
    expect(screen.queryByRole('tab')).toBeNull();
    fireEvent.click(summarise());
    await screen.findByText('Line one.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Line one.'));
  });
});
