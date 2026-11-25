// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLatinLetters, inLocale, readableText } from '../test-utils';
import { AuditTimeline, type AuditTimelineEvent } from './AuditTimeline';
import { CopyButton } from './CopyButton';
import { StatStrip } from './StatStrip';
import { StubTag } from './StubTag';
import { ZonePicker, type PickerZone } from './ZonePicker';

afterEach(cleanup);

describe('StubTag', () => {
  it('says Demo for scripted behaviour and Not applied for a setting with no effect, in both languages', () => {
    const { container } = inLocale('en', <><StubTag kind="demo" /><StubTag kind="notApplied" /></>);
    expect(container.querySelector('[data-stub="demo"]')?.textContent).toBe('Demo');
    expect(container.querySelector('[data-stub="notApplied"]')?.textContent).toBe('Not applied');
    cleanup();
    const ar = inLocale('ar', <><StubTag kind="demo" /><StubTag kind="notApplied" /></>);
    expect(ar.container.querySelector('[data-stub="demo"]')?.textContent).toBe('عرض تجريبي');
    expect(ar.container.querySelector('[data-stub="notApplied"]')?.textContent).toBe('غير مطبّق');
    expect(hasLatinLetters(ar.container.textContent ?? '')).toBe(false);
  });

  it('explains itself in a tooltip on keyboard focus, in the reader\'s language', () => {
    vi.useFakeTimers();
    try {
      const { container } = inLocale('en', <StubTag kind="notApplied" />);
      const tag = container.querySelector<HTMLElement>('[data-stub="notApplied"]') as HTMLElement;
      act(() => tag.focus());
      act(() => void vi.advanceTimersByTime(400));
      expect(screen.getByRole('tooltip').textContent).toBe('Saved and audited, but not applied yet.');
      expect(tag.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('StatStrip', () => {
  it('shows at most four figures, drops the rest, and formats numbers with Western digits in both languages', () => {
    const items = [
      { label: 'Users', value: 1234 },
      { label: 'Active', value: 11 },
      { label: 'Invited', value: 1 },
      { label: 'Disabled', value: 1 },
      { label: 'Fifth', value: 5 },
    ];
    inLocale('en', <StatStrip items={items} />);
    expect(screen.queryByText('Fifth')).toBeNull();
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByText('1,234')).toBeTruthy();
    cleanup();
    const { container } = inLocale('ar', <StatStrip items={[{ label: 'المستخدمون', value: 1234 }]} />);
    expect(container.textContent).toContain('1,234');
    expect(/[٠-٩]/.test(container.textContent ?? '')).toBe(false);
  });

  it('marks the figure translate="no" and accepts a preformatted string, a unit and a hint', () => {
    const { container } = inLocale('en', <StatStrip items={[{ label: 'Latency', value: '9:57', unit: 'min', hint: 'From assignment' }]} />);
    expect(container.querySelector('bdi[translate="no"]')?.textContent).toBe('9:57');
    expect(screen.getByText('min')).toBeTruthy();
    expect(screen.getByText('From assignment')).toBeTruthy();
  });
});

describe('CopyButton', () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('copies the value and says so with a toast', async () => {
    writeText.mockResolvedValue(undefined);
    inLocale('en', <CopyButton value="ODP-9B41C7E0" label="Copy reference" description="Reference code" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }));
    });
    expect(writeText).toHaveBeenCalledWith('ODP-9B41C7E0');
    expect(await screen.findByText('Copied')).toBeTruthy();
    expect(screen.getByText('Reference code')).toBeTruthy();
  });

  it('says it could not copy when the clipboard refuses, and never throws', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    inLocale('en', <CopyButton value="secret" showLabel />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(await screen.findByText('Could not copy')).toBeTruthy();
  });

  it('says it could not copy when there is no clipboard at all (an insecure page)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    inLocale('en', <CopyButton value="x" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(await screen.findByText('Could not copy')).toBeTruthy();
  });

  it('is an icon button named for a screen reader, or a labelled button, in Arabic too', () => {
    inLocale('ar', <CopyButton value="x" />);
    expect(screen.getByRole('button', { name: 'نسخ' })).toBeTruthy();
    cleanup();
    inLocale('ar', <CopyButton value="x" showLabel label="نسخ المفتاح" />);
    expect(screen.getByRole('button', { name: 'نسخ المفتاح' }).textContent).toContain('نسخ المفتاح');
  });
});

const zones: PickerZone[] = [
  { id: 'z1', code: 'RD-C', name: 'Riyadh Central', cityId: 'c1', cityName: 'Riyadh' },
  { id: 'z2', code: 'RD-N', name: 'Riyadh North', cityId: 'c1', cityName: 'Riyadh' },
  { id: 'z3', code: 'JD-N', name: 'Jeddah North', cityId: 'c2', cityName: 'Jeddah' },
];

describe('ZonePicker', () => {
  const picker = (value: string[], onChange = vi.fn(), extra: Partial<Parameters<typeof ZonePicker>[0]> = {}) => (
    <ZonePicker legend="Zone" zones={zones} value={value} onChange={onChange} {...extra} />
  );

  it('groups the zones by city, with the code on each checkbox and the city name as data', () => {
    const { container } = inLocale('en', picker(['z1']));
    expect(screen.getByRole('group', { name: 'Zone' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'RD-C' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'RD-C' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'RD-N' }) as HTMLInputElement).checked).toBe(false);
    expect(container.querySelectorAll('[translate="no"]').length).toBeGreaterThanOrEqual(5);
  });

  it('adds and removes a single zone', () => {
    const onChange = vi.fn();
    inLocale('en', picker(['z1'], onChange));
    fireEvent.click(screen.getByRole('checkbox', { name: 'RD-N' }));
    expect(onChange).toHaveBeenLastCalledWith(['z1', 'z2']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'RD-C' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('has a whole-city toggle: all on, all off, and indeterminate when only some are chosen', () => {
    const onChange = vi.fn();
    inLocale('en', picker(['z1'], onChange));
    const city = screen.getByRole('checkbox', { name: 'All zones of Riyadh' }) as HTMLInputElement;
    expect(city.indeterminate).toBe(true);
    fireEvent.click(city);
    expect(onChange).toHaveBeenLastCalledWith(['z1', 'z2']);
    cleanup();
    inLocale('en', picker(['z1', 'z2', 'z3'], onChange));
    const full = screen.getByRole('checkbox', { name: 'All zones of Riyadh' }) as HTMLInputElement;
    expect(full.checked).toBe(true);
    fireEvent.click(full);
    expect(onChange).toHaveBeenLastCalledWith(['z3']);
  });

  it('counts what is chosen, and asks for at least one when it is required and nothing is chosen', () => {
    inLocale('en', picker(['z1', 'z3'], vi.fn(), { required: true }));
    expect(screen.getByText('2 chosen')).toBeTruthy();
    cleanup();
    inLocale('en', picker([], vi.fn(), { required: true }));
    const message = screen.getByRole('alert');
    expect(message.textContent).toBe('Choose at least one zone');
    expect(screen.getByRole('group', { name: 'Zone' }).getAttribute('aria-describedby')).toBe(message.getAttribute('id'));
  });

  it('is disabled for a role whose scope is not assigned zones, with its hint, and never asks for a zone', () => {
    const onChange = vi.fn();
    inLocale('en', picker([], onChange, { disabled: true, required: true, disabledHint: 'Not needed for this role' }));
    expect(screen.getByText('Not needed for this role')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect((box as HTMLInputElement).disabled).toBe(true);
  });

  it('says there is nothing to choose from when the caller has no zones', () => {
    inLocale('en', <ZonePicker legend="Zone" zones={[]} value={[]} onChange={vi.fn()} />);
    expect(screen.getByText('No zones to choose from')).toBeTruthy();
  });

  it('reads in Arabic with the messages translated and the codes and city names untouched', () => {
    const { container } = inLocale('ar', <ZonePicker legend="المنطقة" zones={zones} value={['z1']} onChange={vi.fn()} required />);
    expect(screen.getByText('المختارة: 1')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'كل مناطق Riyadh' })).toBeTruthy();
    expect(hasLatinLetters(readableText(container), ['Riyadh Central', 'Riyadh North', 'Jeddah North', 'Riyadh', 'Jeddah', 'RD-C', 'RD-N', 'JD-N'])).toBe(false);
  });
});

const events: AuditTimelineEvent[] = [
  { id: 'e1', action: 'user.created', summary_en: 'User Sara invited as Dispatcher.', occurred_at: '2026-09-12T08:00:00+03:00', outcome: 'success', actor_type: 'user', actor_user_id: 'u1' },
  { id: 'e2', action: 'user.disabled', summary_en: 'Denied: viewer_auditor may not edit.', occurred_at: '2026-09-12T09:30:00+03:00', outcome: 'denied', actor_type: 'user', actor_user_id: 'u2' },
  { id: 'e3', action: 'model.retrained', summary_en: 'Nightly retraining.', occurred_at: '2026-09-12T02:00:00+03:00', outcome: 'success', actor_type: 'system', actor_user_id: null },
  { id: 'e4', action: 'x.y', summary_en: 'Someone we cannot name.', occurred_at: '2026-09-12T10:00:00+03:00', outcome: 'failure', actor_type: 'user', actor_user_id: 'u9' },
];

describe('AuditTimeline', () => {
  const names = { u1: 'Nadia Al-Ghalani', u2: 'Tariq Al-Dubari' };

  it('shows each event with its English summary marked lang="en", the actor by name, the code and the outcome', () => {
    const { container } = inLocale('en', <AuditTimeline events={events} names={names} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toContain('User Sara invited as Dispatcher.');
    expect(items[0]?.textContent).toContain('Nadia Al-Ghalani');
    expect(items[0]?.textContent).toContain('user.created');
    expect(items[0]?.textContent).toContain('Done');
    expect(items[1]?.textContent).toContain('Denied');
    expect(items[2]?.textContent).toContain('System');
    expect(items[3]?.textContent).toContain('Unknown user');
    const summary = screen.getByText('User Sara invited as Dispatcher.');
    expect(summary.getAttribute('lang')).toBe('en');
    expect(summary.getAttribute('dir')).toBe('ltr');
    expect(container).toBeTruthy();
    expect(items[0]?.textContent).toMatch(/12 Sept 2026 08:00/);
  });

  it('shows the worker as System, and a deleted user as Unknown user, in both languages', () => {
    const worker: AuditTimelineEvent = { ...events[3]!, id: 'w', actor_user_id: '00000000-0000-4000-9000-000000000002' };
    inLocale('en', <AuditTimeline events={[worker, events[3]!]} names={names} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('System');
    expect(items[1]?.textContent).toContain('Unknown user');
    cleanup();
    inLocale('ar', <AuditTimeline events={[worker]} names={names} />);
    expect(screen.getByRole('listitem').textContent).toContain('النظام');
  });

  it('shows a translated title in place of the English summary', () => {
    inLocale('ar', <AuditTimeline events={[{ ...events[0]!, title: 'تم' }]} names={names} />);
    expect(screen.getByText('تم')).toBeTruthy();
    expect(screen.queryByText('User Sara invited as Dispatcher.')).toBeNull();
  });

  it('marks the actor and the code translate="no" (data), so an Arabic page has no untranslated text', () => {
    const { container } = inLocale('ar', <AuditTimeline events={events.slice(0, 2)} names={names} />);
    expect(hasLatinLetters(container.textContent ?? '', ['User Sara invited as Dispatcher.', 'Denied: viewer_auditor may not edit.', 'Nadia Al-Ghalani', 'Tariq Al-Dubari', 'user.created', 'user.disabled'])).toBe(false);
    expect(container.textContent).toContain('مرفوض');
    for (const node of container.querySelectorAll('bdi[translate="no"]')) expect(node.textContent?.length).toBeGreaterThan(0);
  });

  it('says there are no events, in both languages', () => {
    inLocale('en', <AuditTimeline events={[]} names={{}} />);
    expect(screen.getByText('No events yet')).toBeTruthy();
    cleanup();
    inLocale('ar', <AuditTimeline events={[]} names={{}} />);
    expect(screen.getByText('لا توجد أحداث بعد')).toBeTruthy();
  });
});
