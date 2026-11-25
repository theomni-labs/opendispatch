// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { SignInCardMessage, referenceFrom, type SignInMessageKind } from './SignInCardMessage';
import { SignInCardSignedOut } from './SignInCardSignedOut';
import { hasLatinLetters, inLocale, readableText } from './test-utils';

vi.mock('@/components/shells/LanguageToggle', () => ({ LanguageToggle: () => <div data-language-toggle="" /> }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const T = { en: en.signIn, ar: ar.signIn };
const KINDS: readonly SignInMessageKind[] = ['refused', 'noRole', 'error'];
const REFERENCE = 'ODP-9B41C7E0';

describe('the sign-in messages', () => {
  it.each(['en', 'ar'] as const)('each message has its title as the page heading, its text, and the two ways back, in %s', (locale) => {
    for (const kind of KINDS) {
      const { unmount } = inLocale(locale, <SignInCardMessage kind={kind} reference={kind === 'error' ? REFERENCE : undefined} />);
      expect(screen.getByRole('heading', { level: 1 }).textContent, kind).toBe(T[locale][kind].title);
      expect(screen.getByRole('alert').textContent, kind).toContain(T[locale][kind].body);
      const links = screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]);
      expect(links, kind).toEqual([
        [T[locale].again, '/sign-in'],
        [T[locale].back, '/sign-in'],
      ]);
      expect(document.querySelector('[data-language-toggle]')).not.toBeNull();
      unmount();
    }
  });

  it('No role says why: no matching rule means no access', () => {
    inLocale('en', <SignInCardMessage kind="noRole" />);
    expect(screen.getByText('No matching rule means no access')).toBeTruthy();
    expect(document.querySelector('[data-sign-in="no-role"]')).not.toBeNull();
  });

  it('shows the reference code, left to right and not translated, only on the Went wrong message', () => {
    inLocale('ar', <SignInCardMessage kind="error" reference={REFERENCE} />);
    const code = document.querySelector('[data-reference]');
    expect(code?.textContent).toBe(REFERENCE);
    expect(code?.getAttribute('translate')).toBe('no');
    cleanup();
    inLocale('en', <SignInCardMessage kind="refused" reference={REFERENCE} />);
    expect(document.querySelector('[data-reference]')).toBeNull();
    cleanup();
    inLocale('en', <SignInCardMessage kind="error" />);
    expect(document.querySelector('[data-reference]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('is in Arabic with no English left over but the reference code', () => {
    for (const kind of KINDS) {
      const { container, unmount } = inLocale('ar', <SignInCardMessage kind={kind} reference={kind === 'error' ? REFERENCE : undefined} />);
      expect(hasLatinLetters(readableText(container), ['OpenDispatch', REFERENCE]), kind).toBe(false);
      unmount();
    }
  });

  it('Copy puts the code on the clipboard and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    inLocale('en', <SignInCardMessage kind="error" reference={REFERENCE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(REFERENCE));
    expect(await screen.findByText('Code copied')).toBeTruthy();
  });

  it('Copy claims nothing when the browser refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    inLocale('en', <SignInCardMessage kind="error" reference={REFERENCE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText('Code copied')).toBeNull();
  });
});

describe('referenceFrom (the ?ref= parameter)', () => {
  it('accepts a reference code and nothing else', () => {
    expect(referenceFrom('ODP-9B41C7E0')).toBe('ODP-9B41C7E0');
    for (const bad of [undefined, '', 'odp-9b41c7e0', 'ODP-9B41C7E', 'ODP-9B41C7E0Z', '<script>alert(1)</script>', 'ODP-9B41C7E0 ', ['ODP-9B41C7E0'], ['ODP-9B41C7E0', 'ODP-00000000']]) {
      expect(referenceFrom(bad as never), JSON.stringify(bad)).toBeUndefined();
    }
  });
});

describe('the Signed out page', () => {
  it.each(['en', 'ar'] as const)('says you have signed out and offers Sign in, in %s', (locale) => {
    const { container } = inLocale(locale, <SignInCardSignedOut />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(T[locale].out.title);
    expect(screen.getByText(T[locale].out.body)).toBeTruthy();
    const link = screen.getByRole('link', { name: T[locale].title });
    expect(link.getAttribute('href')).toBe('/sign-in');
    expect(document.querySelector('[data-sign-in="signed-out"]')).not.toBeNull();
    if (locale === 'ar') expect(hasLatinLetters(readableText(container), ['OpenDispatch'])).toBe(false);
  });
});
