// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { MOCK_SCENARIOS, SIGN_IN_DEFAULTS, SignInCardForm, mockBodyFor, parseGroups } from './SignInCardForm';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

const actions = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock('@/lib/demo/actions', () => actions);
vi.mock('@/components/shells/LanguageToggle', () => ({ LanguageToggle: () => <div data-language-toggle="" /> }));

afterEach(() => {
  cleanup();
  actions.signInMock.mockReset();
});

const T = { en: en.signIn, ar: ar.signIn };
const demo = { en: en.demo, ar: ar.demo };

const email = (locale: 'en' | 'ar' = 'en') => screen.getByLabelText(T[locale].email) as HTMLInputElement;
const providerCard = () => document.querySelector<HTMLElement>('[data-sign-in="mock-provider"]');
const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const outcome = (value: string) => document.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`);
const submitMock = () => fireEvent.click(screen.getByRole('button', { name: T.en.mock.submit }));

describe('the sign-in card', () => {
  it('shows the e-mail, Continue, or, Sign in with SSO and the Emergency administrator link, and no provider card yet', () => {
    inLocale('en', <SignInCardForm />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in');
    expect(email().value).toBe(SIGN_IN_DEFAULTS.email);
    expect(email().type).toBe('email');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'or' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with SSO' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Emergency administrator' }).getAttribute('href')).toBe('/sign-in/emergency');
    // the brand and the language toggle open the card, as in the mockup
    expect(screen.getByText('OPENDISPATCH').getAttribute('translate')).toBe('no');
    expect(document.querySelector('[data-language-toggle]')).not.toBeNull();
    expect(providerCard()).toBeNull();
  });

  it.each([['Continue'], ['Sign in with SSO']])('%s opens the mock provider card with the e-mail as the subject, and moves focus into it', async (name) => {
    inLocale('en', <SignInCardForm />);
    fireEvent.change(email(), { target: { value: '  someone@demo.example ' } });
    fireEvent.click(screen.getByRole('button', { name }));

    expect(providerCard()).not.toBeNull();
    expect(screen.getByText('Mock provider (demo only)')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Mock provider' })).toBeTruthy();
    expect(field('subject')?.value).toBe('someone@demo.example');
    expect(field('groups')?.value).toBe(SIGN_IN_DEFAULTS.groups);
    expect(MOCK_SCENARIOS.map((code) => outcome(code)?.checked)).toEqual([true, false, false, false]);
    for (const label of ['Signs in', 'No matching group', 'Provider refuses', 'Provider fails']) expect(screen.getByLabelText(label)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field('subject')));
    expect(actions.signInMock).not.toHaveBeenCalled();
  });

  it('pressing Enter in the e-mail field is Continue', () => {
    inLocale('en', <SignInCardForm />);
    fireEvent.submit(email().closest('form') as HTMLFormElement);
    expect(providerCard()).not.toBeNull();
  });

  it('sends only the three typed fields, and the language, to the sign-in action', async () => {
    actions.signInMock.mockResolvedValue(undefined);
    inLocale('en', <SignInCardForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(field('groups') as HTMLInputElement, { target: { value: 'opendispatch-planners-riyadh, opendispatch-auditors,\nopendispatch-planners-riyadh،extra' } });
    submitMock();
    await waitFor(() => expect(actions.signInMock).toHaveBeenCalledTimes(1));
    expect(actions.signInMock).toHaveBeenCalledWith({ provider_id: 'mock-provider', subject: SIGN_IN_DEFAULTS.email, groups: ['opendispatch-planners-riyadh', 'opendispatch-auditors', 'extra'] }, 'en');
  });

  it.each([
    ['noRole', { provider_id: 'mock-provider', groups: [] }],
    ['refused', { provider_id: 'mock-provider-off', groups: [] }],
    ['error', { provider_id: 'mock-provider', subject: 'provider.error', groups: [] }],
  ] as const)('the %s outcome sends what the data layer scripts for it', async (code, expected) => {
    actions.signInMock.mockResolvedValue(undefined);
    inLocale('en', <SignInCardForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(outcome(code) as HTMLInputElement);
    submitMock();
    await waitFor(() => expect(actions.signInMock).toHaveBeenCalledTimes(1));
    const [body, locale] = actions.signInMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(body).toMatchObject(expected);
    expect(locale).toBe('en');
  });

  it('never has a role, customer, user, zone or install mode in what it sends, for any outcome', () => {
    for (const scenario of MOCK_SCENARIOS) expect(Object.keys(mockBodyFor(scenario, 'a@b.example', 'g1, g2')).sort(), scenario).toEqual(['groups', 'provider_id', 'subject']);
  });

  it('keeps the groups field for the outcome that reads it and disables it for the others', () => {
    inLocale('en', <SignInCardForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(field('groups')?.disabled).toBe(false);
    for (const code of ['noRole', 'refused', 'error']) {
      fireEvent.click(outcome(code) as HTMLInputElement);
      expect(field('groups')?.disabled, code).toBe(true);
    }
    fireEvent.click(outcome('signed') as HTMLInputElement);
    expect(field('groups')?.disabled).toBe(false);
  });

  it('is pending while the action runs: fields and outcomes are disabled and the button busy; then it says what was refused', async () => {
    let finish: (value: unknown) => void = () => undefined;
    actions.signInMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    inLocale('en', <SignInCardForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    submitMock();

    await waitFor(() => expect(providerCard()?.getAttribute('data-state')).toBe('pending'));
    expect(field('subject')?.disabled).toBe(true);
    expect(field('groups')?.disabled).toBe(true);
    expect(outcome('signed')?.disabled).toBe(true);
    expect(screen.getByRole('button', { name: T.en.mock.submit }).getAttribute('aria-busy')).toBe('true');
    expect(email().disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);

    await act(async () => finish({ ok: false, error: 'invalid' }));
    expect((await screen.findByRole('alert')).textContent).toContain(demo.en.errorInvalid);
    await waitFor(() => expect(providerCard()?.getAttribute('data-state')).toBe('error'));
    expect(field('subject')?.disabled).toBe(false);
  });

  it('says "unavailable" when the server has no session secret', async () => {
    actions.signInMock.mockResolvedValue({ ok: false, error: 'unavailable' });
    inLocale('en', <SignInCardForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    submitMock();
    expect((await screen.findByRole('alert')).textContent).toContain(demo.en.errorUnavailable);
  });

  it('is in Arabic, right to left, with no English left over but the data (names, codes, e-mail addresses)', () => {
    const { container } = inLocale('ar', <SignInCardForm />);
    fireEvent.click(screen.getByRole('button', { name: T.ar.continue }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(T.ar.title);
    // the mockup's Arabic badge and title read the same
    expect(screen.getAllByText(T.ar.mock.badge)).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(T.ar.mock.title);
    expect(screen.getByRole('button', { name: T.ar.sso })).toBeTruthy();
    expect(screen.getByRole('link', { name: T.ar.emergencyLink })).toBeTruthy();
    expect(hasLatinLetters(readableText(container), ['OPENDISPATCH'])).toBe(false);
    // typed data stays left to right inside the right-to-left page
    expect(field('subject')?.getAttribute('dir')).toBe('auto');
    expect(email('ar').getAttribute('translate')).toBe('no');
  });
});

describe('parseGroups', () => {
  it('splits on Latin and Arabic commas and line breaks, trims, and drops blanks and repeats', () => {
    expect(parseGroups(' a , b،c\nd,, a ')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseGroups('')).toEqual([]);
    expect(parseGroups(' , ، \n ')).toEqual([]);
  });
});
