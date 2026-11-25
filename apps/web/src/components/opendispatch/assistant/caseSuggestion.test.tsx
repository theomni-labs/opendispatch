// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseSuggestion, CaseSuggestionView } from '@/lib/data/case-suggestions';
import { inLocale } from '../test-utils';
import { CaseSuggestionCard } from './CaseSuggestionCard';
import { caseSuggestionCardOf, suggestionViewOf, type SuggestionView } from './caseSuggestion';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/ops/remote-queue', useRouter: () => router }));

const suggestion: CaseSuggestion = {
  provider: 'fake',
  model: 'fake-1',
  duration_ms: 2100,
  suggestion: true,
  illustrative: true,
  data_source: 'SYNTHETIC',
  case_id: 'c1',
  locale: 'en',
  classification: { handling: 'remote_inferred', severity: 'minor', injury_present: false, damage_assessment_method: 'video', confidence: 0.884, reason: 'Low-speed scrape, no injury.', quote: 'No one was hurt.' },
  rule: { outcome: 'field_preferred', handling: 'field', rule_code: null, rule_name_en: null, rule_name_ar: null },
  agrees_with_rules: false,
  photos_supplied: 0,
  photos_sent: 0,
  text_only: false,
  sent: 'Two cars scraped. No one was hurt.',
  suggested_at: '2026-10-04T10:00:00+03:00',
  review: null,
};

const caseView = (over: Partial<CaseSuggestionView> = {}): CaseSuggestionView =>
  ({
    case_id: 'c1',
    case_number: 'RD-260912-00002',
    narrative_en: 'Two cars scraped. No one was hurt.',
    narrative_ar: 'احتكت سيارتان. لم يُصب أحد.',
    photos: [],
    rule: { outcome: 'remote_eligible', handling: 'remote_inferred', rule_code: 'RULE-007', rule_name_en: 'Minor, photos', rule_name_ar: 'بسيط، صور' },
    suggestion: null,
    data_source: 'SYNTHETIC',
    ...over,
  }) as CaseSuggestionView;

afterEach(cleanup);

describe('case suggestion view', () => {
  it('maps the suggestion, rounds the confidence and keeps the default rule', () => {
    const v = suggestionViewOf(suggestion, 'en');
    expect(v).toMatchObject({ handling: 'remote_inferred', confidencePct: 88, agrees: false, rule: { handling: 'field', ruleName: null }, review: null });
  });

  it('picks the reader\'s language and falls back to the other', () => {
    expect(caseSuggestionCardOf(caseView(), 'remote_queue', 'ar')).toMatchObject({ narrative: 'احتكت سيارتان. لم يُصب أحد.', narrativeDir: 'rtl', rule: { ruleName: 'بسيط، صور' } });
    expect(caseSuggestionCardOf(caseView({ narrative_ar: null }), 'remote_queue', 'ar')).toMatchObject({ narrative: 'Two cars scraped. No one was hurt.', narrativeDir: 'ltr' });
    expect(caseSuggestionCardOf(caseView({ narrative_en: null, narrative_ar: null }), 'live_dispatch_board', 'en').narrative).toBeNull();
  });
});

describe('CaseSuggestionCard', () => {
  const ok = (data: SuggestionView) => Promise.resolve({ ok: true as const, data });

  it('says no photos were supplied and suggests on request', async () => {
    const suggest = vi.fn(() => ok(suggestionViewOf(suggestion, 'en')));
    const review = vi.fn();
    inLocale('en', <CaseSuggestionCard view={caseSuggestionCardOf(caseView(), 'remote_queue', 'en')} configured offline={false} canEdit suggestAction={suggest} reviewAction={review} />);
    expect(screen.getByText('No photos supplied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    await screen.findByText('Low-speed scrape, no injury.');
    expect(suggest).toHaveBeenCalledWith({ caseId: 'c1', from: 'remote_queue', locale: 'en' });
    expect(screen.getByText('Differs')).toBeTruthy();
    expect(screen.getByText('88%')).toBeTruthy();
    expect(screen.getAllByText('Handling unchanged').length).toBeGreaterThan(0);
    expect(screen.getByText('Suggestion')).toBeTruthy();
  });

  it('cannot suggest when the assistant is off or the case has no text', () => {
    const suggest = vi.fn();
    inLocale('en', <CaseSuggestionCard view={caseSuggestionCardOf(caseView(), 'remote_queue', 'en')} configured={false} offline={false} canEdit suggestAction={suggest} reviewAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    expect(suggest).not.toHaveBeenCalled();
    cleanup();
    inLocale('en', <CaseSuggestionCard view={caseSuggestionCardOf(caseView({ narrative_en: null, narrative_ar: null }), 'remote_queue', 'en')} configured offline={false} canEdit suggestAction={suggest} reviewAction={vi.fn()} />);
    expect(screen.getAllByText('No description on this case').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }));
    expect(suggest).not.toHaveBeenCalled();
  });

  it('a view-only role sees the suggestion but cannot accept it', () => {
    const review = vi.fn();
    inLocale('en', <CaseSuggestionCard view={caseSuggestionCardOf(caseView({ suggestion }), 'remote_queue', 'en')} configured offline={false} canEdit={false} suggestAction={vi.fn()} reviewAction={review} />);
    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(accept);
    expect(review).not.toHaveBeenCalled();
  });

  it('accepting sends the suggestion time and shows who accepted, in Arabic', async () => {
    const accepted = { ...suggestionViewOf(suggestion, 'ar'), review: { decision: 'accepted' as const, by: 'Sara' } };
    const review = vi.fn(() => ok(accepted));
    inLocale('ar', <CaseSuggestionCard view={caseSuggestionCardOf(caseView({ suggestion }), 'live_dispatch_board', 'ar')} configured offline canEdit suggestAction={vi.fn()} reviewAction={review} />);
    fireEvent.click(screen.getByRole('button', { name: 'قبول' }));
    await screen.findByText('قبله Sara');
    expect(review).toHaveBeenCalledWith({ caseId: 'c1', from: 'live_dispatch_board', decision: 'accepted', suggestedAt: '2026-10-04T10:00:00+03:00', locale: 'ar' });
  });

  it('says the local model reads text only when photos are supplied', () => {
    inLocale('en', <CaseSuggestionCard view={caseSuggestionCardOf(caseView({ photos: [{ key: 't/case-photos/a.jpg', content_type: 'image/jpeg' }] }), 'remote_queue', 'en')} configured offline canEdit suggestAction={vi.fn()} reviewAction={vi.fn()} />);
    expect(screen.getByText('1 photo')).toBeTruthy();
    expect(screen.getByText('Local model reads text only')).toBeTruthy();
  });
});
