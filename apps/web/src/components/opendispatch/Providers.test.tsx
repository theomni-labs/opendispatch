// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  Pagination,
  RadioGroup,
  useActivePath,
  useDir,
  useLabels,
  useLink,
  useLocale,
  useNavigate,
  useToast,
} from '@opendispatch/ui';
import { NextIntlClientProvider } from 'next-intl';
import { type ComponentPropsWithRef, type ReactNode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { Link as RouterLink } from '@/i18n/navigation';
import { Providers } from './Providers';

// next-intl's navigation helpers need Next's app router; the provider only needs their shape.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: (props: ComponentPropsWithRef<'a'>) => <a data-router-link="" {...props} />,
  usePathname: () => '/ops/forecast-explorer',
  useRouter: () => router,
}));

afterEach(() => {
  cleanup();
  router.push.mockReset();
});

// `onLink` receives the link component the design system holds, so the test can compare it with what was given.
function Probe({ onLink }: { onLink?: (link: unknown) => void }) {
  const label = useLabels();
  const navigate = useNavigate();
  const link = useLink();
  useEffect(() => onLink?.(link), [link, onLink]);
  return (
    <div>
      <output data-testid="settings">{`${useLocale()}|${useDir()}|${useActivePath()}`}</output>
      <output data-testid="count">{label('commandPalette.count', { count: 2 })}</output>
      <output data-testid="selected">{label('dataTable.selectedCount', { n: 12 })}</output>
      <button type="button" onClick={() => navigate('/ops/y')}>
        go
      </button>
    </div>
  );
}

function inLocale(locale: 'en' | 'ar', ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
      <Providers locale={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        {ui}
      </Providers>
    </NextIntlClientProvider>,
  );
}

describe('Providers (design system wiring)', () => {
  it('gives the design system the locale, direction, active path, router link and navigation', () => {
    const onLink = vi.fn();
    inLocale('ar', <Probe onLink={onLink} />);
    expect(screen.getByTestId('settings').textContent).toBe('ar|rtl|/ops/forecast-explorer');
    expect(onLink).toHaveBeenCalledWith(RouterLink);
    screen.getByText('go').click();
    expect(router.push).toHaveBeenCalledWith('/ops/y');
  });

  it('answers labels from the message files, with Arabic plural rules', () => {
    inLocale('ar', <Probe />);
    expect(screen.getByTestId('count').textContent).toBe('نتيجتان');
    expect(screen.getByTestId('selected').textContent).toBe('12 صفًا محددًا');
  });

  it('answers labels in English with the design system default text', () => {
    inLocale('en', <Probe />);
    expect(screen.getByTestId('settings').textContent).toBe('en|ltr|/ops/forecast-explorer');
    expect(screen.getByTestId('count').textContent).toBe('2 results');
    expect(screen.getByTestId('selected').textContent).toBe('12 selected');
  });

  it('reaches a real design system component: Pagination is named and labelled in Arabic', () => {
    inLocale('ar', <Pagination page={2} pageCount={9} onPageChange={() => undefined} />);
    expect(screen.getByRole('navigation').getAttribute('aria-label')).toBe('التنقل بين الصفحات');
    expect(screen.getByRole('button', { name: 'الصفحة التالية' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'الصفحة السابقة' })).toBeTruthy();
    expect(screen.queryByText('Next page')).toBeNull();
  });

  it('and in English', () => {
    inLocale('en', <Pagination page={2} pageCount={9} onPageChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
  });
});

// ui-next needed a Radix `DirectionProvider` for reversed arrow keys in RTL. The design system reads the direction
// from its own provider, so Providers alone must be enough.
describe('Providers (direction reaches the design system without a Radix DirectionProvider)', () => {
  const options = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C' },
  ];

  function checkedAfter(locale: 'en' | 'ar', key: 'ArrowRight' | 'ArrowLeft') {
    inLocale(locale, <RadioGroup name="g" options={options} defaultValue="b" aria-label="g" />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'B' }), { key });
    return screen.getAllByRole<HTMLInputElement>('radio').find((radio) => radio.checked)?.value;
  }

  it('moves to the next radio with the right arrow in English and to the previous one in Arabic', () => {
    expect(checkedAfter('en', 'ArrowRight')).toBe('c');
    cleanup();
    expect(checkedAfter('ar', 'ArrowRight')).toBe('a');
  });

  it('swaps the left arrow the same way', () => {
    expect(checkedAfter('en', 'ArrowLeft')).toBe('a');
    cleanup();
    expect(checkedAfter('ar', 'ArrowLeft')).toBe('c');
  });
});

// Every screen raises toasts through `useToast()`. Without the provider the design system only warns and shows nothing,
// so the wiring is proved here, with the labels of each language.
describe('Providers (the design system ToastProvider is mounted, with its labels)', () => {
  function Raise() {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast({ title: 'Saved', description: 'The change is stored', tone: 'success' })}>
        raise
      </button>
    );
  }

  it.each([
    ['en', 'Notifications', 'Dismiss notification'],
    ['ar', 'الإشعارات', 'إغلاق الإشعار'],
  ] as const)('shows a toast in a labelled live region and dismisses it in %s', (locale, region, dismiss) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    inLocale(locale, <Raise />);
    const live = screen.getByRole('region', { name: region });
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(within(live).queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByText('raise'));
    const toast = within(live).getByRole('status');
    expect(toast.textContent).toContain('Saved');
    expect(toast.textContent).toContain('The change is stored');

    fireEvent.click(within(toast).getByRole('button', { name: dismiss }));
    expect(within(live).queryByRole('status')).toBeNull();
    // The design system warns when useToast() runs outside a ToastProvider: it did not.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('gives no English label in the Arabic live region', () => {
    inLocale('ar', <Raise />);
    fireEvent.click(screen.getByText('raise'));
    const live = screen.getByRole('region', { name: 'الإشعارات' });
    expect(live.querySelector('[aria-label="Dismiss notification"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
  });
});
