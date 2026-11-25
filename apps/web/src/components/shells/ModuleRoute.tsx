// SPDX-License-Identifier: AGPL-3.0-only
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ModulePage } from '@/components/opendispatch/ModulePage';
import { parseModuleState, parseReviewState } from '@/components/opendispatch/module-state';
import { findModuleBySlug } from '@/i18n/module-routes';
import { redirect } from '@/i18n/navigation';
import { moduleAccess, type Console } from '@/lib/access';
import { getRequestContext } from '@/lib/data/context';
import { loadAdminScreen, loadOpsScreen } from '@/screens/registry';
import type { SearchParams } from '@/screens/types';
import { landingHref } from './landing';

export interface ModuleRouteProps {
  console: Console;
  params: Promise<{ locale: string; module: string }>;
  searchParams: Promise<SearchParams>;
}

/**
 * The page of one module under /ops or /admin. Unknown slug: 404. No session: the demo start page.
 * A module the role cannot see (access none): the no-access state, decided here from the access module, never from the
 * URL, and before any screen runs, so a screen and its data functions are only reached with view or edit access.
 * A module (Admin or Ops) with a registered screen renders that screen; everything else (a module not built yet)
 * renders the placeholder page. `?state=` (demo-mode tooling) picks the state to review on either; it
 * is read here, on the server.
 */
export async function ModuleRoute({ console: consoleId, params, searchParams }: ModuleRouteProps) {
  const { locale, module: slug } = await params;
  setRequestLocale(locale);

  const def = findModuleBySlug(consoleId, slug);
  if (def === undefined) notFound();

  const ctx = await getRequestContext();
  if (ctx === null) redirect({ href: '/', locale });

  const access = moduleAccess(ctx.role, def.id, ctx.installMode);
  const homeHref = landingHref(ctx);
  const query = await searchParams;

  if (access.access === 'none') return <ModulePage def={def} access={access} state="noaccess" homeHref={homeHref} />;

  const Screen = consoleId === 'admin' ? await loadAdminScreen(def.id) : await loadOpsScreen(def.id);
  if (Screen !== undefined) {
    return <Screen def={def} ctx={ctx} access={access} locale={locale} homeHref={homeHref} state={parseReviewState(query['state'])} searchParams={query} />;
  }

  return <ModulePage def={def} access={access} state={parseModuleState(query['state'])} homeHref={homeHref} />;
}
