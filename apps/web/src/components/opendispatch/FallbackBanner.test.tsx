// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FallbackBanner } from './FallbackBanner';
import { hasArabicIndicDigits, hasLatinLetters, inLocale, readableText } from './test-utils';

afterEach(cleanup);

describe('FallbackBanner', () => {
  it('shows fallback armed: quiet, with its title, its line and the count of fallback cases', () => {
    inLocale('en', <FallbackBanner active={false} title="Fallback armed" meta="Operator dispatch takes over after 5 s" count={0} />);
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('data-active')).toBe('false');
    expect(screen.getByText('Fallback armed')).toBeTruthy();
    expect(screen.getByText('Operator dispatch takes over after 5 s')).toBeTruthy();
    expect(screen.getByText('Fallback cases')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('shows fallback active: marked active, and says why', () => {
    inLocale('en', <FallbackBanner active title="Fallback active" meta="Case feed down since 10:43" count={2} />);
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('data-active')).toBe('true');
    expect(screen.getByText('Fallback active')).toBeTruthy();
    expect(screen.getByText('Case feed down since 10:43')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('uses a different icon for active and armed, hidden from assistive technology', () => {
    const armed = inLocale('en', <FallbackBanner active={false} title="Armed" />);
    const armedIcon = armed.container.querySelector('svg');
    expect(armedIcon?.getAttribute('aria-hidden')).toBe('true');
    const armedClass = armedIcon?.getAttribute('class') ?? '';
    cleanup();
    const active = inLocale('en', <FallbackBanner active title="Active" />);
    const activeIcon = active.container.querySelector('svg');
    expect(activeIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(activeIcon?.getAttribute('class')).not.toBe(armedClass);
  });

  it('is a polite status region, so a change from armed to active is announced', () => {
    inLocale('en', <FallbackBanner active={false} title="Fallback armed" />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('leaves the count out when it has none', () => {
    inLocale('en', <FallbackBanner active={false} title="Fallback armed" />);
    expect(screen.queryByText('Fallback cases')).toBeNull();
  });

  it('writes the count in Western digits with grouping, in both languages', () => {
    const { container } = inLocale('ar', <FallbackBanner active title="الإسناد الاحتياطي مفعّل" meta="تغذية البلاغات متوقفة منذ 10:43" count={1204} />);
    expect(screen.getByText('1,204')).toBeTruthy();
    expect(screen.getByText('بلاغات الإسناد الاحتياطي')).toBeTruthy();
    expect(hasArabicIndicDigits(readableText(container))).toBe(false);
    expect(hasLatinLetters(readableText(container))).toBe(false);
  });

  it('renders the states of the mockup in Arabic: armed and active', () => {
    inLocale('ar', <FallbackBanner active={false} title="الإسناد الاحتياطي جاهز" meta="يتولى توجيه المشغّل بعد 5 ثوانٍ" count={0} />);
    expect(screen.getByRole('status').getAttribute('data-active')).toBe('false');
    cleanup();
    inLocale('ar', <FallbackBanner active title="الإسناد الاحتياطي مفعّل" count={2} />);
    expect(screen.getByRole('status').getAttribute('data-active')).toBe('true');
  });
});
