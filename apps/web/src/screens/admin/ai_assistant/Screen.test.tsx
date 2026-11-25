// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { DesignSystemProvider } from '@opendispatch/ui';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '@/components/opendispatch/test-utils';
import { getModule } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';
import type { AssistantOverview } from '@/lib/types';
import type { ScreenProps } from '@/screens/types';
import * as actions from './actions';
import { AiAssistantScreen } from './Screen';

// The screen with the overview stood in for.
const env = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', overview: null as unknown, router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  return { getTranslations: async (namespace?: string) => createTranslator({ locale: env.locale, messages: loadMessages(env.locale, 'admin.ai_assistant'), ...(namespace === undefined ? {} : { namespace }) }) };
});
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/ai-assistant', useRouter: () => env.router }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/data/assistant', () => ({ getAssistantOverview: vi.fn(async () => env.overview) }));
vi.mock('./actions', () => ({ testConnection: vi.fn() }));

const testMock = actions.testConnection as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  testMock.mockReset();
});

const ON: AssistantOverview = {
  status: 'on',
  provider: 'openai',
  model: 'local-model-7b',
  offline: false,
  key: 'configured',
  set_in: 'server_environment',
  window_days: 7,
  totals: { calls: 123, successes: 117, within_10s: 100 },
  usage: [
    { feature: 'rule_draft', calls: 18, successes: 15, failures: 1, denied: 0, rejected: 2, retried: null, fallbacks: null, median_ms: 3400, p90_ms: 6100 },
    { feature: 'explain', calls: 64, successes: 63, failures: 1, denied: 0, rejected: null, retried: 5, fallbacks: 1, median_ms: 4200, p90_ms: 7800 },
    { feature: 'ask', calls: 41, successes: 39, failures: 2, denied: 0, rejected: null, retried: null, fallbacks: null, median_ms: 6000, p90_ms: 11200 },
    { feature: 'tool_call', calls: 97, successes: 97, failures: 0, denied: 0, rejected: null, retried: null, fallbacks: null, median_ms: null, p90_ms: null },
  ],
  last_test: { ok: true, duration_ms: 812, error_code: null, tested_at: '2026-10-04T09:12:00+03:00' },
  data_source: 'SYNTHETIC',
};

const OFF: AssistantOverview = { ...ON, status: 'off', provider: 'off', model: '', offline: true, key: 'not_needed', totals: { calls: 0, successes: 0, within_10s: 0 }, usage: [], last_test: null };

async function renderScreen(overview: AssistantOverview | null, opts: { locale?: 'en' | 'ar'; access?: 'edit' | 'view'; state?: ScreenProps['state'] } = {}) {
  const locale = opts.locale ?? 'en';
  env.locale = locale;
  env.overview = overview;
  const element = await AiAssistantScreen({ def: getModule('admin.ai_assistant'), ctx: {} as RequestContext, access: { access: opts.access ?? 'edit', reduced: false }, locale, homeHref: '/', state: opts.state, searchParams: {} });
  return inLocale(locale, <DesignSystemProvider navigate={vi.fn()}>{element}</DesignSystemProvider>, { module: 'admin.ai_assistant' });
}

const testButton = () => screen.getByRole('button', { name: /Test connection|اختبار الاتصال/ });
const isDisabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled');
const bodyRows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);

describe('AI Assistant screen', () => {
  it('shows four figures, the usage table and the configuration, never a key', async () => {
    const { container } = await renderScreen(ON);
    expect(container.querySelector('[data-module="admin.ai_assistant"]')?.getAttribute('data-state')).toBe('filled');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AI Assistant');
    expect(container.querySelector('[data-badge="SYNTHETIC"]')).not.toBeNull();
    for (const label of ['Status', 'Calls, 7 days', 'Success rate']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText('On').length).toBeGreaterThan(0);
    expect(screen.getAllByText('local-model-7b').length).toBe(2);
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('95%')).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['Rule draft', 'Explain this', 'Ask', 'Lookups']);
    expect(screen.getByText('5 · 1')).toBeTruthy();
    expect(screen.getByText('11.2 s')).toBeTruthy();
    expect(screen.getAllByText('Configured').length).toBeGreaterThan(0);
    expect(screen.getByText('OPENDISPATCH_ASSISTANT_*')).toBeTruthy();
    expect(container.querySelector('[data-last-test="ok"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/sk-|OPENDISPATCH_ASSISTANT_API_KEY/);
    expect(isDisabled(testButton())).toBe(false);
  });

  it('runs the test and toasts the result', async () => {
    testMock.mockResolvedValue({ ok: true, data: { ok: true, durationMs: 800, errorCode: null } });
    await renderScreen(ON);
    fireEvent.click(testButton());
    await waitFor(() => expect(testMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText('Connected').length).toBeGreaterThan(1));
  });

  it('when off: Off, empty usage, the test disabled with the reason', async () => {
    await renderScreen(OFF);
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);
    expect(screen.getByText('The assistant is off')).toBeTruthy();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    expect(isDisabled(testButton())).toBe(true);
    fireEvent.click(testButton());
    expect(testMock).not.toHaveBeenCalled();
  });

  it('when the key is missing: Not configured, test disabled', async () => {
    await renderScreen({ ...OFF, status: 'not_configured', provider: 'openai', model: 'local-model-7b', offline: false, key: 'not_configured' });
    expect(screen.getAllByText('Not configured').length).toBeGreaterThan(1);
    expect(isDisabled(testButton())).toBe(true);
  });

  it('on with no calls: the usage card says so', async () => {
    await renderScreen({ ...ON, usage: [], totals: { calls: 0, successes: 0, within_10s: 0 } });
    expect(screen.getByText('No calls in the last 7 days')).toBeTruthy();
    expect(isDisabled(testButton())).toBe(false);
  });

  it('Viewer / Auditor: view only, test disabled', async () => {
    await renderScreen(ON, { access: 'view' });
    expect(screen.getByText('View only')).toBeTruthy();
    expect(isDisabled(testButton())).toBe(true);
    fireEvent.click(testButton());
    expect(testMock).not.toHaveBeenCalled();
  });

  it('a local model shows Local and offline', async () => {
    await renderScreen({ ...ON, provider: 'ollama', model: 'qwen2.5:7b-instruct', offline: true, key: 'not_needed' });
    expect(screen.getAllByText('Local').length).toBe(2);
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.getByText('Not needed')).toBeTruthy();
  });

  it('a failed last test shows the code', async () => {
    const { container } = await renderScreen({ ...ON, last_test: { ok: false, duration_ms: 30000, error_code: 'timeout', tested_at: '2026-10-04T09:12:00+03:00' } });
    expect(container.querySelector('[data-last-test="failed"]')?.textContent).toContain('No answer in time');
  });

  it('draws in Arabic', async () => {
    await renderScreen(ON, { locale: 'ar' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('المساعد الذكي');
    expect(screen.getAllByText('مفعّل').length).toBeGreaterThan(0);
    expect(screen.getByText('صياغة قاعدة')).toBeTruthy();
  });

  it.each(['loading', 'error', 'empty'] as const)('review state %s reads nothing', async (state) => {
    const { container } = await renderScreen(null, { state });
    expect(container.querySelector('[data-module]')?.getAttribute('data-state')).toBe(state);
  });
});
