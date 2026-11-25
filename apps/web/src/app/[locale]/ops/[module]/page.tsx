// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ModuleRoute, type ModuleRouteProps } from '@/components/shells/ModuleRoute';
import { findModuleBySlug, moduleSlugsOf } from '@/i18n/module-routes';

type Props = Pick<ModuleRouteProps, 'params' | 'searchParams'>;

// One page per ops module, from the access module's list. An unknown slug is a 404 (ModuleRoute).
export function generateStaticParams() {
  return moduleSlugsOf('ops');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { module: slug } = await params;
  const def = findModuleBySlug('ops', slug);
  if (def === undefined) return {};
  const t = await getTranslations();
  return { title: `${t(def.titleKey)} | OpenDispatch` };
}

export default function OpsModulePage(props: Props) {
  return <ModuleRoute console="ops" {...props} />;
}
