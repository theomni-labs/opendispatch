// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { EMERGENCY_DEFAULT_EMAIL, SignInCardEmergency } from './SignInCardEmergency';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

const actions = vi.hoisted(() => ({ signInEmergency: vi.fn() }));
vi.mock('@/lib/demo/actions', () => actions);
vi.mock('@/components/shells/LanguageToggle', () => ({ LanguageToggle: () => <div data-language-toggle="" /> }));

afterEach(() => {
  cleanup();
  actions.signInEmergency.mockReset();
});

const T = { en: en.signIn, ar: ar.signIn };
// Made up for the test: what a person would type. Nothing here is a credential of anything.
const PASSWORD = 'typed-in-the-test-only-1';

const field = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
const card = () => document.querySelector<HTMLElement>('[data-sign-in="emergency"]');
const cont = () => screen.getByRole('button', { name: T.en.continue });
const signIn = () => screen.getByRole('button', { name: T.en.mock.submit });

/** Types the password and presses Continue; the server says `result`. Leaves the page on the code step when it says mfa_required. */
async function firstStep(result: unknown = { ok: true, next: 'mfa_required' }) {
  actions.signInEmergency.mockResolvedValueOnce(result);
  fireEvent.change(field('password') as HTMLInputElement, { target: { value: PASSWORD } });
  fireEvent.click(cont());
  await waitFor(() => expect(actions.signInEmergency).toHaveBeenCalled());
}

/** Waits until the code step is showing and no answer is being awaited any more (until then its field is disabled). */
async function onCodeStep() {
  await screen.findByRole('heading', { name: 'Authenticator code' });
  await waitFor(() => expect(field('code')?.disabled).toBe(false));
}

describe('the emergency sign-in card', () => {
  it('starts with the e-mail and the password: the first of two steps', () => {
    inLocale('en', <SignInCardEmergency />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Emergency sign-in');
    expect((field('email') as HTMLInputElement).value).toBe(EMERGENCY_DEFAULT_EMAIL);
    expect(field('password')?.type).toBe('password');
    expect(field('code')).toBeNull();
    expect(card()?.getAttribute('data-state')).toBe('credentials');
    expect(document.querySelector('[data-language-toggle]')).not.toBeNull();
  });

  it('sends the e-mail and the password, and nothing else, then asks for the code in the same page', async () => {
    inLocale('en', <SignInCardEmergency />);
    await firstStep();
    expect(actions.signInEmergency).toHaveBeenCalledWith({ email: EMERGENCY_DEFAULT_EMAIL, password: PASSWORD }, 'en');

    // the second step: the code, its hint, the lockout line; the password field is gone and the password is nowhere in the page
    await waitFor(() => expect(card()?.getAttribute('data-state')).toBe('code'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Authenticator code');
    expect(field('password')).toBeNull();
    expect(screen.getByText('From your authenticator app')).toBeTruthy();
    expect(screen.getByText('Locked after 5 failed attempts')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(PASSWORD);
    await waitFor(() => expect(document.activeElement).toBe(field('code')));
  });

  it('sends the password again with the six-digit code', async () => {
    inLocale('en', <SignInCardEmergency />);
    await firstStep();
    await onCodeStep();
    actions.signInEmergency.mockResolvedValueOnce(undefined); // a success redirects: it returns nothing
    fireEvent.change(field('code') as HTMLInputElement, { target: { value: '123456' } });
    fireEvent.click(signIn());
    await waitFor(() => expect(actions.signInEmergency).toHaveBeenCalledTimes(2));
    expect(actions.signInEmergency).toHaveBeenLastCalledWith({ email: EMERGENCY_DEFAULT_EMAIL, password: PASSWORD, totp_code: '123456' }, 'en');
  });

  it('asks for six digits before it calls the server', async () => {
    inLocale('en', <SignInCardEmergency />);
    await firstStep();
    await onCodeStep();
    for (const bad of ['', '12345', '12a456', '١٢٣٤٥٦']) {
      fireEvent.change(field('code') as HTMLInputElement, { target: { value: bad } });
      fireEvent.click(signIn());
      expect(screen.getByText('Enter a 6-digit code'), JSON.stringify(bad)).toBeTruthy();
    }
    expect(actions.signInEmergency).toHaveBeenCalledTimes(1);
    // typing again clears the message
    fireEvent.change(field('code') as HTMLInputElement, { target: { value: '1' } });
    expect(screen.queryByText('Enter a 6-digit code')).toBeNull();
  });

  it('says only "Invalid credentials" for a wrong password, clears the password and stays on the first step', async () => {
    inLocale('en', <SignInCardEmergency />);
    await firstStep({ ok: false, error: 'invalid_credentials' });
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid credentials');
    expect((field('password') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(card()?.getAttribute('data-state')).toBe('credentials'));
    await waitFor(() => expect(document.activeElement).toBe(field('password')));
    // a refusal of the input reads the same: nothing says which field was wrong
    await firstStep({ ok: false, error: 'invalid' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Invalid credentials'));
  });

  it('says only "Invalid credentials" for a wrong code, clears the code and stays on the code step', async () => {
    inLocale('en', <SignInCardEmergency />);
    await firstStep();
    await onCodeStep();
    actions.signInEmergency.mockResolvedValueOnce({ ok: false, error: 'invalid_credentials' });
    fireEvent.change(field('code') as HTMLInputElement, { target: { value: '000000' } });
    fireEvent.click(signIn());
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid credentials');
    expect((field('code') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(card()?.getAttribute('data-state')).toBe('code'));
    await waitFor(() => expect(document.activeElement).toBe(field('code')));
  });

  it('is locked after five failures: the reason is shown and the form is disabled', async () => {
    inLocale('en', <SignInCardEmergency />);
    await firstStep({ ok: false, error: 'locked' });
    expect((await screen.findByRole('alert')).textContent).toBe('Locked after 5 failed attempts');
    await waitFor(() => expect(card()?.getAttribute('data-state')).toBe('locked'));
    expect(field('email')?.disabled).toBe(true);
    expect(field('password')?.disabled).toBe(true);
    expect(cont().hasAttribute('disabled')).toBe(true);
  });

  it('is pending while the server answers: the fields are disabled and the button busy', async () => {
    let finish: (value: unknown) => void = () => undefined;
    actions.signInEmergency.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    inLocale('en', <SignInCardEmergency />);
    fireEvent.change(field('password') as HTMLInputElement, { target: { value: PASSWORD } });
    fireEvent.click(cont());
    await waitFor(() => expect(card()?.getAttribute('data-state')).toBe('credentials-pending'));
    expect(field('password')?.disabled).toBe(true);
    expect(field('email')?.disabled).toBe(true);
    expect(cont().getAttribute('aria-busy')).toBe('true');
    await act(async () => finish({ ok: true, next: 'mfa_required' }));
    await screen.findByRole('heading', { name: 'Authenticator code' });
  });

  it('says "unavailable" when the server has no session secret', async () => {
    inLocale('en', <SignInCardEmergency />);
    await firstStep({ ok: false, error: 'unavailable' });
    expect((await screen.findByRole('alert')).textContent).toBe(en.demo.errorUnavailable);
  });

  it('is in Arabic with no English left over but the data', async () => {
    const { container } = inLocale('ar', <SignInCardEmergency />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(T.ar.emergency.title);
    expect(screen.getByLabelText(T.ar.emergency.password)).toBeTruthy();
    expect(hasLatinLetters(readableText(container), ['OPENDISPATCH'])).toBe(false);
    actions.signInEmergency.mockResolvedValueOnce({ ok: true, next: 'mfa_required' });
    fireEvent.change(field('password') as HTMLInputElement, { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: T.ar.continue }));
    await screen.findByRole('heading', { name: T.ar.emergency.mfaTitle });
    expect(screen.getByText(T.ar.emergency.locked)).toBeTruthy();
    expect(hasLatinLetters(readableText(container), ['OPENDISPATCH', '000000'])).toBe(false);
    expect(field('code')?.getAttribute('dir')).toBe('ltr');
  });
});
