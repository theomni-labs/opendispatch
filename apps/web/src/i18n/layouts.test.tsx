// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { messageLeaves, type Messages } from './message-tree';
import { coreMessages } from './messages';

// The seam of the design, at the two layouts: the root layout sends the browser core only, the module layout adds that
// module's messages and nothing else. next-intl's server functions and Next's router are stood in for; the layouts are
// called as functions and the props they give the client provider are read.
vi.mock('next-intl/server', () => ({ setRequestLocale: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: () => null,
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

type Element = ReactElement<{ children?: ReactNode; messages?: Messages; locale?: string }>;
const child = (element: unknown): Element => (element as Element).props.children as Element;

describe('root layout', () => {
  it.each(['en', 'ar'] as const)('gives the client provider the core messages only (%s)', async (locale) => {
    const { default: LocaleLayout } = await import('@/app/[locale]/layout');
    const html = (await LocaleLayout({ children: null, params: Promise.resolve({ locale }) })) as Element;
    const provider = child(child(html)); // <html> > <body> > <NextIntlClientProvider>
    expect(provider.props.locale).toBe(locale);
    expect(provider.props.messages).toEqual(coreMessages(locale));
    expect(Object.keys(provider.props.messages ?? {})).not.toContain('admin');
  });

  it('answers 404 for a locale it does not serve', async () => {
    const { default: LocaleLayout } = await import('@/app/[locale]/layout');
    await expect(LocaleLayout({ children: null, params: Promise.resolve({ locale: 'fr' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('Admin module layout', () => {
  it.each(['en', 'ar'] as const)('adds that one module’s namespace and no other, for each slug (%s)', async (locale) => {
    const { default: AdminModuleLayout } = await import('@/app/[locale]/admin/[module]/layout');
    const { moduleSlugsOf } = await import('./module-routes');
    for (const { module: slug } of moduleSlugsOf('admin')) {
      const provider = (await AdminModuleLayout({ children: null, params: Promise.resolve({ locale, module: slug }) })) as Element;
      const messages = provider.props.messages ?? {};
      const key = slug.replaceAll('-', '_');
      expect(Object.keys(messages), slug).toEqual(['admin']);
      expect(Object.keys(messages['admin'] as Messages), slug).toEqual([key]);
      // Nothing of core rides along: the root layout already sent it.
      expect(Object.keys(messageLeaves(messages)).every((path) => path.startsWith(`admin.${key}.`)), slug).toBe(true);
    }
  });

  it('answers 404 for a slug that is no Admin module, and for an Ops slug', async () => {
    const { default: AdminModuleLayout } = await import('@/app/[locale]/admin/[module]/layout');
    for (const slug of ['nope', 'live-dispatch-board', '']) {
      await expect(AdminModuleLayout({ children: null, params: Promise.resolve({ locale: 'en', module: slug }) })).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});
