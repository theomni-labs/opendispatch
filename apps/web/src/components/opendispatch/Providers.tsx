'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { DesignSystemProvider, ToastProvider } from '@opendispatch/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useMemo } from 'react';
import { buildDsLabels } from '@/i18n/ds-labels';
import { Link, usePathname, useRouter } from '@/i18n/navigation';

/**
 * Everything the design system needs from the application, created here because this is a client file.
 * The locale layout (a Server Component) passes only the two plain strings `locale` and `dir`: a function
 * created on the server cannot be passed to a client component (docs/client-boundary.md in the design system,
 *. The link component, navigation, active path and label functions all come from next-intl.
 * The provider also sets up Ant Design (direction, locale pack, theme). AntdRegistry collects Ant Design's styles during
 * server rendering and puts them in the `antd` cascade layer, so the base reset sits below them and the app's CSS
 * Modules, which are not layered, can adjust a component with a single class.
 * `ToastProvider` sits inside it because it reads the labels (`toast.region`, `toast.dismiss`) from the provider; every
 * screen's `useToast()` (a saved change, a copied value, a Demo notice) needs it mounted once, here.
 */
export function Providers({ locale, dir, children }: { locale: string; dir: 'ltr' | 'rtl'; children: ReactNode }) {
  const t = useTranslations('ds');
  const router = useRouter();
  const pathname = usePathname(); // next-intl: the path without the locale prefix, like the hrefs given to <Link>

  // Rebuilt only when the language (and so `t`) changes.
  const labels = useMemo(() => buildDsLabels(t), [t]);
  // Hrefs handed to the design system have no locale prefix; next-intl's router adds it.
  const navigate = useCallback((href: string) => router.push(href), [router]);

  return (
    <AntdRegistry layer>
      <DesignSystemProvider
        locale={locale}
        dir={dir}
        labels={labels}
        linkComponent={Link}
        navigate={navigate}
        activePath={pathname}
      >
        <ToastProvider>{children}</ToastProvider>
      </DesignSystemProvider>
    </AntdRegistry>
  );
}
