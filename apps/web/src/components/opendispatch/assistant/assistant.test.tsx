// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inLocale } from '../test-utils';
import { AskButton } from './AskButton';
import { ExplainCard } from './ExplainCard';
import { RuleDraftBlock } from './RuleDraftBlock';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/forecast-explorer', useRouter: () => router }));
const actions = { explainScreen: vi.fn(), askQuestion: vi.fn() };

const meta = { provider: 'fake', model: 'fake-1', duration_ms: 2100, suggestion: true, illustrative: true, data_source: 'SYNTHETIC' };

afterEach(() => {
  cleanup();
  actions.explainScreen.mockReset();
  actions.askQuestion.mockReset();
});

describe('ExplainCard', () => {
  it('says why when the assistant is off, and never calls it', () => {
    inLocale('en', <ExplainCard action={actions.explainScreen} target="forecast_explorer" zoneId="z" date="2026-09-14" configured={false} />);
    const button = screen.getByRole('button', { name: /Explain/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Assistant not configured').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(actions.explainScreen).not.toHaveBeenCalled();
  });

  it('says why when the view has filters Explain cannot match', () => {
    inLocale('en', <ExplainCard action={actions.explainScreen} target="gap_surplus" date="2026-09-20" configured blockedReason="Clear the filters" />);
    const button = screen.getByRole('button', { name: /Explain/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Clear the filters').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(actions.explainScreen).not.toHaveBeenCalled();
  });

  it('shows the explanation with the provider, model and the Suggestion label', async () => {
    actions.explainScreen.mockResolvedValue({ ok: true, data: { ...meta, target: 'forecast_explorer', text: 'About 41 cases.', sent: '{"expected_cases":41}' } });
    inLocale('ar', <ExplainCard action={actions.explainScreen} target="forecast_explorer" zoneId="z" date="2026-09-14" configured />);
    fireEvent.click(screen.getByRole('button', { name: 'اشرح' }));
    await screen.findByText('About 41 cases.');
    expect(actions.explainScreen).toHaveBeenCalledWith({ target: 'forecast_explorer', zone_id: 'z', date: '2026-09-14', locale: 'ar' });
    expect(screen.getByText('اقتراح')).toBeTruthy();
    expect(screen.getByText(/fake · fake-1 · 2.1/)).toBeTruthy();
  });
});

describe('AskButton', () => {
  it('lists every lookup and says when the answer was refused or capped', async () => {
    actions.askQuestion.mockResolvedValue({ ok: true, data: { ...meta, answer: '', refused: false, capped: true, tool_calls: [{ name: 'gap_summary', input: {}, ok: true }, { name: 'utilization', input: {}, ok: false }] } });
    inLocale('en', <AskButton action={actions.askQuestion} configured />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.change(await screen.findByLabelText('Question'), { target: { value: 'Where are the gaps?' } });
    const send = screen.getAllByRole('button', { name: 'Ask' }).at(-1)!;
    fireEvent.click(send);
    await screen.findByText('Stopped after 5 lookups.');
    expect(screen.getByText('gap_summary')).toBeTruthy();
    expect(screen.getByText('utilization')).toBeTruthy();
    expect(screen.getByText('Lookups (2 of 5)')).toBeTruthy();
  });
});

describe('RuleDraftBlock', () => {
  it('hands the validated draft to the form and labels it a suggestion', async () => {
    const draft = { name_en: 'Injury', name_ar: null, condition: { match: 'all' as const, predicates: [{ field: 'injury_present', operator: 'eq' as const, value: true }] }, condition_text_en: 'Someone is injured', outcome: 'field_mandatory' as const };
    const action = vi.fn().mockResolvedValue({ ok: true, data: { ...meta, draft } });
    const onDraft = vi.fn();
    inLocale('en', <RuleDraftBlock action={action} configured editReason={null} onDraft={onDraft} />);
    fireEvent.change(screen.getByLabelText('Describe the rule'), { target: { value: 'injured means field' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(draft));
    expect(action).toHaveBeenCalledWith({ text: 'injured means field', locale: 'en' });
    expect(screen.getByText('Draft placed in the builder. Check it before saving.')).toBeTruthy();
  });

  it('shows the translated reason when the draft fails the checks', async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, code: 'invalid', message: 'The assistant\'s draft did not pass the rule checks: "driver_age" is not a field of the rule builder.', reason: 'ASSISTANT_INVALID_OUTPUT' });
    const onDraft = vi.fn();
    inLocale('en', <RuleDraftBlock action={action} configured editReason={null} onDraft={onDraft} />);
    fireEvent.change(screen.getByLabelText('Describe the rule'), { target: { value: 'driver under 25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await screen.findByText("The assistant's draft did not pass the checks");
    expect(screen.getByText('Rephrase it, or fill it in by hand.')).toBeTruthy();
    expect(screen.queryByText('That is not possible in its current state.')).toBeNull();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('lists what the draft could not hold, in Arabic too', async () => {
    const draft = { name_en: 'Minor', name_ar: 'بسيط', condition: { match: 'all' as const, predicates: [{ field: 'severity', operator: 'eq' as const, value: 'minor' }] }, condition_text_en: 'Minor', outcome: 'remote_eligible' as const };
    const action = vi.fn().mockResolvedValue({ ok: true, data: { ...meta, draft, unmapped: ['في الليل'] } });
    inLocale('ar', <RuleDraftBlock action={action} configured editReason={null} onDraft={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('صف القاعدة'), { target: { value: 'حادث بسيط في الليل' } });
    fireEvent.click(screen.getByRole('button', { name: 'صياغة' }));
    await screen.findByText('ليست في المسودة');
    expect(screen.getByText('في الليل')).toBeTruthy();
  });
});

describe('assistant failures', () => {
  it.each([
    ['ASSISTANT_OFF', 'en', 'The assistant is not switched on'],
    ['ASSISTANT_UNAVAILABLE', 'en', 'The assistant could not answer right now'],
    ['ASSISTANT_UNAVAILABLE', 'ar', 'تعذّر على المساعد الإجابة الآن'],
  ] as const)('%s has its own title (%s)', async (reason, locale, title) => {
    actions.explainScreen.mockResolvedValue({ ok: false, code: 'conflict', message: 'The model server answered 529.', reason });
    inLocale(locale, <ExplainCard action={actions.explainScreen} target="forecast_explorer" zoneId="z" date="2026-09-14" configured />);
    fireEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'اشرح' : 'Explain' }));
    await screen.findByText(title);
    expect(screen.queryByText(locale === 'ar' ? 'لا يمكن ذلك في حالته الحالية.' : 'That is not possible in its current state.')).toBeNull();
  });
});

describe('answer text', () => {
  it('shows Markdown as plain paragraphs and lists, never as asterisks or HTML', async () => {
    actions.askQuestion.mockResolvedValue({ ok: true, data: { ...meta, answer: '## الملخص\n**الرياض** فيها 3 فترات عجز.\n- الأولى 14:00\n- الثانية <b>16:00</b>', refused: false, capped: false, tool_calls: [] } });
    const { container } = inLocale('ar', <AskButton action={actions.askQuestion} configured />);
    fireEvent.click(screen.getByRole('button', { name: 'اسأل' }));
    fireEvent.change(await screen.findByLabelText('السؤال'), { target: { value: 'أين العجز؟' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'اسأل' }).at(-1)!);
    await screen.findByText('الرياض فيها 3 فترات عجز.');
    const items = [...document.querySelectorAll('[data-assistant="text"] li')].map((li) => li.textContent);
    expect(items).toEqual(['الأولى 14:00', 'الثانية <b>16:00</b>']);
    expect(document.querySelector('[data-assistant="text"]')!.textContent).not.toMatch(/[*#]/);
    expect(document.querySelector('[data-assistant="text"] b')).toBeNull();
    expect(container).toBeTruthy();
  });
});
