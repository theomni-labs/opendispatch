// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { EmptyPanel, ErrorPanel, LoadingPanel, NoAccessPanel, NotFoundPanel } from './ModuleStates';
import { Providers } from './Providers';

vi.mock('@/lib/demo/actions', () => ({ setDemoSession: vi.fn(), signOutDemo: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: (props: ComponentPropsWithRef<'a'>) => <a {...props} />,
  usePathname: () => '/ops/forecast-explorer',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

function inLocale(locale: 'en' | 'ar', ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <Providers locale={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        {ui}
      </Providers>
    </NextIntlClientProvider>,
  );
}

// The states of docs/mockups/screens/_states.html, in both languages.
describe('module states', () => {
  it.each([
    ['en', 'Nothing here yet'],
    ['ar', 'لا يوجد شيء بعد'],
  ] as const)('empty: a short title and nothing else in %s', (locale, title) => {
    inLocale(locale, <EmptyPanel />);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['en', 'Loading'],
    ['ar', 'جارٍ التحميل'],
  ] as const)('loading: skeletons, busy, announced once in %s', (locale, loading) => {
    const { container } = inLocale(locale, <LoadingPanel />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getAllByText(loading)).toHaveLength(1);
    cleanup();
    inLocale(locale, <LoadingPanel showTitle={false} />);
    expect(screen.getAllByText(loading)).toHaveLength(1);
  });

  it.each([
    ['en', 'Something went wrong', 'The data could not load.', 'Try again'],
    ['ar', 'حدث خطأ ما', 'تعذّر تحميل البيانات.', 'إعادة المحاولة'],
  ] as const)('error: announced, one line and a retry in %s', (locale, title, line, retry) => {
    inLocale(locale, <ErrorPanel retry={<button type="button">{retry}</button>} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).toContain(line);
    expect(screen.getByRole('button', { name: retry })).toBeTruthy();
  });

  it('no access: goes home to the role’s landing page, or signs out when the menu is empty', () => {
    inLocale('en', <NoAccessPanel homeHref="/ops/live-dispatch-board" />);
    expect(screen.getByText('No access')).toBeTruthy();
    expect(screen.getByText('Ask an administrator for access.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/ops/live-dispatch-board');
    cleanup();

    inLocale('ar', <NoAccessPanel homeHref={undefined} />);
    expect(screen.getByText('لا تملك صلاحية الوصول')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeTruthy();
  });

  it('a page that is only a state has the state title as its h1; inside a module page the header owns the h1', () => {
    inLocale('en', <NoAccessPanel homeHref="/ops" pageLevel />);
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeTruthy();
    cleanup();
    inLocale('en', <NoAccessPanel homeHref="/ops" />);
    expect(screen.queryByRole('heading')).toBeNull();
    cleanup();
    inLocale('ar', <NotFoundPanel homeHref="/ops" />);
    expect(screen.getByRole('heading', { level: 1, name: 'الصفحة غير موجودة' })).toBeTruthy();
  });

  it('not found: says so and leads home', () => {
    inLocale('ar', <NotFoundPanel homeHref="/ops" />);
    expect(screen.getByText('الصفحة غير موجودة')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'الصفحة الرئيسية' }).getAttribute('href')).toBe('/ops');
  });
});
