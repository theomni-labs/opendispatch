// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import type { RequestContext } from '@/lib/data/guard';
import type { EngineStatuses } from '@/lib/types';
import { EnginesCard, type EnginesCardProps } from './EnginesCard';
import { loadEnginesView } from './view';

// The Engines card against crafted engine statuses: every breaker state, stale, empty, loading and error with retry, in both languages.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', query: '', router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }, navigate: vi.fn(), list: null as unknown, fail: false }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.system_health'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/system-health', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(env.query) }));
vi.mock('@/lib/data/system', () => ({
  getEngineStatuses: async () => {
    if (env.fail) throw new Error('down');
    return env.list;
  },
}));

const base = { calls: 0, failures: 0, timeouts: 0, breaker_opens: 0, rejected: 0, fallbacks: 0, model_version: null, last_failure_at: null, mode: 'engine', breaker_state: 'closed' } as const;
const list = (items: Partial<EngineStatuses['items'][number]>[], asOf = new Date().toISOString()): EngineStatuses => ({
  as_of: asOf,
  items: items.map((item, i) => ({ ...base, engine: (['forecaster', 'optimizer', 'simulator', 'assignment'] as const)[i] ?? 'forecaster', ...item })),
});
const FOUR = [
  { calls: 1240, failures: 3, timeouts: 1, fallbacks: 4, model_version: 'placeholder-0.2', last_failure_at: '2026-09-13T04:12:00+03:00' },
  { breaker_state: 'half_open', calls: 318, failures: 14, timeouts: 6, rejected: 9, breaker_opens: 2, fallbacks: 17 },
  { mode: 'fixture' },
  { breaker_state: 'open', calls: 5210, failures: 188, timeouts: 61, rejected: 340, breaker_opens: 3, fallbacks: 402, model_version: 'placeholder-0.1', last_failure_at: '2026-09-13T06:18:00+03:00' },
] as const;

beforeEach(() => {
  env.locale = 'en';
  env.fail = false;
  env.list = list([...FOUR]);
});
afterEach(() => {
  cleanup();
  env.router.refresh.mockReset();
  env.router.push.mockReset();
  env.router.replace.mockReset();
  env.navigate.mockReset();
});

async function renderCard(props: Partial<EnginesCardProps> = {}, locale: 'en' | 'ar' = 'en') {
  env.locale = locale;
  const view = props.review === 'error' || props.review === 'empty' || props.review === 'loading' ? undefined : await loadEnginesView({} as RequestContext);
  const element = await EnginesCard({ view, locale, ...props });
  return inLocale(locale, <DesignSystemProvider navigate={env.navigate}>{element}</DesignSystemProvider>, { module: 'admin.system_health' });
}
const rows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);

describe('Engines card: filled', () => {
  it('has the six columns of the mockup and one row per engine with its health pill and model version', async () => {
    const { container } = await renderCard();
    expect(container.querySelector('[data-engines]')?.getAttribute('data-engines')).toBe('filled');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Engine', 'Status', 'Model version', 'Calls', 'Answered from fixture', 'Last failure']);
    expect(rows()).toHaveLength(4);
    expect(within(rows()[0] as HTMLElement).getByText('Forecaster')).toBeTruthy();
    expect(within(rows()[0] as HTMLElement).getByText('Healthy')).toBeTruthy();
    expect(within(rows()[0] as HTMLElement).queryByText('Closed')).toBeNull();
    expect(within(rows()[0] as HTMLElement).getByText('placeholder-0.2')).toBeTruthy();
    expect(within(rows()[1] as HTMLElement).getByText('Degraded')).toBeTruthy();
    expect(within(rows()[1] as HTMLElement).getAllByText('—')).toHaveLength(2);
    expect(within(rows()[2] as HTMLElement).getByText('Fixture')).toBeTruthy();
    expect(within(rows()[3] as HTMLElement).getByText('Down')).toBeTruthy();
    expect(within(rows()[3] as HTMLElement).getByText('placeholder-0.1')).toBeTruthy();
    expect(screen.getByText('As of')).toBeTruthy();
    expect(screen.queryByText('Stale')).toBeNull();
  });

  it('shows calls with failures and timeouts, the fixture answers and the last failure, or a dash', async () => {
    await renderCard();
    const assignment = rows()[3] as HTMLElement;
    expect(within(assignment).getByText('5,210')).toBeTruthy();
    expect(within(assignment).getByText('188 failed, 61 timed out')).toBeTruthy();
    expect(within(assignment).getByText('402')).toBeTruthy();
    expect(assignment.textContent).toContain('06:18');
    expect(within(rows()[2] as HTMLElement).getAllByText('—')).toHaveLength(2);
  });

  it('tints a half-open row warning and an open row danger, never a closed one', async () => {
    await renderCard();
    const cls = (row: HTMLElement) => row.className;
    expect(cls(rows()[3] as HTMLElement)).toMatch(/danger/i);
    expect(cls(rows()[1] as HTMLElement)).toMatch(/warning/i);
    expect(cls(rows()[0] as HTMLElement)).not.toMatch(/danger|warning/i);
    expect(cls(rows()[2] as HTMLElement)).not.toMatch(/danger|warning/i);
  });

  it.each([['closed'], ['half_open'], ['open']] as const)('reads the %s breaker as health', async (state) => {
    env.list = list([{ breaker_state: state }]);
    await renderCard();
    expect(within(rows()[0] as HTMLElement).getByText({ closed: 'Healthy', half_open: 'Degraded', open: 'Down' }[state])).toBeTruthy();
  });

  it('opens the drawer for ?engine= with every count, the model version and the last failure', async () => {
    await renderCard({ open: 'assignment' });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Assignment')).toBeTruthy();
    for (const label of ['Calls', 'Failures', 'Timeouts', 'Rejected calls', 'Circuit breaker', 'Breaker opens', 'Answered from fixture', 'Model version', 'Last failure']) expect(within(dialog).getByText(label)).toBeTruthy();
    expect(within(dialog).getByText('placeholder-0.1')).toBeTruthy();
    expect(within(dialog).getByText('340')).toBeTruthy();
    expect(within(dialog).getByText('Down')).toBeTruthy();
    expect(within(dialog).getByText('Open')).toBeTruthy();
  });

  it('shows a dash for a model version, a breaker (fixture mode) and a last failure that were never seen', async () => {
    await renderCard({ open: 'simulator' });
    expect(within(screen.getByRole('dialog')).getAllByText('—')).toHaveLength(3);
  });

  it('opens no drawer when the engine is not on the card', async () => {
    env.list = list([{}]);
    await renderCard({ open: 'assignment' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('links each row to its drawer through ?engine=', async () => {
    await renderCard();
    fireEvent.click(rows()[1] as HTMLElement);
    expect(String(env.navigate.mock.calls[0]?.[0])).toContain('engine=optimizer');
  });
});

describe('Engines card: the other states', () => {
  it('is stale when the reading is older than five minutes: a Stale pill beside the old time', async () => {
    env.list = list([...FOUR], new Date(Date.now() - 20 * 60_000).toISOString());
    const { container } = await renderCard();
    expect(container.querySelector('[data-engines]')?.getAttribute('data-engines')).toBe('stale');
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByText('As of')).toBeTruthy();
    expect(rows()).toHaveLength(4);
  });

  it('is empty when no engine is reported', async () => {
    env.list = list([]);
    const { container } = await renderCard();
    expect(container.querySelector('[data-engines]')?.getAttribute('data-engines')).toBe('empty');
    expect(screen.getByText('No engines reported')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is loading under the review hook: skeleton lines, busy, no table', async () => {
    const { container } = await renderCard({ review: 'loading' });
    expect(container.querySelector('[data-engines="loading"]')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is an error when the read fails, with Try again that refreshes', async () => {
    env.fail = true;
    const { container } = await renderCard();
    expect(container.querySelector('[data-engines]')?.getAttribute('data-engines')).toBe('error');
    expect(screen.getByText('Engine status could not load')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(env.router.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([['empty'], ['error']] as const)('shows the %s state from the review hook without reading', async (review) => {
    env.fail = true;
    const { container } = await renderCard({ review });
    expect(container.querySelector('[data-engines]')?.getAttribute('data-engines')).toBe(review);
  });

  it('shows the stale state from the review hook over fresh data', async () => {
    const { container } = await renderCard({ review: 'stale' });
    expect(container.querySelector('[data-engines]')?.getAttribute('data-engines')).toBe('stale');
  });
});

describe('Engines card: Arabic', () => {
  it('uses the Arabic words of the mockup for the columns, engines, pills and sub line', async () => {
    await renderCard({ open: 'optimizer' }, 'ar');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['المحرّك', 'الحالة', 'إصدار النموذج', 'الاستدعاءات', 'ردود تجريبية', 'آخر فشل']);
    expect(within(rows()[0] as HTMLElement).getByText('محرّك التوقع')).toBeTruthy();
    expect(within(rows()[0] as HTMLElement).getByText('سليم')).toBeTruthy();
    expect(within(rows()[0] as HTMLElement).queryByText('مغلق')).toBeNull();
    expect(within(rows()[1] as HTMLElement).getAllByText('متدهور').length).toBeGreaterThan(0);
    expect(within(rows()[2] as HTMLElement).getByText('بيانات تجريبية')).toBeTruthy();
    expect(within(rows()[3] as HTMLElement).getByText('متوقف')).toBeTruthy();
    expect(within(rows()[3] as HTMLElement).getByText(/فشل: .*، انتهاء المهلة: /)).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    for (const label of ['حالات الفشل', 'انتهاء المهلة', 'استدعاءات مرفوضة', 'قاطع الدائرة', 'مرات فتح قاطع الدائرة', 'إصدار النموذج']) expect(within(dialog).getByText(label)).toBeTruthy();
  });

  it('words the empty, error and stale states in Arabic', async () => {
    env.list = list([]);
    await renderCard({}, 'ar');
    expect(screen.getByText('لا توجد بيانات عن المحرّكات')).toBeTruthy();
    cleanup();
    env.fail = true;
    await renderCard({}, 'ar');
    expect(screen.getByText('تعذّر تحميل حالة المحرّكات')).toBeTruthy();
    cleanup();
    env.fail = false;
    env.list = list([...FOUR], new Date(Date.now() - 20 * 60_000).toISOString());
    await renderCard({}, 'ar');
    expect(screen.getByText('غير محدّث')).toBeTruthy();
  });
});
