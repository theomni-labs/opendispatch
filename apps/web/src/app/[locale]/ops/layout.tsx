// SPDX-License-Identifier: AGPL-3.0-only
import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { NoAccessPanel } from '@/components/opendispatch/ModuleStates';
import { landingHref } from '@/components/shells/landing';
import { OpsShell } from '@/components/shells/OpsShell';
import { redirect } from '@/i18n/navigation';
import { canSeeConsole } from '@/lib/access';
import { getRequestContext } from '@/lib/data/context';

// Ops Console. No session: the demo start page. A role with no access to this console gets the no-access
// state inside the shell, with its own menu: never a redirect (so no loop) and never a default role.
export default async function OpsLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await getRequestContext();
  if (ctx === null) redirect({ href: '/', locale });

  return <OpsShell ctx={ctx}>{canSeeConsole(ctx.role, 'ops', ctx.installMode) ? children : <NoAccessPanel homeHref={landingHref(ctx)} pageLevel />}</OpsShell>;
}
