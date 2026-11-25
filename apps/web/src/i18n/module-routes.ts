// SPDX-License-Identifier: AGPL-3.0-only
// Route helpers for the 30 modules. Pure: the URL slug is the module id after the console
// prefix with underscores turned into hyphens ('ops.live_dispatch_board' -> '/ops/live-dispatch-board').
// Hrefs have no locale prefix: the next-intl Link and redirect add it.

import { MODULES, modulesOf, type Console, type ModuleDef, type ModuleId } from '@/lib/access';

export function moduleSlug(id: ModuleId): string {
  return id.slice(id.indexOf('.') + 1).replaceAll('_', '-');
}

/** '/ops/live-dispatch-board'. */
export function moduleHref(def: Pick<ModuleDef, 'id' | 'console'>): string {
  return `/${def.console}/${moduleSlug(def.id)}`;
}

/** The module a URL slug names inside one console, or undefined (the route then calls notFound()). */
export function findModuleBySlug(console: Console, slug: string): ModuleDef | undefined {
  return MODULES.find((m) => m.console === console && moduleSlug(m.id) === slug);
}

/** Route params for generateStaticParams of one console. */
export function moduleSlugsOf(console: Console): { module: string }[] {
  return modulesOf(console).map((m) => ({ module: moduleSlug(m.id) }));
}
