// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { NoAccessPanel } from '@/components/opendispatch/ModuleStates';
import { AdminShell } from '@/components/shells/AdminShell';
import { landingHref } from '@/components/shells/landing';
import { redirect } from '@/i18n/navigation';
import { canSeeConsole } from '@/lib/access';
import { getRequestContext } from '@/lib/data/context';

// Admin Console. Same rules as the Ops layout.
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await getRequestContext();
  if (ctx === null) redirect({ href: '/', locale });

  return <AdminShell ctx={ctx}>{canSeeConsole(ctx.role, 'admin', ctx.installMode) ? children : <NoAccessPanel homeHref={landingHref(ctx)} pageLevel />}</AdminShell>;
}
