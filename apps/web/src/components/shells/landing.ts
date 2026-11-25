// SPDX-License-Identifier: AGPL-3.0-only
// Where a signed-in person goes when they are on a page they cannot use, and where /ops and /admin lead.
// Pure: built on the access module and the route helpers, no framework.

import { moduleHref } from '@/i18n/module-routes';
import { defaultLanding, getModule, menuFor, type Console } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';

/** The role's landing page, or undefined when its menu is empty. */
export function landingHref(ctx: Pick<RequestContext, 'role' | 'installMode'>): string | undefined {
  const landing = defaultLanding(ctx.role, ctx.installMode);
  return landing === null ? undefined : moduleHref(getModule(landing.moduleId));
}

/**
 * The page /ops or /admin redirects to: the role's landing module when it is in that console, otherwise the first
 * module of the role's menu in that console. Undefined when the role has nothing there.
 */
export function consoleLandingHref(ctx: Pick<RequestContext, 'role' | 'installMode'>, console: Console): string | undefined {
  const landing = defaultLanding(ctx.role, ctx.installMode);
  if (landing?.console === console) return moduleHref(getModule(landing.moduleId));
  const first = menuFor(ctx.role, ctx.installMode)
    .find((c) => c.console === console)
    ?.groups[0]?.items[0];
  return first === undefined ? undefined : moduleHref(first);
}
