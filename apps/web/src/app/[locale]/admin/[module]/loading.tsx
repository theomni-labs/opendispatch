'use client';
// SPDX-License-Identifier: AGPL-3.0-only

import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { ScreenSkeleton, skeletonShapeOf } from '@/components/opendispatch/ScreenSkeleton';
import { findModuleBySlug } from '@/i18n/module-routes';

// The loading state of an Admin module page while its Server Component streams: skeletons in the shape of that module's
// screen (list, cards, form or detail), chosen from the route parameter because a loading file receives no props. The
// title comes from the route too (titleKey is a core, always-loaded key), as a real h1: the page otherwise has none at
// all until ScreenFrame itself mounts.
export default function Loading() {
  const t = useTranslations();
  const { module: slug } = useParams<{ module?: string }>();
  const def = slug === undefined ? undefined : findModuleBySlug('admin', slug);
  return <ScreenSkeleton shape={skeletonShapeOf(def?.id)} title={def === undefined ? undefined : t(def.titleKey)} />;
}
